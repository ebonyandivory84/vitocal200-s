'use strict';

const {
    DATAPOINTS,
    PERSISTENT_OR_FORBIDDEN_ADDRESSES,
    isScheduleAddress,
    normalizeAddress,
} = require('./runtime-datapoints');

const DEFAULT_OPTIONS = Object.freeze({
    enableRuntimeExternalWrites: false,
    enableExperimentalFlowOverride: false,
    enableExperimentalPlantManager: false,
    enableHeartbeatRefresh: false,
    enableExpertHeatMode: false,
    enableOneTimeDhwWrites: false,
    enableLegacyB000Writes: false,
    roomSetpointMin: 18,
    roomSetpointMax: 24,
    dhwSetpointMin: 40,
    dhwSetpointMax: 50,
    flowSetpointMin: 20,
    flowSetpointMax: 45,
    minWriteIntervalMs: 1000,
    heartbeatIntervalMs: 60000,
});

const HARD_LIMITS = Object.freeze({
    A401: Object.freeze({ min: 10, max: 30 }),
    A403: Object.freeze({ min: 20, max: 45 }),
    A3C0: Object.freeze({ min: 0, max: 55 }),
});

class RuntimeWriteGuard {
    constructor(options = {}) {
        if (!options.transport || typeof options.transport.writeCommand !== 'function') {
            throw new TypeError('transport.writeCommand(commandName, value) is required');
        }

        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.transport = options.transport;
        this.now = options.now || Date.now;
        this.logger = options.logger || (() => {});
        this.hardwareAvailable = Boolean(options.hardwareAvailable);
        this.faulted = false;
        this.validatedReadbacks = new Map();
        this.lastSuccessfulWrite = new Map();
        this.lastValue = new Map();
        this.desiredValues = new Map();
        this.active = { heating: false, dhw: false };
        this.activeHeatingMode = null;
        this.lastHeartbeatRefresh = 0;

        this.#validateConfiguredBounds();
    }

    #validateConfiguredBounds() {
        const boundedOptions = [
            ['roomSetpointMin', 'roomSetpointMax', HARD_LIMITS.A401],
            ['dhwSetpointMin', 'dhwSetpointMax', HARD_LIMITS.A3C0],
            ['flowSetpointMin', 'flowSetpointMax', HARD_LIMITS.A403],
        ];
        for (const [minKey, maxKey, hard] of boundedOptions) {
            const min = this.options[minKey];
            const max = this.options[maxKey];
            if (!Number.isInteger(min) || !Number.isInteger(max) || min > max || min < hard.min || max > hard.max) {
                throw new RangeError(`${minKey}/${maxKey} must stay within ${hard.min}..${hard.max}`);
            }
        }
    }

    setHardwareAvailable(available) {
        this.hardwareAvailable = Boolean(available);
    }

    clearCommunicationFault() {
        this.faulted = false;
    }

    validateReadback(address, evidence) {
        const normalized = normalizeAddress(address);
        const point = DATAPOINTS[normalized];
        if (!point) {
            return this.#deny('UNKNOWN_ADDRESS', normalized);
        }
        if (!evidence || evidence.encodingConfirmed !== true) {
            return this.#deny('ENCODING_NOT_CONFIRMED', normalized);
        }
        if (!Number.isInteger(evidence.lengthBytes) || evidence.lengthBytes < 1) {
            return this.#deny('INVALID_ENCODING_EVIDENCE', normalized);
        }
        if (!evidence.dataType || evidence.scaling === undefined || !evidence.endianness) {
            return this.#deny('INVALID_ENCODING_EVIDENCE', normalized);
        }
        const sourceVerified = evidence.sourceVerified === true;
        const threeReads = Number.isInteger(evidence.consistentReads) && evidence.consistentReads >= 3;
        if (!sourceVerified && !threeReads) {
            return this.#deny('INSUFFICIENT_READBACKS', normalized);
        }
        this.validatedReadbacks.set(normalized, Object.freeze({ ...evidence }));
        return { ok: true, code: 'READBACK_VALIDATED', address: normalized };
    }

    revokeReadbackValidation(address) {
        this.validatedReadbacks.delete(normalizeAddress(address));
    }

    async write(address, value, context = {}) {
        const decision = this.authorize(address, value, context);
        if (!decision.ok) {
            return decision;
        }

        const { normalized, point, isReset } = decision;
        try {
            const transportResult = await this.transport.writeCommand(point.writeCommand, value);
            const timestamp = this.now();
            this.lastSuccessfulWrite.set(normalized, timestamp);
            this.lastValue.set(normalized, value);
            this.#updateRuntimeState(normalized, value);
            this.logger({ level: 'info', code: 'WRITE_OK', address: normalized, value, isReset });
            return {
                ok: true,
                code: 'WRITE_OK',
                address: normalized,
                command: point.writeCommand,
                value,
                transportResult,
            };
        } catch (error) {
            this.faulted = true;
            this.logger({ level: 'error', code: 'COMMUNICATION_FAILURE', address: normalized, value, error });
            return {
                ok: false,
                code: 'COMMUNICATION_FAILURE',
                address: normalized,
                error,
            };
        }
    }

    authorize(address, value, context = {}) {
        const normalized = normalizeAddress(address);

        if (isScheduleAddress(normalized)) {
            return this.#deny('SCHEDULE_WRITE_BLOCKED', normalized);
        }
        if (PERSISTENT_OR_FORBIDDEN_ADDRESSES.has(normalized)) {
            return this.#deny('ADDRESS_ALWAYS_BLOCKED', normalized);
        }

        const point = DATAPOINTS[normalized];
        if (!point || !point.writeCommand) {
            return this.#deny('UNKNOWN_OR_READ_ONLY_ADDRESS', normalized);
        }
        if (point.access === 'alwaysBlocked' || point.access === 'readOnlyConfiguration' || point.access === 'readOnlyValidation') {
            return this.#deny('ADDRESS_ALWAYS_BLOCKED', normalized);
        }
        if (this.faulted) {
            return this.#deny('COMMUNICATION_FAULT_LATCHED', normalized);
        }
        if (!this.hardwareAvailable) {
            return this.#deny('HARDWARE_UNAVAILABLE', normalized);
        }
        if (!this.validatedReadbacks.has(normalized)) {
            return this.#deny('READBACK_NOT_VALIDATED', normalized);
        }
        if (!Number.isInteger(value)) {
            return this.#deny('INTEGER_REQUIRED', normalized);
        }

        const isReset = point.resetValue === value;
        if (!isReset && context.inputsFresh === false) {
            return this.#deny('INPUTS_STALE', normalized);
        }
        if (!isReset) {
            const featureDecision = this.#checkFeatureFlags(normalized);
            if (featureDecision) {
                return featureDecision;
            }
        }

        const valueDecision = this.#checkValue(normalized, value);
        if (valueDecision) {
            return valueDecision;
        }

        const now = this.now();
        const lastWrite = this.lastSuccessfulWrite.get(normalized);
        const sameValue = this.lastValue.get(normalized) === value;
        if (!isReset && sameValue && context.forceRefresh !== true) {
            return this.#deny('DUPLICATE_SUPPRESSED', normalized);
        }
        if (!isReset && lastWrite !== undefined && now - lastWrite < this.options.minWriteIntervalMs) {
            return this.#deny('RATE_LIMITED', normalized);
        }

        return { ok: true, code: 'AUTHORIZED', normalized, point, isReset };
    }

    #checkFeatureFlags(address) {
        if (address.startsWith('A') && !this.options.enableRuntimeExternalWrites) {
            return this.#deny('RUNTIME_WRITES_DISABLED', address);
        }
        if (address === 'A403' && !this.options.enableExperimentalFlowOverride) {
            return this.#deny('FLOW_OVERRIDE_DISABLED', address);
        }
        if (address === 'B020' && !this.options.enableOneTimeDhwWrites) {
            return this.#deny('ONE_TIME_DHW_WRITES_DISABLED', address);
        }
        if (address === 'B000' && !this.options.enableLegacyB000Writes) {
            return this.#deny('LEGACY_B000_WRITES_DISABLED', address);
        }
        return null;
    }

    #checkValue(address, value) {
        switch (address) {
            case 'A400':
                if (value === 13 || value === 255) return null;
                if (value === 1 && this.options.enableExpertHeatMode) return null;
                if (value === 100 && this.options.enableExperimentalFlowOverride) return null;
                return this.#deny('VALUE_NOT_WHITELISTED', address);
            case 'A401':
                return this.#checkRange(address, value, this.options.roomSetpointMin, this.options.roomSetpointMax);
            case 'A403':
                return this.#checkRange(address, value, this.options.flowSetpointMin, this.options.flowSetpointMax);
            case 'A3C2':
                return value === 1 || value === 255 ? null : this.#deny('VALUE_NOT_WHITELISTED', address);
            case 'A3C0':
                return this.#checkRange(address, value, this.options.dhwSetpointMin, this.options.dhwSetpointMax);
            case 'B020':
                return value === 0 || value === 2 ? null : this.#deny('VALUE_NOT_WHITELISTED', address);
            case 'B000':
                return value === 0 || value === 1 || value === 2 ? null : this.#deny('VALUE_NOT_WHITELISTED', address);
            default:
                return this.#deny('UNKNOWN_OR_READ_ONLY_ADDRESS', address);
        }
    }

    #checkRange(address, value, configuredMin, configuredMax) {
        const hard = HARD_LIMITS[address];
        if (value < hard.min || value > hard.max) {
            return this.#deny('HARD_LIMIT_EXCEEDED', address);
        }
        if (value < configuredMin || value > configuredMax) {
            return this.#deny('CONFIGURED_LIMIT_EXCEEDED', address);
        }
        return null;
    }

    async activateHeatingRoomSetpoint(roomSetpoint, mode = 13) {
        const setpoint = await this.write('A401', roomSetpoint, { reason: 'activate-heating' });
        if (!setpoint.ok) return [setpoint];
        const modeResult = await this.write('A400', mode, { reason: 'activate-heating' });
        return [setpoint, modeResult];
    }

    async activateHeatingFlowSetpoint(flowSetpoint) {
        const setpoint = await this.write('A403', flowSetpoint, { reason: 'activate-flow-override' });
        if (!setpoint.ok) return [setpoint];
        const modeResult = await this.write('A400', 100, { reason: 'activate-flow-override' });
        return [setpoint, modeResult];
    }

    async activateDhw(dhwSetpoint) {
        const setpoint = await this.write('A3C0', dhwSetpoint, { reason: 'activate-dhw' });
        if (!setpoint.ok) return [setpoint];
        const modeResult = await this.write('A3C2', 1, { reason: 'activate-dhw' });
        return [setpoint, modeResult];
    }

    async refreshActiveOverrides() {
        if (!this.options.enableHeartbeatRefresh) {
            return [{ ok: false, code: 'HEARTBEAT_REFRESH_DISABLED' }];
        }
        if (!this.active.heating && !this.active.dhw) {
            return [{ ok: false, code: 'NO_ACTIVE_OVERRIDE' }];
        }
        const now = this.now();
        if (this.lastHeartbeatRefresh && now - this.lastHeartbeatRefresh < this.options.heartbeatIntervalMs) {
            return [{ ok: false, code: 'HEARTBEAT_NOT_DUE' }];
        }

        const results = [];
        if (this.active.heating) {
            const setpointAddress = this.activeHeatingMode === 100 ? 'A403' : 'A401';
            const setpointValue = this.desiredValues.get(setpointAddress);
            if (setpointValue === undefined) {
                return [{ ok: false, code: 'ACTIVE_SETPOINT_MISSING', address: setpointAddress }];
            }
            results.push(await this.write(setpointAddress, setpointValue, { forceRefresh: true, reason: 'heartbeat' }));
            if (!results.at(-1).ok) return results;
            results.push(await this.write('A400', this.activeHeatingMode, { forceRefresh: true, reason: 'heartbeat' }));
            if (!results.at(-1).ok) return results;
        }
        if (this.active.dhw) {
            const setpointValue = this.desiredValues.get('A3C0');
            if (setpointValue === undefined) {
                return [...results, { ok: false, code: 'ACTIVE_SETPOINT_MISSING', address: 'A3C0' }];
            }
            results.push(await this.write('A3C0', setpointValue, { forceRefresh: true, reason: 'heartbeat' }));
            if (!results.at(-1).ok) return results;
            results.push(await this.write('A3C2', 1, { forceRefresh: true, reason: 'heartbeat' }));
            if (!results.at(-1).ok) return results;
        }
        this.lastHeartbeatRefresh = now;
        return results;
    }

    async handleStaleInputs() {
        return this.returnToInternalControl('stale-inputs');
    }

    async shutdown() {
        return this.returnToInternalControl('shutdown');
    }

    async returnToInternalControl(reason = 'manual-disable') {
        const results = [];
        if (this.active.heating) {
            results.push(await this.write('A400', 255, { reason }));
            if (!results.at(-1).ok) return results;
        }
        if (this.active.dhw) {
            results.push(await this.write('A3C2', 255, { reason }));
        }
        return results;
    }

    snapshot() {
        return {
            hardwareAvailable: this.hardwareAvailable,
            faulted: this.faulted,
            active: { ...this.active },
            activeHeatingMode: this.activeHeatingMode,
            validatedAddresses: [...this.validatedReadbacks.keys()],
            runtimeControlAvailable: this.hardwareAvailable && !this.faulted,
            runtimeControlValidated: ['A400', 'A401', 'A3C0', 'A3C2'].every(address =>
                this.validatedReadbacks.has(address),
            ),
            runtimeHeartbeatValidated: false,
        };
    }

    #updateRuntimeState(address, value) {
        if (address === 'A401' || address === 'A403' || address === 'A3C0') {
            this.desiredValues.set(address, value);
        }
        if (address === 'A400') {
            this.active.heating = value !== 255;
            this.activeHeatingMode = value === 255 ? null : value;
        }
        if (address === 'A3C2') {
            this.active.dhw = value === 1;
        }
    }

    #deny(code, address) {
        return { ok: false, code, address };
    }
}

module.exports = {
    DEFAULT_OPTIONS,
    HARD_LIMITS,
    RuntimeWriteGuard,
};
