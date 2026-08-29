'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vitoPath = path.join(root, 'config', 'vito.xml');
const vcontroldPath = path.join(root, 'config', 'vcontrold.xml');
const pollingPath = path.join(root, 'config', 'iobroker-polling.json');
const outputPath = path.join(root, 'VITOCAL_200S_VCONTROLD_IOBROKER_UEBERSICHT.md');

const vito = fs.readFileSync(vitoPath, 'utf8');
const vcontrold = fs.readFileSync(vcontroldPath, 'utf8');
const polling = JSON.parse(fs.readFileSync(pollingPath, 'utf8'));
const activeVito = vito.replace(/<!--[\s\S]*?-->/g, '');

function decodeXml(value = '') {
    return String(value)
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function parseAttributes(source = '') {
    const result = {};
    for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        result[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
    }
    return result;
}

function element(source, name) {
    const match = source.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return match ? decodeXml(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function markdownCell(value) {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized.replace(/\|/g, '\\|') || '—';
}

function code(value) {
    return value ? `\`${String(value).replace(/`/g, '')}\`` : '—';
}

function resolvedType(unit) {
    switch (unit?.type) {
        case 'char':
        case 'uchar':
        case 'int':
        case 'uint':
        case 'short':
        case 'ushort':
        case 'long':
        case 'ulong':
        case 'float':
        case 'double':
            return 'Number';
        case 'enum':
        case 'systime':
        case 'cycletime':
        case 'errstate':
            return 'String';
        default:
            return 'Mixed/String';
    }
}

function inferRole(name, unit, type) {
    if (unit === '°C') return 'value.temperature';
    if (unit === 'W') return 'value.power';
    if (unit === 'kWh') return 'value.energy';
    if (unit === 'Hz') return 'value.frequency';
    if (unit === 'bar') return 'value.pressure';
    if (unit === 'h') return 'value.interval';
    if (/^(Status|Freigabe)/.test(name)) return 'indicator';
    if (type === 'String') return 'text';
    return 'value';
}

function categoryFor(point) {
    const text = `${point.stateName} ${point.description}`.toLowerCase();
    if (/energie|leistung|jaz|cop|arbeitszahl|energiefaktor/.test(text)) return 'Leistung, Energie und Effizienz';
    if (/heizstab|elektroheiz|zusatzheiz|nachheiz|evu/.test(text)) return 'Heizstab und elektrische Zusatzheizung';
    if (/warmwasser|ww|speicher|zirkulation/.test(text)) return 'Warmwasser';
    if (/verdichter|kaeltekreis|kältekreis|sauggas|heissgas|heißgas|verdampf|kondens|expansionsventil|fluessiggas|flüssiggas/.test(text)) {
        return 'Verdichter und Kältekreis';
    }
    if (/pumpe|ventil|luefter|lüfter|aktor|mischer/.test(text)) return 'Pumpen, Ventile und Aktoren';
    if (/heizkreis|hk1|hk2|hk3|raum|vorlauf|ruecklauf|rücklauf|kennlinie|betriebsart/.test(text)) {
        return 'Heizkreise und Anlagenbetrieb';
    }
    if (/solar|kuehl|kühl/.test(text)) return 'Solar und Kühlung';
    if (/laufzeit|betriebsstund|starts|anzahl|zaehler|zähler/.test(text)) return 'Laufzeiten und Zähler';
    if (/meldung|fehler|statussensor|diagnose|rohbyte|raw/.test(text)) return 'Diagnose und Rohdaten';
    return 'Allgemein, Identifikation und Konfiguration';
}

const units = {};
for (const match of vcontrold.matchAll(/<unit\b[^>]*>([\s\S]*?)<\/unit>/gi)) {
    const body = match[1];
    const abbrev = element(body, 'abbrev');
    if (!abbrev) continue;
    units[abbrev] = {
        type: element(body, 'type'),
        entity: element(body, 'entity'),
        calc: parseAttributes(body.match(/<calc\b([^>]*)\/?\s*>/i)?.[1] || ''),
    };
}

const commands = [];
for (const match of activeVito.matchAll(/<command\b([^>]*)>([\s\S]*?)<\/command>/gi)) {
    const attrs = parseAttributes(match[1]);
    const body = match[2];
    const command = attrs.name || '';
    const unitKey = element(body, 'unit');
    const unit = units[unitKey] || {};
    const prefix = command.startsWith('get') ? 'get' : command.startsWith('set') ? 'set' : 'other';
    const defaultName = prefix === 'get' || prefix === 'set' ? command.slice(3) : command;
    const stateName = attrs.iobrokerName || defaultName;
    const outputUnit = attrs.iobrokerUnit ?? unit.entity ?? '';
    const type = resolvedType(unit);
    let states;
    if (attrs.iobrokerStates) {
        try {
            states = JSON.parse(attrs.iobrokerStates);
        } catch {
            states = undefined;
        }
    }
    commands.push({
        command,
        prefix,
        stateName,
        address: element(body, 'addr').toUpperCase(),
        length: element(body, 'len'),
        protocolCommand: attrs.protocmd || '',
        unitKey,
        unit: outputUnit,
        type,
        role: attrs.iobrokerRole || inferRole(stateName, outputUnit, type),
        min: attrs.iobrokerMin,
        max: attrs.iobrokerMax,
        states,
        description: attrs.description || element(body, 'description') || 'Keine Beschreibung in vito.xml',
    });
}

const gets = commands.filter(point => point.prefix === 'get');
const sets = commands.filter(point => point.prefix === 'set');
const research = commands.filter(point => point.prefix === 'other');

function pollingText(name) {
    const interval = polling[name];
    if (interval === -1) return 'aus (`-1`)';
    if (Number.isInteger(interval) && interval > 0) return `${interval} s`;
    return 'nicht im Profil';
}

function statesText(states) {
    if (!states) return '';
    return Object.entries(states)
        .map(([value, label]) => `${value}=${label}`)
        .join('; ');
}

const writePolicies = {
    setBetriebsart: {
        values: '`0`, `1`, `2`',
        input: 'Number oder numerischer String; Boolean/Objekt/Array verboten',
        effect: 'Legacy-Betriebsart: 0 Abschaltbetrieb, 1 nur Warmwasser, 2 Heizen und Warmwasser.',
        reset: 'Kein definierter RAM-Reset; Persistenz unbekannt. Nicht für PV-Automation verwenden.',
    },
    setWWEinmal: {
        values: '`0`, `2`',
        input: 'Number oder numerischer String; Boolean/Objekt/Array verboten',
        effect: '0 normal/abbrechen, 2 einmalige Warmwasserbereitung starten.',
        reset: 'Ereignis-/Kompatibilitätswert; nicht zyklisch schreiben.',
    },
    setBetriebsartExternHK1: {
        values: '`1`, `13`, `100`, `255`',
        input: 'Number oder numerischer String; nur ganzzahlig',
        effect: '1 externer Raum-Sollwert/Normal, 13 Economy/reduziert, 100 externer Vorlauf-Sollwert, 255 interne Regelung.',
        reset: '`255` gibt HK1 an die interne Regelung zurück.',
    },
    setRaumsollExternHK1: {
        values: 'ganzzahlig `18..24` °C',
        input: 'Number oder numerischer String; Boolean/Dezimalzahl verboten',
        effect: 'Externer Raum-Sollwert für HK1; wirksam zusammen mit A400=1 oder A400=13.',
        reset: 'Wird durch A400=255 unwirksam; kein eigener Resetwert.',
    },
    setVorlaufsollExternHK1: {
        values: 'ganzzahlig `20..45` °C',
        input: 'Number oder numerischer String; Boolean/Dezimalzahl verboten',
        effect: 'Direkter externer HK1-Vorlauf-Sollwert; wirksam mit A400=100.',
        reset: 'Experimenteller stärkerer Override; durch A400=255 beenden.',
    },
    setWWBetriebsartExtern: {
        values: '`1`, `255`',
        input: 'Number oder numerischer String; nur ganzzahlig',
        effect: '1 Warmwasser mit externem Sollwert, 255 interne Warmwasserregelung.',
        reset: '`255` beendet die externe WW-Anforderung; Heizstabstatus dabei überwachen.',
    },
    setWWSollExtern: {
        values: 'ganzzahlig `40..50` °C',
        input: 'Number oder numerischer String; Boolean/Dezimalzahl verboten',
        effect: 'Externer Warmwasser-Sollwert; wirksam mit A3C2=1.',
        reset: 'Wird durch A3C2=255 unwirksam; kein eigener Resetwert.',
    },
};

const lines = [];
const push = (...values) => lines.push(...values);

push(
    '# Vitocal 200-S: vcontrold-, Optolink- und ioBroker-Gesamtdokumentation',
    '',
    '**Stand:** 29. August 2026  ',
    '**Anlage:** Viessmann Vitocal 200-S AWB-E-AC 201.D08, Vitotronic 200 Typ WO1C  ',
    '**Geräte-/Steuerungs-ID:** `204D` (live bestätigt)  ',
    '**Seriennummer:** `7745669904294110`, Baujahr 2019  ',
    '**ioBroker-Instanz:** `viessmann.0`, gepatchter Adapter `iobroker.viessmann` 1.7.4 unter Node.js 20  ',
    '',
    '> Diese Datei ist die zentrale Übersicht. Die XML-Dateien bleiben die technische Wahrheit. Nicht jede dokumentierte Viessmann-Technik-ID ist bei direktem Optolink-Zugriff automatisch lesbar oder garantiert flüchtig.',
    '',
    '## 1. Ziel und Architektur',
    '',
    'Ziel ist eine möglichst vollständige, verständliche und sichere Auswertung der Wärmepumpe sowie eine spätere PV-geführte Runtime-Steuerung ohne zyklische EEPROM-Schreibvorgänge.',
    '',
    '```text',
    'Vitocal 200-S / WO1C (ID 204D)',
    '        │ Optolink / CP2102',
    '        ▼',
    'vcontrold mit vito.xml + vcontrold.xml, TCP-Port 3002',
    '        │ get... / streng begrenzte set...-Kommandos',
    '        ▼',
    'ioBroker Adapter viessmann.0',
    '        │',
    '        ├── viessmann.0.get.*  Mess-, Status- und Diagnosewerte',
    '        └── viessmann.0.set.*  sieben explizit freigegebene Schreibpunkte',
    '```',
    '',
    'Repository: `https://github.com/ebonyandivory84/vitocal200-s`  ',
    'Ergänzendes Smart-Heating-Repository: `https://github.com/ebonyandivory84/SmartHeating`',
    '',
    '## 2. Was bisher umgesetzt und geprüft wurde',
    '',
    '- Die Geräte-ID wurde real als `204D` bestätigt; fremde XML-Definitionen werden nicht blind übernommen.',
    '- Funktionierende Bestandsadressen wurden nicht ersetzt. Neue Punkte werden nur ergänzend aufgenommen.',
    '- Temperaturen, Laufzeiten, Druck, Prozentwerte, Leistung, Energie, Sensorstatus und Rohstrings werden typgerecht an ioBroker übergeben.',
    '- Die Energiezähler `1640`, `1650`, `1660` und `1670` werden mit dem Gerätefaktor `163F` in kWh umgerechnet.',
    '- `16A0`, `16A1` und `16A4` werden als momentane Leistung in Watt dargestellt.',
    '- Heizstaberkennung erfolgt über `0488`, `0489`, `048A` und ergänzend `1909` statt über den Hausgesamtverbrauch allein.',
    '- Mehrbyte-Adressen `B420` bis `B424` werden in Nutzwert und Sensorstatus getrennt.',
    '- `A38F` wurde dreimal live gelesen und als Anlagen-Istleistung in Prozent plus Anlagenstatus aufgenommen.',
    '- Die Kandidaten `0400`, `0404` und `5525` lieferten jeweils reproduzierbar Fehlercode 1 und wurden nicht übernommen.',
    '- `A400`, `A3C2`, `A440`, `A480` und `779C` wurden als Ein-Byte-Reads bestätigt.',
    '- Direkte Reads auf `A401`, `A403`, `A406`, `A3C0` und `A3C5` lieferten Fehlercode 4; diese werden deshalb nicht als funktionierende normale Lesestates ausgegeben.',
    '- Am 27. August 2026 wurden ausschließlich die neutralen Schreibwerte `A400=255` und `A3C2=255` real gesendet. Beide wurden mit `OK` bestätigt und als `255` zurückgelesen; Verdichter und Heizstab blieben aus.',
    '- Der Adapter 1.7.4 wurde zurückportiert: Metadaten, Einheiten, Rollen, Zustände, String-Erhalt, Energiefaktoren und geschützte Writes sind lokal getestet und am 29. August 2026 produktiv deployt.',
    '- Der produktive XML-Neuimport erzeugte alle fünf neuen A-Set-Objekte mit `write=true`, korrekter Technik-ID, Rolle, Einheit und Min/Max beziehungsweise Zustandsliste. Die States selbst blieben ohne Wert, und im Adapterlog wurden dabei null SETADDR-Kommandos ausgelöst.',
    '- Der ergänzende A38F-Stand wurde im Commit `827023e` versioniert. Backup des damaligen Deployments: `/home/sebastian/vitocal-a38f-backup-20260829T170812`.',
    '- Vor dem produktiven Runtime-Write-XML-Deployment wurde `/etc/vcontrold/vito.xml.bak-20260829-guarded-set-predeploy` angelegt. Die produktive `vito.xml` und die Projektdatei besitzen beide SHA-256 `a6963aaa278cb0c71f529ebb1f80619241a3c4dd2fe523bbdbeecf8cdab5b858`.',
    '',
    `Aktive XML-Bilanz: **${gets.length} get-Kommandos**, **${sets.length} set-Kommandos**, **${research.length} Forschungs-/Hilfskommandos ohne normalen ioBroker-get/set-Namen**. Das empfohlene Pollingprofil enthält **${Object.keys(polling).length} Einträge**.`,
    '',
    '## 3. Sicherheitsmodell: kein EEPROM-Schreibweg',
    '',
    '- Alle hier freigegebenen Schreibkommandos verwenden `protocmd="setaddr"` und im P300-Protokoll `SEND 00 02`.',
    '- In der aktiven `vito.xml` existiert kein `seteeprom`- oder `EEPROM_WRITE`-Kommando.',
    '- Zeitprogramme und bekannte Konfigurationsadressen bleiben read-only.',
    '- `scripts/check-project.js` bricht ab, sobald ein EEPROM-Write oder ein nicht explizit erlaubtes set-Kommando aktiv wird.',
    '- Der Adapter besitzt eine fest im Code hinterlegte Kommando-/Adress-Whitelist. Eine XML-Änderung allein kann keine neue Schreibadresse aktivieren.',
    '- `ack=true` wird ignoriert; erfolgreiche Writes werden mit `ack=true` quittiert und dadurch nicht erneut gesendet.',
    '- Boolean, Objekt, Array, leere Werte, Dezimalwerte, Werte außerhalb der Grenzen und falsche Kommando-/Adresskombinationen werden blockiert.',
    '- Pro Kommando gilt mindestens eine Sekunde Abstand. Mehrfach wartende Werte desselben Kommandos werden zusammengeführt.',
    '',
    '**Wichtige Einschränkung:** `SETADDR` statt `EEPROM_WRITE` ist eine starke technische Schutzgrenze, aber kein alleiniger Beweis, dass die Regelung einen Wert intern niemals persistent übernimmt. Die fünf A-Adressen sind laut Viessmann externe Eingänge mit Default-/Receive-Heartbeat-Verhalten und damit gute Runtime-/RAM-Kandidaten. Die endgültige Einstufung erfolgt erst nach den unten beschriebenen Timeout-, Neustart- und Power-Cycle-Tests.',
    '',
    '## 4. Schreibbare ioBroker-Datenpunkte',
    '',
    'Das bloße Anlegen dieser Objekte oder ein Adapterstart sendet keinen Wert. Ein Telegramm wird erst durch eine Änderung mit `ack=false` ausgelöst.',
    '',
    '| ioBroker-State | Adresse | vcontrold-Kommando | ioBroker-Typ | Akzeptierte Eingabe | Erlaubte Werte | Wirkung | Rückkehr/Sicherheit |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
);

for (const point of sets) {
    const policy = writePolicies[point.command];
    push(
        `| ${code(`viessmann.0.set.${point.stateName}`)} | ${code(point.address)} | ${code(point.command)} | ${code(point.type)} | ${markdownCell(policy?.input || 'nicht freigegeben')} | ${policy?.values || '—'} | ${markdownCell(policy?.effect || point.description)} | ${markdownCell(policy?.reset || '—')} |`,
    );
}

push(
    '',
    '### Empfohlene Aktivierungsreihenfolge',
    '',
    '- Raum-Sollwert: zuerst `set.RaumsollExternHK1`, danach `set.BetriebsartExternHK1=13` oder im Expertentest `=1`.',
    '- Direkter Vorlauf: zuerst `set.VorlaufsollExternHK1`, danach `set.BetriebsartExternHK1=100`.',
    '- Warmwasser: zuerst `set.WWSollExtern`, danach `set.WWBetriebsartExtern=1`.',
    '- Beenden: Heizung immer mit `set.BetriebsartExternHK1=255`, Warmwasser immer mit `set.WWBetriebsartExtern=255`.',
    '- `A400=1`, `A400=100` und `A3C2=1` sind noch keine für Dauerautomation freigegebenen Betriebsarten; sie sind nur kontrollierte Testwerte.',
    '',
    '## 5. Mehr-Punkte-Verfahren zur RAM-/Heartbeat-Validierung',
    '',
    'Jeder Kandidat wird einzeln getestet. Während eines Tests werden keine anderen Sollwerte automatisiert verändert.',
    '',
    '1. **Baseline:** aktuelle Betriebsart, Temperaturen, Verdichterleistung, Haus-/Wärmepumpenverbrauch, `0488`, `0489`, `048A`, A400/A3C2 und Fehlermeldungen protokollieren.',
    '2. **Telegrammtest:** nur einen konservativen Wert schreiben; vcontrold-Antwort, Adapter-Quittierung und Rohtelegramm sichern.',
    '3. **Wirkungstest:** mindestens drei unabhängige Messpunkte beobachten und mit dem erwarteten Anlagenverhalten vergleichen.',
    '4. **Sofortiger Rückweg:** bei Heizstab, Fehlermeldung oder unplausibler Temperatur A400 beziehungsweise A3C2 sofort auf `255` setzen.',
    '5. **Heartbeat-Test:** nach erfolgreichem Kurztest 20 bis 25 Minuten keine Erneuerung senden und prüfen, ob die interne Regelung automatisch zurückkehrt. `779C` bleibt dabei unverändert.',
    '6. **Prozess-Neustart:** Adapter und vcontrold nacheinander neu starten; prüfen, ob der Override bestehen bleibt oder zurückfällt.',
    '7. **Power-Cycle-Test:** nur nach erfolgreichem sicheren Vorlauf und in geeigneter Betriebssituation die Wärmepumpenregelung kontrolliert neu starten; danach Werte und Bedienoberfläche prüfen.',
    '8. **Klassifikation:** Erst wenn der Wert nach Timeout/Neustart zurückfällt, keine dauerhafte Codierung verändert ist und wiederholte Tests konsistent sind, wird er als praktisch RAM-/Runtime-validiert markiert.',
    '',
    '### Abbruchkriterien',
    '',
    '- Heizstabstufe `0488`, `0489` oder Nachheizung `048A` wird unerwartet aktiv.',
    '- Vorlauf, Warmwasser oder Verdichterleistung überschreiten den erwarteten Bereich.',
    '- vcontrold meldet `ERR`, der Readback ist unplausibel oder die Kommunikation fällt aus.',
    '- Die Regelung kehrt nach `255` nicht zur internen Steuerung zurück.',
    '',
    '## 6. Besonders wichtige Lesedatenpunkte',
    '',
    '| State | Adresse | Bedeutung |',
    '| --- | --- | --- |',
    '| `get.LeistungElektrischVerdichter` | `16A4` | Von der Regelung berechnete aktuelle elektrische Verdichterleistung in W; Nebenaggregate und Heizstab nicht vollständig enthalten. |',
    '| `get.LeistungThermischHeizen` | `16A0` | Aktuelle thermische Leistung im Heizbetrieb in W. |',
    '| `get.LeistungThermischWW` | `16A1` | Aktuelle thermische Leistung bei Warmwasserbereitung in W. |',
    '| `get.AnlagenIstleistungProzent` | `A38F`, Byte 0 | Zentraler Anlagenwert in 0,5-%-Schritten, im Adapter bereits als 0–100 % dargestellt. |',
    '| `get.StatusAnlagenIstleistung` | `A38F`, Byte 1 | 0 Anlage aus, 1 Anlage ein. Nicht identisch mit Verdichtermodulation. |',
    '| `get.LeistungVerdichterProzent` | `B423`, Byte 0 | Verdichtermodulation/Ansteuerung in Prozent; vom Anlagenwert A38F unterscheiden. |',
    '| `get.StatusHeizstabSt1` | `0488` | Relais Heizstab Stufe 1. |',
    '| `get.StatusHeizstabSt2` | `0489` | Relais Heizstab Stufe 2. |',
    '| `get.StatusWWNachheizung` | `048A` | Elektrische Warmwasser-Nachheizung aktiv. |',
    '| `get.LeistungHeizstab` | `1909` | Ergänzende 3-kW-Stufen-Schätzung; immer mit den Relais plausibilisieren. |',
    '| `get.EnergieElektrischHeizenKWh` | `1660` + `163F` | Elektrische Verdichter-Energiebilanz Heizen, automatisch in kWh skaliert. |',
    '| `get.EnergieElektrischWWKWh` | `1670` + `163F` | Elektrische Verdichter-Energiebilanz Warmwasser, automatisch in kWh skaliert. |',
    '| `get.EnergieThermischHeizenKWh` | `1640` + `163F` | Thermische Energiebilanz Heizen in kWh. |',
    '| `get.EnergieThermischWWKWh` | `1650` + `163F` | Thermische Energiebilanz Warmwasser in kWh. |',
    '',
    '## 7. Warum frühere Werte wie Rohwerte aussahen',
    '',
    '- Energiebilanz: `kWh = Rohwert × EnergieFaktor(163F) / 10`.',
    '- Laufzeiten: Rohwert in Sekunden wird durch 3600 in Stunden umgerechnet.',
    '- `B420..B424`: Byte 0 enthält den Nutzwert, Byte 1 den Sensorstatus.',
    '- `A38F`: Byte 0 enthält 0..200 in 0,5-%-Schritten; Byte 1 enthält Ein/Aus.',
    '- Meldungs- und Identifikationspuffer bleiben vollständige Strings, damit keine führenden Nullen oder Folgebytes verloren gehen.',
    '- `5030` und `5130` sind Nenn-/Konfigurationswerte und keine aktuelle Leistungsaufnahme.',
    '',
    '## 8. Vollständiger aktiver `viessmann.0.get`-Katalog',
    '',
    'Die State-ID bleibt stabil und technisch (CamelCase). Die Spalte „Erklärung“ ist die menschenlesbare Bedeutung. „Nicht im Profil“ bedeutet: XML-Definition vorhanden, aber im versionierten empfohlenen Pollingprofil nicht explizit aktiviert.',
    '',
);

const categoryOrder = [
    'Leistung, Energie und Effizienz',
    'Heizstab und elektrische Zusatzheizung',
    'Warmwasser',
    'Verdichter und Kältekreis',
    'Pumpen, Ventile und Aktoren',
    'Heizkreise und Anlagenbetrieb',
    'Solar und Kühlung',
    'Laufzeiten und Zähler',
    'Diagnose und Rohdaten',
    'Allgemein, Identifikation und Konfiguration',
];

for (const category of categoryOrder) {
    const points = gets.filter(point => categoryFor(point) === category);
    if (!points.length) continue;
    push(
        `### ${category}`,
        '',
        '| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |',
        '| --- | --- | ---: | --- | --- | --- | --- | --- |',
    );
    for (const point of points) {
        const stateDetails = statesText(point.states);
        const description = stateDetails ? `${point.description} Zustände: ${stateDetails}.` : point.description;
        push(
            `| ${code(point.stateName)} | ${code(point.address)} | ${markdownCell(point.length)} | ${code(point.type)} | ${markdownCell(point.unit)} | ${code(point.role)} | ${markdownCell(pollingText(point.stateName))} | ${markdownCell(description)} |`,
        );
    }
    push('');
}

push(
    '## 9. Forschungs- und Hilfskommandos ohne normalen ioBroker-State',
    '',
    'Diese Kommandos beginnen bewusst nicht mit `get` oder `set`. Der Adapter importiert sie daher nicht als normale Datenpunkte. Sie dienen manuellen Rohabfragen und der Protokollforschung.',
    '',
    '| vcontrold-Kommando | Adresse | Bytes | Protokollaktion | Einheit | Zweck |',
    '| --- | --- | ---: | --- | --- | --- |',
);

for (const point of research) {
    push(
        `| ${code(point.command)} | ${code(point.address)} | ${markdownCell(point.length)} | ${code(point.protocolCommand)} | ${code(point.unitKey)} | ${markdownCell(point.description)} |`,
    );
}

push(
    '',
    '## 10. Verworfen, unbestätigt oder bewusst gesperrt',
    '',
    '| Adresse | Status | Entscheidung |',
    '| --- | --- | --- |',
    '| `0400` | dreimal Fehlercode 1 | Nicht übernommen; vorhandene funktionierende Verdichterstates bleiben maßgeblich. |',
    '| `0404` | dreimal Fehlercode 1 | Nicht übernommen. |',
    '| `5525` | dreimal Fehlercode 1 | Nicht übernommen; `0101` bleibt die funktionierende Außentemperatur. |',
    '| `A401`, `A403`, `A406`, `A3C0`, `A3C5` | direkte Reads jeweils Fehlercode 4 | Keine normalen get-States; Schreibkandidaten nur mit kontrollierter Wirkungsprüfung. |',
    '| `A380`, `A382`, `A383` | zentrale Anlagenmanager-Eingänge mit hoher Eingriffspriorität | Immer für Writes gesperrt. |',
    '| `779C` | Receive-Heartbeat-Konfiguration, gelesen als 20 Minuten | Strikt read-only; nicht ändern. |',
    '| Zeitprogramme / Schedule-Bereiche | möglicherweise persistent | Nur lesen; EEPROM-Write verboten. |',
    '',
    '## 11. Adapter-Backport und Artefakte',
    '',
    '- Quellpatch: `adapter-patches/ioBroker.viessmann-1.7.4-human-readable.patch`',
    '- Installationspaket: `adapter-patches/iobroker.viessmann-1.7.4-vitocal-backport.tgz`',
    '- Prüfsumme: `adapter-patches/SHA256SUMS`',
    '- Projektprüfung: `npm test`, `npm run check`, `xmllint --noout config/vcontrold.xml config/vito.xml`',
    '- Der Adapter benötigt Node.js 20 oder neuer; ein Wechsel auf Node.js 22 ist für diesen Backport nicht erforderlich.',
    '',
    'Der Backport aktualisiert vorhandene Objektmetadaten per Upsert und löscht alte States oder History nicht automatisch. Für reine Anzeigenamen wäre später ein separates `iobrokerDisplayName` sinnvoll, damit die technische State-ID stabil bleibt.',
    '',
    '## 12. Deployment- und Rollback-Grundsätze',
    '',
    'Vor jedem Deployment werden `vito.xml`, `vcontrold.xml`, Adapterverzeichnis und Instanzkonfiguration gesichert. Nach dem Kopieren werden XML-Syntax, Dienste, Adapterlogs und Objektmetadaten geprüft. Beim reinen Deployment der neuen set-States wird absichtlich kein Heizungswert geschrieben.',
    '',
    'Rollback bedeutet:',
    '',
    '1. gesicherte XML-Dateien zurückkopieren;',
    '2. vorheriges Adapterverzeichnis beziehungsweise vorheriges TGZ wiederherstellen;',
    '3. vcontrold und `viessmann.0` neu starten;',
    '4. Verbindung, Lesezustände und das Fehlen unerwarteter Writes prüfen.',
    '',
    '## 13. Maßgebliche Projektdateien',
    '',
    '- `config/vito.xml` – aktive Technik-ID-/Kommando-Definitionen',
    '- `config/vcontrold.xml` – P300-Protokoll, Datentypen, Skalierungen und serielle Schnittstelle',
    '- `config/iobroker-polling.json` – empfohlenes Pollingprofil',
    '- `lib/runtime-datapoints.js` – Runtime-Datenpunktkatalog und Sperradressen',
    '- `lib/runtime-write-guard.js` – weitergehendes Sicherheitsmodell für spätere Automation',
    '- `lib/p300-frame.js` – Offline-Encoder für überprüfbare P300-Schreibrahmen',
    '- `docs/WO1C_RUNTIME_CONTROL.md` – Detailkonzept und Testphasen',
    '- `docs/IOBROKER_MAXIMAL_READOUT.md` – Details zu Leistung, Energie und ioBroker-Darstellung',
    '- `scripts/check-project.js` – automatische Sicherheits- und Konsistenzprüfung',
    '',
    '## 14. Offene Punkte',
    '',
    '- Kontrollierter Einzeltest von A401/A400, danach A403/A400 und zuletzt A3C0/A3C2. Das Deployment selbst hat noch keinen dieser Werte geschrieben.',
    '- Receive-Heartbeat-/Timeout-Test ohne zyklische Erneuerung.',
    '- Neustart-/Power-Cycle-Test zur praktischen RAM-Klassifikation.',
    '- Optional separate menschenlesbare `common.name`-Anzeige ohne Änderung der stabilen State-IDs.',
    '',
    '---',
    '',
    '*Diese Datei wird aus den aktiven XML-Definitionen und dem Pollingprofil erzeugt. Änderungen am Datenpunktkatalog sollten anschließend mit `npm run docs:overview` neu dokumentiert und mit `npm run check` geprüft werden.*',
    '',
);

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${path.basename(outputPath)} with ${gets.length} get states and ${sets.length} set states.`);
