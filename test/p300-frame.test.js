'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeP300WriteFrame, toHex } = require('../lib/p300-frame');

test('encodes the source-verified one-byte P300 runtime frames', () => {
    assert.equal(toHex(encodeP300WriteFrame('A400', 13)), '41 06 00 02 A4 00 01 0D BA');
    assert.equal(toHex(encodeP300WriteFrame('A400', 255)), '41 06 00 02 A4 00 01 FF AC');
    assert.equal(toHex(encodeP300WriteFrame('A3C2', 1)), '41 06 00 02 A3 C2 01 01 6F');
    assert.equal(toHex(encodeP300WriteFrame('A3C2', 255)), '41 06 00 02 A3 C2 01 FF 6D');
    assert.equal(toHex(encodeP300WriteFrame('A440', 255)), '41 06 00 02 A4 40 01 FF EC');
    assert.equal(toHex(encodeP300WriteFrame('A480', 255)), '41 06 00 02 A4 80 01 FF 2C');
});

test('encodes the restored manual compatibility commands', () => {
    assert.equal(toHex(encodeP300WriteFrame('B000', 2)), '41 06 00 02 B0 00 01 02 BB');
    assert.equal(toHex(encodeP300WriteFrame('B020', 2)), '41 06 00 02 B0 20 01 02 DB');
});

test('rejects malformed addresses and out-of-range bytes', () => {
    assert.throws(() => encodeP300WriteFrame('A40', 13), /four hexadecimal/);
    assert.throws(() => encodeP300WriteFrame('A400', 256), /range 0\.\.255/);
    assert.throws(() => encodeP300WriteFrame('A400', []), /one or more bytes/);
});
