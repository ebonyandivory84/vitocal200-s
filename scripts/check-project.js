'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const vito = fs.readFileSync(path.join(root, 'config', 'vito.xml'), 'utf8');
const vcontrold = fs.readFileSync(path.join(root, 'config', 'vcontrold.xml'), 'utf8');
const polling = JSON.parse(fs.readFileSync(path.join(root, 'config', 'iobroker-polling.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const activeVito = vito.replace(/<!--[\s\S]*?-->/g, '');
const failures = [];

function fail(message) {
    failures.push(message);
}

const backportPatchPath = path.join(root, 'adapter-patches', 'ioBroker.viessmann-1.7.4-human-readable.patch');
const backportPackagePath = path.join(
    root,
    'adapter-patches',
    'iobroker.viessmann-1.7.4-vitocal-backport.tgz',
);
const expectedBackportSha256 = '33eea4d09e11228a8463763702cc320ac6a92b19cd4846e8cd3b7d8688166198';
const overviewPath = path.join(root, 'VITOCAL_200S_VCONTROLD_IOBROKER_UEBERSICHT.md');
const overviewGeneratorPath = path.join(root, 'scripts', 'generate-system-overview.js');
if (!fs.existsSync(overviewGeneratorPath)) {
    fail('Missing system overview generator');
}
if (packageJson.scripts?.['docs:overview'] !== 'node scripts/generate-system-overview.js') {
    fail('package.json must expose the docs:overview generator');
}
if (!fs.existsSync(overviewPath)) {
    fail('Missing central Vitocal system overview');
} else {
    const overview = fs.readFileSync(overviewPath, 'utf8');
    for (const requiredOverviewFragment of [
        '## 3. Sicherheitsmodell: kein EEPROM-Schreibweg',
        '## 4. Schreibbare ioBroker-Datenpunkte',
        'viessmann.0.set.BetriebsartExternHK1',
        'viessmann.0.set.RaumsollExternHK1',
        'viessmann.0.set.VorlaufsollExternHK1',
        'viessmann.0.set.WWBetriebsartExtern',
        'viessmann.0.set.WWSollExtern',
        '## 8. Vollständiger aktiver `viessmann.0.get`-Katalog',
        '## 9. Forschungs- und Hilfskommandos',
    ]) {
        if (!overview.includes(requiredOverviewFragment)) {
            fail(`Central system overview is missing: ${requiredOverviewFragment}`);
        }
    }
}
if (!fs.existsSync(backportPatchPath)) {
    fail('Missing ioBroker.viessmann 1.7.4 source patch');
} else if (!fs.readFileSync(backportPatchPath, 'utf8').includes('diff --git a/main.js b/main.js')) {
    fail('ioBroker.viessmann 1.7.4 source patch does not contain main.js changes');
}
if (!fs.existsSync(backportPackagePath)) {
    fail('Missing packaged ioBroker.viessmann 1.7.4 backport');
} else {
    const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(backportPackagePath)).digest('hex');
    if (actualSha256 !== expectedBackportSha256) {
        fail(`Packaged ioBroker.viessmann 1.7.4 checksum mismatch: ${actualSha256}`);
    }
}

function commandBlock(name) {
    return (
        activeVito.match(new RegExp(`<command\\s+[^>]*name=["']${name}["'][^>]*>[\\s\\S]*?<\\/command>`, 'i'))?.[0] ||
        ''
    );
}

function unitBlock(abbrev) {
    const units = [...vcontrold.matchAll(/<unit\b[^>]*>[\s\S]*?<\/unit>/gi)];
    return units.find(match => new RegExp(`<abbrev>\\s*${abbrev}\\s*<\\/abbrev>`, 'i').test(match[0]))?.[0] || '';
}

function attributeValue(attributes, name) {
    return attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];
}

function expectCommand(name, expected) {
    const block = commandBlock(name);
    if (!block) {
        fail(`Missing command ${name}`);
        return;
    }

    for (const [element, value] of Object.entries(expected.elements || {})) {
        if (!new RegExp(`<${element}>\\s*${value}\\s*<\\/${element}>`, 'i').test(block)) {
            fail(`${name} must use <${element}>${value}</${element}>`);
        }
    }
    for (const [attribute, value] of Object.entries(expected.attributes || {})) {
        if (!new RegExp(`${attribute}=["']${value}["']`, 'i').test(block)) {
            fail(`${name} must use ${attribute}="${value}"`);
        }
    }
}

if (/protocmd=["'](?:seteeprom|EEPROM_WRITE)["']/i.test(activeVito)) {
    fail('Active EEPROM write command found in config/vito.xml');
}

const activeSetCommands = [...activeVito.matchAll(/<command\s+[^>]*name=["'](set[^"']+)["'][^>]*>/gi)].map(
    match => match[1],
);
const allowedSetCommands = [
    'setBetriebsart',
    'setWWEinmal',
    'setBetriebsartExternHK1',
    'setRaumsollExternHK1',
    'setVorlaufsollExternHK1',
    'setWWBetriebsartExtern',
    'setWWSollExtern',
];
if (
    activeSetCommands.length !== allowedSetCommands.length ||
    allowedSetCommands.some(name => !activeSetCommands.includes(name))
) {
    fail(`Only the explicitly guarded writes may remain active: ${allowedSetCommands.join(', ')}`);
}

expectCommand('setBetriebsart', {
    elements: { addr: 'B000', len: '1', unit: 'BAS' },
    attributes: { protocmd: 'setaddr' },
});
expectCommand('setWWEinmal', {
    elements: { addr: 'B020', len: '1', unit: 'WWO' },
    attributes: { protocmd: 'setaddr' },
});
expectCommand('setBetriebsartExternHK1', {
    elements: { addr: 'A400', len: '1', unit: 'RT' },
    attributes: { protocmd: 'setaddr', iobrokerRole: 'level.mode' },
});
expectCommand('setRaumsollExternHK1', {
    elements: { addr: 'A401', len: '1', unit: 'UTI' },
    attributes: {
        protocmd: 'setaddr',
        iobrokerRole: 'level.temperature',
        iobrokerMin: '18',
        iobrokerMax: '24',
    },
});
expectCommand('setVorlaufsollExternHK1', {
    elements: { addr: 'A403', len: '1', unit: 'UTI' },
    attributes: {
        protocmd: 'setaddr',
        iobrokerRole: 'level.temperature',
        iobrokerMin: '20',
        iobrokerMax: '45',
    },
});
expectCommand('setWWBetriebsartExtern', {
    elements: { addr: 'A3C2', len: '1', unit: 'RT' },
    attributes: { protocmd: 'setaddr', iobrokerRole: 'level.mode' },
});
expectCommand('setWWSollExtern', {
    elements: { addr: 'A3C0', len: '1', unit: 'UTI' },
    attributes: {
        protocmd: 'setaddr',
        iobrokerRole: 'level.temperature',
        iobrokerMin: '40',
        iobrokerMax: '50',
    },
});

for (const match of activeVito.matchAll(/<len>([\s\S]*?)<\/len>/gi)) {
    const value = match[1].trim();
    if (!/^\d+$/.test(value) || Number(value) < 1) {
        fail(`Every active <len> must be a positive integer; found "${value}"`);
    }
}

const efficiencyRegisters = {
    getJAZ: { addr: '1680', len: '1', unit: 'U10' },
    getJAZHeiz: { addr: '1681', len: '1', unit: 'U10' },
    getJAZWW: { addr: '1682', len: '1', unit: 'U10' },
    getCOPHeiz: { addr: '1690', len: '2', unit: 'S10' },
};
for (const [name, elements] of Object.entries(efficiencyRegisters)) {
    expectCommand(name, { elements });
}

expectCommand('getEnergieFaktor', {
    elements: { addr: '163F', len: '1', unit: 'CO' },
});
const energyAliases = {
    getEnergieThermischHeizenKWh: '1640',
    getEnergieThermischWWKWh: '1650',
    getEnergieElektrischHeizenKWh: '1660',
    getEnergieElektrischWWKWh: '1670',
};
for (const [name, addr] of Object.entries(energyAliases)) {
    expectCommand(name, {
        elements: { addr, len: '4', unit: 'CO' },
        attributes: {
            iobrokerRole: 'value.energy',
            iobrokerUnit: 'kWh',
            iobrokerFactorState: 'EnergieFaktor',
            iobrokerFactorMultiplier: '0.1',
        },
    });
}

expectCommand('getLeistungThermischHeizen', {
    elements: { addr: '16A0', len: '4', unit: 'PW' },
});
expectCommand('getLeistungThermischWW', {
    elements: { addr: '16A1', len: '4', unit: 'PW' },
});
expectCommand('getLeistungElektrischVerdichter', {
    elements: { addr: '16A4', len: '4', unit: 'PW' },
});
expectCommand('getLeistungHeizstab', {
    elements: { addr: '1909', len: '1', unit: 'PW3K' },
    attributes: { iobrokerRole: 'value.power' },
});

for (const [suffix, addr] of [
    ['DrehzahlLuefterVerdichter', 'B420'],
    ['DrehzahlSekundaerpumpe', 'B421'],
    ['DrehzahlWarmwasserpumpe', 'B422'],
]) {
    expectCommand(`get${suffix}`, { elements: { addr, len: '2', unit: 'PSB0' } });
}
expectCommand('getLeistungVerdichterRaw', { elements: { addr: 'B423', len: '2', unit: 'PSB0' } });
expectCommand('getAnlagenIstleistungProzent', {
    elements: { addr: 'A38F', len: '2', unit: 'PHB0' },
    attributes: { iobrokerRole: 'value' },
});
expectCommand('getStatusAnlagenIstleistung', {
    elements: { addr: 'A38F', len: '2', unit: 'SSB1' },
    attributes: { iobrokerRole: 'indicator' },
});
expectCommand('getStellungExpansionsventilRaw', { elements: { addr: 'B424', len: '2', unit: 'PSB0' } });

const requiredUnits = {
    U10: ["<calc get='V/10'", '<type>uchar</type>'],
    UTI: ["<calc get='V' set='V'", '<type>uchar</type>', '<entity>°C</entity>'],
    S10: ["<calc get='V/10'", '<type>short</type>'],
    CS: ["<calc get='V/3600'", '<entity>h</entity>'],
    PW3K: ["<calc get='V*3000'", '<entity>W</entity>'],
    PSB0: ["<calc get='B0'", '<type>ushort</type>'],
    PHB0: ["<calc get='B0/2'", '<entity>%</entity>'],
    SSB1: ["<calc get='B1'", '<type>ushort</type>'],
};
for (const [abbrev, fragments] of Object.entries(requiredUnits)) {
    const block = unitBlock(abbrev);
    if (!block) {
        fail(`Missing vcontrold unit ${abbrev}`);
        continue;
    }
    for (const fragment of fragments) {
        if (!block.includes(fragment)) {
            fail(`vcontrold unit ${abbrev} is missing ${fragment}`);
        }
    }
}

const readableStateNames = new Set();
for (const match of activeVito.matchAll(/<command\b([^>]*)>/gi)) {
    const commandName = attributeValue(match[1], 'name');
    if (!commandName?.startsWith('get')) {
        continue;
    }
    readableStateNames.add(attributeValue(match[1], 'iobrokerName') || commandName.slice(3));
}
for (const [name, interval] of Object.entries(polling)) {
    if (!readableStateNames.has(name)) {
        fail(`Polling profile references unknown read state ${name}`);
    }
    if (!Number.isInteger(interval) || interval < -1 || interval === 0) {
        fail(`Polling interval for ${name} must be -1 or a positive integer`);
    }
}

const pollingOrder = Object.keys(polling);
for (const energyState of [
    'EnergieThermischHeizenKWh',
    'EnergieThermischWWKWh',
    'EnergieElektrischHeizenKWh',
    'EnergieElektrischWWKWh',
]) {
    if (!(polling[energyState] > 0)) {
        fail(`${energyState} must be enabled in the productive polling profile`);
    }
    if (pollingOrder.indexOf('EnergieFaktor') > pollingOrder.indexOf(energyState)) {
        fail(`EnergieFaktor must appear before ${energyState} in the polling profile`);
    }
}
for (const rawEnergyState of [
    'EnergieThermischHeizen',
    'EnergieThermischWW',
    'EnergieElektrischHeizen',
    'EnergieElektrischWW',
]) {
    if (polling[rawEnergyState] !== -1) {
        fail(`${rawEnergyState} must remain disabled when its kWh alias is polled`);
    }
}
for (const heaterState of ['LeistungHeizstab', 'StatusHeizstabSt1', 'StatusHeizstabSt2']) {
    if (!(polling[heaterState] >= 5 && polling[heaterState] <= 15)) {
        fail(`${heaterState} must be polled every 5 to 15 seconds`);
    }
}
for (const rawState of [
    'AnlagennameRaw',
    'InbetriebnahmeDatumRaw',
    'SystemStatusRaw',
    'MeldungenAnlageRaw',
    'MeldungenVerdichter1Raw',
    'MeldungenVerdichterRaw',
    'LetzteMeldungRaw',
]) {
    if (polling[rawState] !== -1) {
        fail(`${rawState} must remain disabled by default`);
    }
}

if (!vcontrold.includes('<command>SEND 00 02</command>')) {
    fail('P300 SETADDR macro is not SEND 00 02');
}
if (unitBlock('RT').includes('<type>enum</type>')) {
    fail('ReturnStatus must be numeric; enum strings are rejected by ioBroker after numeric parsing');
}
if (unitBlock('WWO').includes('<type>enum</type>')) {
    fail('SafeOneTimeDHW must be numeric; enum strings are rejected by ioBroker after numeric parsing');
}
if (fs.existsSync(backportPatchPath)) {
    const backportPatch = fs.readFileSync(backportPatchPath, 'utf8');
    for (const requiredGuardFragment of [
        'WRITE_POLICIES',
        "state.ack === true",
        'COMMAND_NOT_WHITELISTED',
        'ADDRESS_POLICY_MISMATCH',
        'VALUE_OUTSIDE_SAFE_RANGE',
        'VALUE_TYPE_NOT_SUPPORTED',
        'MIN_SET_INTERVAL_MS',
    ]) {
        if (!backportPatch.includes(requiredGuardFragment)) {
            fail(`Adapter backport is missing guarded write fragment: ${requiredGuardFragment}`);
        }
    }
}
const p300Protocol = vcontrold.match(/<protocol name=["']P300["']>([\s\S]*?)<\/protocol>/);
if (p300Protocol && p300Protocol[1].includes('<command>SEND 01 F4</command>')) {
    fail('Invalid KW SETADDR macro active inside P300 protocol');
}

if (failures.length) {
    for (const failure of failures) {
        console.error(`FAIL: ${failure}`);
    }
    process.exitCode = 1;
} else {
    console.log('Project safety checks passed.');
}
