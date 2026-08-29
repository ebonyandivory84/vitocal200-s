'use strict';

function parseAddress(address) {
    if (typeof address !== 'string' || !/^[0-9A-Fa-f]{4}$/.test(address)) {
        throw new TypeError('P300 address must contain exactly four hexadecimal characters');
    }
    return [Number.parseInt(address.slice(0, 2), 16), Number.parseInt(address.slice(2), 16)];
}

function normalizeBytes(value) {
    const bytes = Array.isArray(value) ? value : [value];
    if (!bytes.length || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) {
        throw new RangeError('P300 payload must contain one or more bytes in the range 0..255');
    }
    return bytes;
}

function checksum(bytes) {
    return bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0);
}

function encodeP300WriteFrame(address, value) {
    const [addressHigh, addressLow] = parseAddress(address);
    const data = normalizeBytes(value);
    const payload = [0x00, 0x02, addressHigh, addressLow, data.length, ...data];
    const length = payload.length;
    return [0x41, length, ...payload, checksum([length, ...payload])];
}

function toHex(bytes) {
    return bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

module.exports = {
    checksum,
    encodeP300WriteFrame,
    toHex,
};
