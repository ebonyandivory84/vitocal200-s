'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RuntimeWriteGuard } = require('../lib/runtime-write-guard');

function confirmedEncoding(lengthBytes = 1) {
    return {
        encodingConfirmed: true,
        sourceVerified: true,
        consistentReads: 3,
        lengthBytes,
        dataType: lengthBytes === 1 ? 'uchar' : 'uint',
        scaling: 1,
        endianness: lengthBytes === 1 ? 'not-applicable' : 'little-endian',
    };
}

function fixture(overrides = {}) {
    const clock = { value: 100000 };
    const writes = [];
    let failAtCall = overrides.failAtCall || 0;
    const transport = {
        async writeCommand(command, value) {
            writes.push({ command, value });
            if (failAtCall && writes.length === failAtCall) {
                throw new Error('simulated transport failure');
            }
            return 'OK';
        },
    };
    const guard = new RuntimeWriteGuard({
        transport,
        now: () => clock.value,
        hardwareAvailable: true,
        enableRuntimeExternalWrites: true,
        enableOneTimeDhwWrites: true,
        minWriteIntervalMs: 1000,
        heartbeatIntervalMs: 60000,
        ...overrides,
    });
    const validate = (...addresses) => {
        for (const address of addresses) {
            assert.equal(guard.validateReadback(address, confirmedEncoding()).ok, true);
        }
    };
    return { guard, writes, clock, validate, setFailAtCall: value => (failAtCall = value) };
}

test('runtime writes are disabled by default', () => {
    const guard = new RuntimeWriteGuard({
        transport: { async writeCommand() {} },
        hardwareAvailable: true,
    });
    guard.validateReadback('A400', confirmedEncoding());
    assert.equal(guard.authorize('A400', 13).code, 'RUNTIME_WRITES_DISABLED');
});

test('A400 allows economy and reset, but blocks non-whitelisted modes', () => {
    const { guard, validate } = fixture();
    validate('A400');
    assert.equal(guard.authorize('A400', 13).ok, true);
    assert.equal(guard.authorize('A400', 255).ok, true);
    assert.equal(guard.authorize('A400', 12).code, 'VALUE_NOT_WHITELISTED');
    assert.equal(guard.authorize('A400', 100).code, 'VALUE_NOT_WHITELISTED');
});

test('A400 expert modes require their explicit feature flags', () => {
    const expert = fixture({ enableExpertHeatMode: true });
    expert.validate('A400');
    assert.equal(expert.guard.authorize('A400', 1).ok, true);

    const flow = fixture({ enableExperimentalFlowOverride: true });
    flow.validate('A400');
    assert.equal(flow.guard.authorize('A400', 100).ok, true);
});

test('A401 enforces configured and hard safety limits', () => {
    const { guard, validate } = fixture();
    validate('A401');
    assert.equal(guard.authorize('A401', 18).ok, true);
    assert.equal(guard.authorize('A401', 24).ok, true);
    assert.equal(guard.authorize('A401', 25).code, 'CONFIGURED_LIMIT_EXCEEDED');
    assert.equal(guard.authorize('A401', 31).code, 'HARD_LIMIT_EXCEEDED');
    assert.equal(guard.authorize('A401', 21.5).code, 'INTEGER_REQUIRED');
});

test('A3C2 and A3C0 enforce the DHW whitelist and 55 C hard limit', () => {
    const { guard, validate } = fixture();
    validate('A3C2', 'A3C0');
    assert.equal(guard.authorize('A3C2', 1).ok, true);
    assert.equal(guard.authorize('A3C2', 255).ok, true);
    assert.equal(guard.authorize('A3C2', 6).code, 'VALUE_NOT_WHITELISTED');
    assert.equal(guard.authorize('A3C0', 45).ok, true);
    assert.equal(guard.authorize('A3C0', 51).code, 'CONFIGURED_LIMIT_EXCEEDED');
    assert.equal(guard.authorize('A3C0', 56).code, 'HARD_LIMIT_EXCEEDED');
});

test('A403 is disabled unless experimental flow override is enabled', () => {
    const normal = fixture();
    normal.validate('A403');
    assert.equal(normal.guard.authorize('A403', 30).code, 'FLOW_OVERRIDE_DISABLED');

    const experimental = fixture({ enableExperimentalFlowOverride: true });
    experimental.validate('A403');
    assert.equal(experimental.guard.authorize('A403', 30).ok, true);
    assert.equal(experimental.guard.authorize('A403', 46).code, 'HARD_LIMIT_EXCEEDED');
});

test('A380, 779C, schedule, persistent and unknown addresses always remain blocked', () => {
    const { guard } = fixture({ enableExperimentalPlantManager: true });
    assert.equal(guard.authorize('A380', 1).code, 'ADDRESS_ALWAYS_BLOCKED');
    assert.equal(guard.authorize('779C', 20).code, 'ADDRESS_ALWAYS_BLOCKED');
    assert.equal(guard.authorize('1570', 1).code, 'SCHEDULE_WRITE_BLOCKED');
    assert.equal(guard.authorize('1800', 1).code, 'SCHEDULE_WRITE_BLOCKED');
    assert.equal(guard.authorize('2000', 20).code, 'ADDRESS_ALWAYS_BLOCKED');
    assert.equal(guard.authorize('6000', 45).code, 'ADDRESS_ALWAYS_BLOCKED');
    assert.equal(guard.authorize('DEAD', 1).code, 'UNKNOWN_OR_READ_ONLY_ADDRESS');
});

test('hardware and verified raw readback are mandatory', () => {
    const unavailable = fixture({ hardwareAvailable: false });
    unavailable.validate('A400');
    assert.equal(unavailable.guard.authorize('A400', 13).code, 'HARDWARE_UNAVAILABLE');

    const unvalidated = fixture();
    assert.equal(unvalidated.guard.authorize('A400', 13).code, 'READBACK_NOT_VALIDATED');
    assert.equal(
        unvalidated.guard.validateReadback('A400', { encodingConfirmed: false }).code,
        'ENCODING_NOT_CONFIRMED',
    );
});

test('a normal write is rejected when its control inputs are stale', () => {
    const { guard, validate } = fixture();
    validate('A400');
    assert.equal(guard.authorize('A400', 13, { inputsFresh: false }).code, 'INPUTS_STALE');
    assert.equal(guard.authorize('A400', 255, { inputsFresh: false }).ok, true);
});

test('duplicate writes and fast changes are suppressed', async () => {
    const { guard, writes, clock, validate } = fixture();
    validate('A401');
    assert.equal((await guard.write('A401', 20)).ok, true);
    clock.value += 2000;
    assert.equal((await guard.write('A401', 20)).code, 'DUPLICATE_SUPPRESSED');
    assert.equal((await guard.write('A401', 21)).ok, true);
    clock.value += 500;
    assert.equal((await guard.write('A401', 22)).code, 'RATE_LIMITED');
    assert.equal(writes.length, 2);
});

test('reset value 255 bypasses duplicate and rate suppression', async () => {
    const { guard, writes, validate } = fixture();
    validate('A400');
    assert.equal((await guard.write('A400', 13)).ok, true);
    assert.equal((await guard.write('A400', 255)).ok, true);
    assert.equal((await guard.write('A400', 255)).ok, true);
    assert.deepEqual(writes.map(entry => entry.value), [13, 255, 255]);
});

test('activation writes setpoint before mode', async () => {
    const { guard, writes, validate } = fixture();
    validate('A401', 'A400', 'A3C0', 'A3C2');
    const heating = await guard.activateHeatingRoomSetpoint(22);
    assert.equal(heating.every(result => result.ok), true);
    assert.deepEqual(writes.slice(0, 2), [
        { command: 'setRaumsollExternHK1', value: 22 },
        { command: 'setBetriebsartExternHK1', value: 13 },
    ]);
    const dhw = await guard.activateDhw(45);
    assert.equal(dhw.every(result => result.ok), true);
    assert.deepEqual(writes.slice(2), [
        { command: 'setWWSollExtern', value: 45 },
        { command: 'setWWBetriebsartExtern', value: 1 },
    ]);
});

test('heartbeat refresh runs only for active overrides and preserves order', async () => {
    const inactive = fixture({ enableHeartbeatRefresh: true });
    assert.equal((await inactive.guard.refreshActiveOverrides())[0].code, 'NO_ACTIVE_OVERRIDE');

    const active = fixture({ enableHeartbeatRefresh: true });
    active.validate('A401', 'A400');
    await active.guard.activateHeatingRoomSetpoint(22);
    active.clock.value += 60000;
    const refresh = await active.guard.refreshActiveOverrides();
    assert.equal(refresh.every(result => result.ok), true);
    assert.deepEqual(active.writes.slice(-2), [
        { command: 'setRaumsollExternHK1', value: 22 },
        { command: 'setBetriebsartExternHK1', value: 13 },
    ]);
});

test('stale input and shutdown perform best-effort return to internal control', async () => {
    const stale = fixture();
    stale.validate('A401', 'A400', 'A3C0', 'A3C2');
    await stale.guard.activateHeatingRoomSetpoint(22);
    stale.clock.value += 2000;
    await stale.guard.activateDhw(45);
    const staleResults = await stale.guard.handleStaleInputs();
    assert.deepEqual(staleResults.map(result => result.value), [255, 255]);
    assert.deepEqual(stale.guard.snapshot().active, { heating: false, dhw: false });

    const stopping = fixture();
    stopping.validate('A401', 'A400');
    await stopping.guard.activateHeatingRoomSetpoint(21);
    const shutdownResults = await stopping.guard.shutdown();
    assert.deepEqual(shutdownResults.map(result => result.value), [255]);
});

test('communication failure latches the guard and prevents follow-up writes', async () => {
    const { guard, writes, validate } = fixture({ failAtCall: 2 });
    validate('A401', 'A400');
    const activation = await guard.activateHeatingRoomSetpoint(22);
    assert.equal(activation[1].code, 'COMMUNICATION_FAILURE');
    const afterFailure = await guard.write('A400', 255);
    assert.equal(afterFailure.code, 'COMMUNICATION_FAULT_LATCHED');
    assert.equal(writes.length, 2);
});

test('B020 is event-only and B000 remains disabled by default', () => {
    const { guard, validate } = fixture();
    validate('B020', 'B000');
    assert.equal(guard.authorize('B020', 2).ok, true);
    assert.equal(guard.authorize('B020', 1).code, 'VALUE_NOT_WHITELISTED');
    assert.equal(guard.authorize('B000', 2).code, 'LEGACY_B000_WRITES_DISABLED');
});
