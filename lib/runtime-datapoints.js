'use strict';

const RAW_UNVERIFIED = Object.freeze({
    status: 'unverified',
    lengthBytes: null,
    dataType: null,
    scaling: null,
    endianness: null,
});

function point(definition) {
    return Object.freeze({
        ...definition,
        rawEncoding: Object.freeze({ ...RAW_UNVERIFIED, ...(definition.rawEncoding || {}) }),
    });
}

const DATAPOINTS = Object.freeze({
    A400: point({
        techniqueId: 'A400',
        name: 'BetriebsartExternHK1',
        readCommand: 'getBetriebsartExternHK1',
        writeCommand: 'setBetriebsartExternHK1',
        access: 'externalRuntimeInput',
        strategy: 'preferred-heating-mode',
        resetValue: 255,
        rawEncoding: {
            status: 'read-and-idempotent-reset-write-validated-activation-unvalidated',
            lengthBytes: 1,
            dataType: 'uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
    A401: point({
        techniqueId: 'A401',
        name: 'RaumsollExternHK1',
        readCommand: 'getRaumsollExternHK1',
        writeCommand: 'setRaumsollExternHK1',
        access: 'externalRuntimeInput',
        strategy: 'preferred-heating-setpoint',
        unit: '°C',
    }),
    A403: point({
        techniqueId: 'A403',
        name: 'VorlaufsollExternHK1',
        readCommand: 'getVorlaufsollExternHK1',
        writeCommand: 'setVorlaufsollExternHK1',
        access: 'externalRuntimeInput',
        strategy: 'experimental-flow-setpoint',
        unit: '°C',
    }),
    A406: point({
        techniqueId: 'A406',
        name: 'RaumsollEffektivHK1',
        readCommand: 'getRaumsollEffektivHK1',
        access: 'readOnlyValidation',
        unit: '°C',
    }),
    A440: point({
        techniqueId: 'A440',
        name: 'BetriebsartExternHK2',
        readCommand: 'getBetriebsartExternHK2',
        writeCommand: 'setBetriebsartExternHK2',
        access: 'externalRuntimeCandidate',
        strategy: 'future-heating-mode-hk2',
        resetValue: 255,
        rawEncoding: {
            status: 'read-validated-write-unvalidated',
            lengthBytes: 1,
            dataType: 'uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
    A480: point({
        techniqueId: 'A480',
        name: 'BetriebsartExternHK3',
        readCommand: 'getBetriebsartExternHK3',
        writeCommand: 'setBetriebsartExternHK3',
        access: 'externalRuntimeCandidate',
        strategy: 'future-heating-mode-hk3',
        resetValue: 255,
        rawEncoding: {
            status: 'read-validated-write-unvalidated',
            lengthBytes: 1,
            dataType: 'uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
    A3C0: point({
        techniqueId: 'A3C0',
        name: 'WWSollExtern',
        readCommand: 'getWWSollExtern',
        writeCommand: 'setWWSollExtern',
        access: 'externalRuntimeInput',
        strategy: 'preferred-dhw-setpoint',
        unit: '°C',
    }),
    A3C2: point({
        techniqueId: 'A3C2',
        name: 'WWBetriebsartExtern',
        readCommand: 'getWWBetriebsartExtern',
        writeCommand: 'setWWBetriebsartExtern',
        access: 'externalRuntimeInput',
        strategy: 'preferred-dhw-mode',
        resetValue: 255,
        rawEncoding: {
            status: 'read-and-idempotent-reset-write-validated-activation-unvalidated',
            lengthBytes: 1,
            dataType: 'uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
    A3C5: point({
        techniqueId: 'A3C5',
        name: 'WWSollEffektiv',
        readCommand: 'getWWSollEffektiv',
        access: 'readOnlyValidation',
        unit: '°C',
    }),
    B020: point({
        techniqueId: 'B020',
        name: 'WWEinmal',
        readCommand: 'getWWEinmal',
        writeCommand: 'setWWEinmal',
        access: 'eventWriteCandidate',
        strategy: 'one-time-dhw',
        rawEncoding: {
            status: 'known-from-existing-definition-readback-pending',
            lengthBytes: 1,
            dataType: 'enum/uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
    B000: point({
        techniqueId: 'B000',
        name: 'Betriebsart',
        readCommand: 'getBetriebsart',
        writeCommand: 'setBetriebsart',
        access: 'legacyPersistenceUnknown',
        strategy: 'manual-compatibility-only',
        rawEncoding: {
            status: 'known-from-existing-definition-persistence-unknown',
            lengthBytes: 1,
            dataType: 'enum/uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
    A380: point({
        techniqueId: 'A380',
        name: 'AnlagenMindestleistungExtern',
        access: 'alwaysBlocked',
        strategy: 'research-only-high-priority',
    }),
    A382: point({
        techniqueId: 'A382',
        name: 'BetriebsmodusAnlageExtern',
        access: 'alwaysBlocked',
        strategy: 'future-research-only',
    }),
    A383: point({
        techniqueId: 'A383',
        name: 'VorlaufsollAnlageExtern',
        access: 'alwaysBlocked',
        strategy: 'future-research-only',
    }),
    '779C': point({
        techniqueId: '779C',
        name: 'ReceiveHeartbeatKonfiguration',
        access: 'readOnlyConfiguration',
        strategy: 'never-write',
        unit: 'min',
        rawEncoding: {
            status: 'read-validated',
            lengthBytes: 1,
            dataType: 'uchar',
            scaling: 1,
            endianness: 'not-applicable',
        },
    }),
});

const DIAGNOSTIC_STATES = Object.freeze([
    'info.runtimeControlAvailable',
    'info.runtimeControlValidated',
    'info.runtimeHeartbeatValidated',
    'info.runtimeControlActive',
    'info.runtimeControlMode',
    'info.lastRuntimeWrite',
    'info.lastRuntimeReadback',
    'info.runtimeWriteError',
    'info.optolinkConnected',
    'info.heatingOverrideActive',
    'info.dhwOverrideActive',
]);

const PERSISTENT_OR_FORBIDDEN_ADDRESSES = Object.freeze(new Set([
    '2000',
    '2001',
    '2006',
    '2007',
    '6000',
    '600C',
    '779C',
    'A380',
    'A382',
    'A383',
]));

function normalizeAddress(address) {
    if (typeof address !== 'string' && typeof address !== 'number') {
        return '';
    }
    return String(address).trim().replace(/^0x/i, '').toUpperCase().padStart(4, '0');
}

function isScheduleAddress(address) {
    const normalized = normalizeAddress(address);
    if (!/^[0-9A-F]{4}$/.test(normalized)) {
        return false;
    }
    const numeric = Number.parseInt(normalized, 16);
    // Four documented areas of 7 x 36-byte day blocks beginning at 0x1570.
    // The deliberately broad range is blocked for writes; it is not a claim
    // that every byte in the range is a schedule byte on every firmware.
    return numeric >= 0x1570 && numeric <= 0x195f;
}

module.exports = {
    DATAPOINTS,
    DIAGNOSTIC_STATES,
    PERSISTENT_OR_FORBIDDEN_ADDRESSES,
    isScheduleAddress,
    normalizeAddress,
};
