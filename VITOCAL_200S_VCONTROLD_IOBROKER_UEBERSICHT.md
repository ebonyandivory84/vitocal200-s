# Vitocal 200-S: vcontrold-, Optolink- und ioBroker-Gesamtdokumentation

**Stand:** 29. August 2026  
**Anlage:** Viessmann Vitocal 200-S AWB-E-AC 201.D08, Vitotronic 200 Typ WO1C  
**Geräte-/Steuerungs-ID:** `204D` (live bestätigt)  
**Seriennummer:** `7745669904294110`, Baujahr 2019  
**ioBroker-Instanz:** `viessmann.0`, gepatchter Adapter `iobroker.viessmann` 1.7.4 unter Node.js 20  

> Diese Datei ist die zentrale Übersicht. Die XML-Dateien bleiben die technische Wahrheit. Nicht jede dokumentierte Viessmann-Technik-ID ist bei direktem Optolink-Zugriff automatisch lesbar oder garantiert flüchtig.

## 1. Ziel und Architektur

Ziel ist eine möglichst vollständige, verständliche und sichere Auswertung der Wärmepumpe sowie eine spätere PV-geführte Runtime-Steuerung ohne zyklische EEPROM-Schreibvorgänge.

```text
Vitocal 200-S / WO1C (ID 204D)
        │ Optolink / CP2102
        ▼
vcontrold mit vito.xml + vcontrold.xml, TCP-Port 3002
        │ get... / streng begrenzte set...-Kommandos
        ▼
ioBroker Adapter viessmann.0
        │
        ├── viessmann.0.get.*  Mess-, Status- und Diagnosewerte
        └── viessmann.0.set.*  sieben explizit freigegebene Schreibpunkte
```

Repository: `https://github.com/ebonyandivory84/vitocal200-s`  
Ergänzendes Smart-Heating-Repository: `https://github.com/ebonyandivory84/SmartHeating`

## 2. Was bisher umgesetzt und geprüft wurde

- Die Geräte-ID wurde real als `204D` bestätigt; fremde XML-Definitionen werden nicht blind übernommen.
- Funktionierende Bestandsadressen wurden nicht ersetzt. Neue Punkte werden nur ergänzend aufgenommen.
- Temperaturen, Laufzeiten, Druck, Prozentwerte, Leistung, Energie, Sensorstatus und Rohstrings werden typgerecht an ioBroker übergeben.
- Die Energiezähler `1640`, `1650`, `1660` und `1670` werden mit dem Gerätefaktor `163F` in kWh umgerechnet.
- `16A0`, `16A1` und `16A4` werden als momentane Leistung in Watt dargestellt.
- Heizstaberkennung erfolgt über `0488`, `0489`, `048A` und ergänzend `1909` statt über den Hausgesamtverbrauch allein.
- Mehrbyte-Adressen `B420` bis `B424` werden in Nutzwert und Sensorstatus getrennt.
- `A38F` wurde dreimal live gelesen und als Anlagen-Istleistung in Prozent plus Anlagenstatus aufgenommen.
- Die Kandidaten `0400`, `0404` und `5525` lieferten jeweils reproduzierbar Fehlercode 1 und wurden nicht übernommen.
- `A400`, `A3C2`, `A440`, `A480` und `779C` wurden als Ein-Byte-Reads bestätigt.
- Direkte Reads auf `A401`, `A403`, `A406`, `A3C0` und `A3C5` lieferten Fehlercode 4; diese werden deshalb nicht als funktionierende normale Lesestates ausgegeben.
- Am 27. August 2026 wurden ausschließlich die neutralen Schreibwerte `A400=255` und `A3C2=255` real gesendet. Beide wurden mit `OK` bestätigt und als `255` zurückgelesen; Verdichter und Heizstab blieben aus.
- Der Adapter 1.7.4 wurde zurückportiert: Metadaten, Einheiten, Rollen, Zustände, String-Erhalt, Energiefaktoren und geschützte Writes sind lokal getestet und benötigen keinen Node.js-22-Zwang.
- Der ergänzende A38F-Stand wurde im Commit `827023e` versioniert. Backup des damaligen Deployments: `/home/sebastian/vitocal-a38f-backup-20260829T170812`.

Aktive XML-Bilanz: **184 get-Kommandos**, **7 set-Kommandos**, **10 Forschungs-/Hilfskommandos ohne normalen ioBroker-get/set-Namen**. Das empfohlene Pollingprofil enthält **96 Einträge**.

## 3. Sicherheitsmodell: kein EEPROM-Schreibweg

- Alle hier freigegebenen Schreibkommandos verwenden `protocmd="setaddr"` und im P300-Protokoll `SEND 00 02`.
- In der aktiven `vito.xml` existiert kein `seteeprom`- oder `EEPROM_WRITE`-Kommando.
- Zeitprogramme und bekannte Konfigurationsadressen bleiben read-only.
- `scripts/check-project.js` bricht ab, sobald ein EEPROM-Write oder ein nicht explizit erlaubtes set-Kommando aktiv wird.
- Der Adapter besitzt eine fest im Code hinterlegte Kommando-/Adress-Whitelist. Eine XML-Änderung allein kann keine neue Schreibadresse aktivieren.
- `ack=true` wird ignoriert; erfolgreiche Writes werden mit `ack=true` quittiert und dadurch nicht erneut gesendet.
- Boolean, Objekt, Array, leere Werte, Dezimalwerte, Werte außerhalb der Grenzen und falsche Kommando-/Adresskombinationen werden blockiert.
- Pro Kommando gilt mindestens eine Sekunde Abstand. Mehrfach wartende Werte desselben Kommandos werden zusammengeführt.

**Wichtige Einschränkung:** `SETADDR` statt `EEPROM_WRITE` ist eine starke technische Schutzgrenze, aber kein alleiniger Beweis, dass die Regelung einen Wert intern niemals persistent übernimmt. Die fünf A-Adressen sind laut Viessmann externe Eingänge mit Default-/Receive-Heartbeat-Verhalten und damit gute Runtime-/RAM-Kandidaten. Die endgültige Einstufung erfolgt erst nach den unten beschriebenen Timeout-, Neustart- und Power-Cycle-Tests.

## 4. Schreibbare ioBroker-Datenpunkte

Das bloße Anlegen dieser Objekte oder ein Adapterstart sendet keinen Wert. Ein Telegramm wird erst durch eine Änderung mit `ack=false` ausgelöst.

| ioBroker-State | Adresse | vcontrold-Kommando | ioBroker-Typ | Akzeptierte Eingabe | Erlaubte Werte | Wirkung | Rückkehr/Sicherheit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `viessmann.0.set.Betriebsart` | `B000` | `setBetriebsart` | `String` | Number oder numerischer String; Boolean/Objekt/Array verboten | `0`, `1`, `2` | Legacy-Betriebsart: 0 Abschaltbetrieb, 1 nur Warmwasser, 2 Heizen und Warmwasser. | Kein definierter RAM-Reset; Persistenz unbekannt. Nicht für PV-Automation verwenden. |
| `viessmann.0.set.WWEinmal` | `B020` | `setWWEinmal` | `Number` | Number oder numerischer String; Boolean/Objekt/Array verboten | `0`, `2` | 0 normal/abbrechen, 2 einmalige Warmwasserbereitung starten. | Ereignis-/Kompatibilitätswert; nicht zyklisch schreiben. |
| `viessmann.0.set.BetriebsartExternHK1` | `A400` | `setBetriebsartExternHK1` | `Number` | Number oder numerischer String; nur ganzzahlig | `1`, `13`, `100`, `255` | 1 externer Raum-Sollwert/Normal, 13 Economy/reduziert, 100 externer Vorlauf-Sollwert, 255 interne Regelung. | `255` gibt HK1 an die interne Regelung zurück. |
| `viessmann.0.set.RaumsollExternHK1` | `A401` | `setRaumsollExternHK1` | `Number` | Number oder numerischer String; Boolean/Dezimalzahl verboten | ganzzahlig `18..24` °C | Externer Raum-Sollwert für HK1; wirksam zusammen mit A400=1 oder A400=13. | Wird durch A400=255 unwirksam; kein eigener Resetwert. |
| `viessmann.0.set.VorlaufsollExternHK1` | `A403` | `setVorlaufsollExternHK1` | `Number` | Number oder numerischer String; Boolean/Dezimalzahl verboten | ganzzahlig `20..45` °C | Direkter externer HK1-Vorlauf-Sollwert; wirksam mit A400=100. | Experimenteller stärkerer Override; durch A400=255 beenden. |
| `viessmann.0.set.WWBetriebsartExtern` | `A3C2` | `setWWBetriebsartExtern` | `Number` | Number oder numerischer String; nur ganzzahlig | `1`, `255` | 1 Warmwasser mit externem Sollwert, 255 interne Warmwasserregelung. | `255` beendet die externe WW-Anforderung; Heizstabstatus dabei überwachen. |
| `viessmann.0.set.WWSollExtern` | `A3C0` | `setWWSollExtern` | `Number` | Number oder numerischer String; Boolean/Dezimalzahl verboten | ganzzahlig `40..50` °C | Externer Warmwasser-Sollwert; wirksam mit A3C2=1. | Wird durch A3C2=255 unwirksam; kein eigener Resetwert. |

### Empfohlene Aktivierungsreihenfolge

- Raum-Sollwert: zuerst `set.RaumsollExternHK1`, danach `set.BetriebsartExternHK1=13` oder im Expertentest `=1`.
- Direkter Vorlauf: zuerst `set.VorlaufsollExternHK1`, danach `set.BetriebsartExternHK1=100`.
- Warmwasser: zuerst `set.WWSollExtern`, danach `set.WWBetriebsartExtern=1`.
- Beenden: Heizung immer mit `set.BetriebsartExternHK1=255`, Warmwasser immer mit `set.WWBetriebsartExtern=255`.
- `A400=1`, `A400=100` und `A3C2=1` sind noch keine für Dauerautomation freigegebenen Betriebsarten; sie sind nur kontrollierte Testwerte.

## 5. Mehr-Punkte-Verfahren zur RAM-/Heartbeat-Validierung

Jeder Kandidat wird einzeln getestet. Während eines Tests werden keine anderen Sollwerte automatisiert verändert.

1. **Baseline:** aktuelle Betriebsart, Temperaturen, Verdichterleistung, Haus-/Wärmepumpenverbrauch, `0488`, `0489`, `048A`, A400/A3C2 und Fehlermeldungen protokollieren.
2. **Telegrammtest:** nur einen konservativen Wert schreiben; vcontrold-Antwort, Adapter-Quittierung und Rohtelegramm sichern.
3. **Wirkungstest:** mindestens drei unabhängige Messpunkte beobachten und mit dem erwarteten Anlagenverhalten vergleichen.
4. **Sofortiger Rückweg:** bei Heizstab, Fehlermeldung oder unplausibler Temperatur A400 beziehungsweise A3C2 sofort auf `255` setzen.
5. **Heartbeat-Test:** nach erfolgreichem Kurztest 20 bis 25 Minuten keine Erneuerung senden und prüfen, ob die interne Regelung automatisch zurückkehrt. `779C` bleibt dabei unverändert.
6. **Prozess-Neustart:** Adapter und vcontrold nacheinander neu starten; prüfen, ob der Override bestehen bleibt oder zurückfällt.
7. **Power-Cycle-Test:** nur nach erfolgreichem sicheren Vorlauf und in geeigneter Betriebssituation die Wärmepumpenregelung kontrolliert neu starten; danach Werte und Bedienoberfläche prüfen.
8. **Klassifikation:** Erst wenn der Wert nach Timeout/Neustart zurückfällt, keine dauerhafte Codierung verändert ist und wiederholte Tests konsistent sind, wird er als praktisch RAM-/Runtime-validiert markiert.

### Abbruchkriterien

- Heizstabstufe `0488`, `0489` oder Nachheizung `048A` wird unerwartet aktiv.
- Vorlauf, Warmwasser oder Verdichterleistung überschreiten den erwarteten Bereich.
- vcontrold meldet `ERR`, der Readback ist unplausibel oder die Kommunikation fällt aus.
- Die Regelung kehrt nach `255` nicht zur internen Steuerung zurück.

## 6. Besonders wichtige Lesedatenpunkte

| State | Adresse | Bedeutung |
| --- | --- | --- |
| `get.LeistungElektrischVerdichter` | `16A4` | Von der Regelung berechnete aktuelle elektrische Verdichterleistung in W; Nebenaggregate und Heizstab nicht vollständig enthalten. |
| `get.LeistungThermischHeizen` | `16A0` | Aktuelle thermische Leistung im Heizbetrieb in W. |
| `get.LeistungThermischWW` | `16A1` | Aktuelle thermische Leistung bei Warmwasserbereitung in W. |
| `get.AnlagenIstleistungProzent` | `A38F`, Byte 0 | Zentraler Anlagenwert in 0,5-%-Schritten, im Adapter bereits als 0–100 % dargestellt. |
| `get.StatusAnlagenIstleistung` | `A38F`, Byte 1 | 0 Anlage aus, 1 Anlage ein. Nicht identisch mit Verdichtermodulation. |
| `get.LeistungVerdichterProzent` | `B423`, Byte 0 | Verdichtermodulation/Ansteuerung in Prozent; vom Anlagenwert A38F unterscheiden. |
| `get.StatusHeizstabSt1` | `0488` | Relais Heizstab Stufe 1. |
| `get.StatusHeizstabSt2` | `0489` | Relais Heizstab Stufe 2. |
| `get.StatusWWNachheizung` | `048A` | Elektrische Warmwasser-Nachheizung aktiv. |
| `get.LeistungHeizstab` | `1909` | Ergänzende 3-kW-Stufen-Schätzung; immer mit den Relais plausibilisieren. |
| `get.EnergieElektrischHeizenKWh` | `1660` + `163F` | Elektrische Verdichter-Energiebilanz Heizen, automatisch in kWh skaliert. |
| `get.EnergieElektrischWWKWh` | `1670` + `163F` | Elektrische Verdichter-Energiebilanz Warmwasser, automatisch in kWh skaliert. |
| `get.EnergieThermischHeizenKWh` | `1640` + `163F` | Thermische Energiebilanz Heizen in kWh. |
| `get.EnergieThermischWWKWh` | `1650` + `163F` | Thermische Energiebilanz Warmwasser in kWh. |

## 7. Warum frühere Werte wie Rohwerte aussahen

- Energiebilanz: `kWh = Rohwert × EnergieFaktor(163F) / 10`.
- Laufzeiten: Rohwert in Sekunden wird durch 3600 in Stunden umgerechnet.
- `B420..B424`: Byte 0 enthält den Nutzwert, Byte 1 den Sensorstatus.
- `A38F`: Byte 0 enthält 0..200 in 0,5-%-Schritten; Byte 1 enthält Ein/Aus.
- Meldungs- und Identifikationspuffer bleiben vollständige Strings, damit keine führenden Nullen oder Folgebytes verloren gehen.
- `5030` und `5130` sind Nenn-/Konfigurationswerte und keine aktuelle Leistungsaufnahme.

## 8. Vollständiger aktiver `viessmann.0.get`-Katalog

Die State-ID bleibt stabil und technisch (CamelCase). Die Spalte „Erklärung“ ist die menschenlesbare Bedeutung. „Nicht im Profil“ bedeutet: XML-Definition vorhanden, aber im versionierten empfohlenen Pollingprofil nicht explizit aktiviert.

### Leistung, Energie und Effizienz

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `EnergiePV` | `1678` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Energiebilanz: ElektroenergiePV (0..1150000) |
| `JAZ` | `1680` | 1 | `Number` | — | `value` | 3600 s | Statistik - Energiebilanz: Jahresarbeitszahl (0..10) |
| `JAZHeiz` | `1681` | 1 | `Number` | — | `value` | 3600 s | Statistik - Energiebilanz: Jahresarbeitszahl Heizen (0..10) |
| `JAZWW` | `1682` | 1 | `Number` | — | `value` | 3600 s | Statistik - Energiebilanz: Jahresarbeitszahl WW (0..10) |
| `COPHeiz` | `1690` | 2 | `Number` | — | `value` | 300 s | Statistik - Energiebilanz: COP Heizbetrieb (0..10) |
| `TempSekVLMittel` | `16B2` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Statistik - Energiebilanz: mittlere sek. Vorlauftemperatur (0..95) |
| `TempSekRLMittel` | `16B3` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Statistik - Energiebilanz: mittlere sek.Temperatur RL1 (0..95) |
| `TempSekRLMittel2` | `16B4` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Statistik - Energiebilanz: mittlere sek.Temperatur RL2 (0..95) |
| `PwrSollVerdichter` | `5030` | 1 | `Number` | % | `value` | 30 s | Konfiguration/Diagnose: Leistung Verdichterstufe 1; nicht mit aktueller elektrischer Aufnahme verwechseln |
| `PwrSollVerdichter2` | `5130` | 1 | `Number` | % | `value` | 30 s | Konfiguration/Diagnose: Leistung Verdichterstufe 2; nicht mit aktueller elektrischer Aufnahme verwechseln |
| `LeistungThermischHeizen` | `16A0` | 4 | `Number` | W | `value.power` | 15 s | Aktuelle thermische Leistung Heizbetrieb in W |
| `LeistungThermischWW` | `16A1` | 4 | `Number` | W | `value.power` | 15 s | Aktuelle thermische Leistung Warmwasserbereitung in W |
| `LeistungElektrischVerdichter` | `16A4` | 4 | `Number` | W | `value.power` | 15 s | Aktuelle elektrische Leistungsaufnahme Verdichter in W |
| `EnergieThermischHeizen` | `1640` | 4 | `Number` | — | `value` | aus (`-1`) | Energiebilanz thermisch Heizbetrieb, Rohwert; kWh = Rohwert * EnergieFaktor / 10 |
| `EnergieFaktor` | `163F` | 1 | `Number` | — | `value` | 3600 s | Skalierungsfaktor der Energiebilanz: 1=0,1 kWh je Rohwert, 10=1 kWh, 100=10 kWh |
| `EnergieThermischWW` | `1650` | 4 | `Number` | — | `value` | aus (`-1`) | Energiebilanz thermisch Warmwasser, Rohwert; kWh = Rohwert * EnergieFaktor / 10 |
| `EnergieElektrischHeizen` | `1660` | 4 | `Number` | — | `value` | aus (`-1`) | Energiebilanz elektrisch Heizbetrieb, Rohwert; kWh = Rohwert * EnergieFaktor / 10 |
| `EnergieElektrischWW` | `1670` | 4 | `Number` | — | `value` | aus (`-1`) | Energiebilanz elektrisch Warmwasser, Rohwert; kWh = Rohwert * EnergieFaktor / 10 |
| `EnergieThermischHeizenKWh` | `1640` | 4 | `Number` | kWh | `value.energy` | 3600 s | Energiebilanz thermisch Heizbetrieb, automatisch mit 163F in kWh skaliert |
| `EnergieThermischWWKWh` | `1650` | 4 | `Number` | kWh | `value.energy` | 3600 s | Energiebilanz thermisch Warmwasser, automatisch mit 163F in kWh skaliert |
| `EnergieElektrischHeizenKWh` | `1660` | 4 | `Number` | kWh | `value.energy` | 3600 s | Energiebilanz elektrisch Heizbetrieb, automatisch mit 163F in kWh skaliert |
| `EnergieElektrischWWKWh` | `1670` | 4 | `Number` | kWh | `value.energy` | 3600 s | Energiebilanz elektrisch Warmwasser, automatisch mit 163F in kWh skaliert |
| `LeistungHeizstab` | `1909` | 1 | `Number` | W | `value.power` | 10 s | Aktuelle Heizstableistung in 3-kW-Stufen; read-only Community-Referenz, gegen 0488/0489 plausibilisieren |
| `LeistungVerdichterProzent` | `B423` | 2 | `Number` | % | `value` | 30 s | Verdichtermodulation in Prozent; Nutzwert Byte 0, Sensorstatus Byte 1 |
| `AnlagenIstleistungProzent` | `A38F` | 2 | `Number` | % | `value` | 15 s | Zentraler Anforderungsmanager: aktuelle Anlagen-Istleistung in 0,5-Prozent-Schritten; nicht mit Verdichtermodulation B423 verwechseln |
| `StatusAnlagenIstleistung` | `A38F` | 2 | `Number` | — | `indicator` | 15 s | Zentraler Anforderungsmanager: Byte 1 Status der Anlagen-Istleistung, 0=aus und 1=ein Zustände: 0=Anlage aus; 1=Anlage ein. |
| `StatusSensorLeistungVerdichter` | `B423` | 2 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Verdichterleistung: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler Zustände: 0=OK; 1=Kurzschluss; 2=Unterbrechung; 3=Referenzfehler; 4=Unter Minimum; 5=Ueber Maximum; 6=Nicht vorhanden; 7=Pruefung; 8=Fehler; 9=Kommunikationsfehler. |

### Heizstab und elektrische Zusatzheizung

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `StatusEVUSperreHeizstab` | `03C4` | 1 | `Number` | — | `indicator` | 15 s | Eingang EVU-Sperre fuer den Heizwasser-Durchlauferhitzer Zustände: 0=Nicht gesperrt; 1=Gesperrt. |
| `StatusWWNachheizung` | `048A` | 1 | `Number` | — | `indicator` | 15 s | Diagnose - Warmwasser: Relais Nachheizung Zustände: 0=Aus; 1=Ein. |
| `AnzHeizstabSt1` | `0508` | 4 | `Number` | — | `value` | 3600 s | Statistik - Schaltzyklen Anlage: Einschaltungen Heizstab Stufe 1 (?) |
| `AnzHeizstabSt2` | `0509` | 4 | `Number` | — | `value` | 3600 s | Statistik - Schaltzyklen Anlage: Einschaltungen Heizstab Stufe 2 (?) |
| `LZHeizstabSt1` | `0588` | 4 | `Number` | h | `value.interval` | 3600 s | Statistik - Betriebsstunden Anlage: Betriebsstunden Heizstab Stufe 1 (?) |
| `LZHeizstabSt2` | `0589` | 4 | `Number` | h | `value.interval` | 3600 s | Statistik - Betriebsstunden Anlage: Betriebsstunden Heizstab Stufe 2 (?) |
| `LZSNH` | `058A` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Speichernachheizung in Stunden |
| `HystereseWWZusatzheizung` | `6008` | 2 | `Number` | — | `value` | 600 s | Service - Warmwasser: Einschalthysterese der Zusatzheizung in K |
| `FreigabeElektroWW` | `6015` | 1 | `Number` | — | `indicator` | 300 s | Service - Warmwasser: Elektroheizung fuer Trinkwassererwaermung freigegeben Zustände: 0=Gesperrt; 1=Freigegeben. |
| `AbschalthystereseElektroWW` | `601E` | 2 | `Number` | — | `value` | 600 s | Service - Warmwasser: Abschalthysterese Elektroheizung in K |
| `StrategieElektroWW` | `6040` | 1 | `Number` | — | `value` | 300 s | Service - Warmwasser: Strategie/Nachladung mit Elektroheizung; Codierung firmwareabhaengig |
| `HeizstabVorhanden` | `7900` | 1 | `Number` | — | `indicator` | 3600 s | Service - Elektroheizung: Heizwasser-Durchlauferhitzer vorhanden/freigegeben Zustände: 0=Nicht vorhanden/gesperrt; 1=Vorhanden. |
| `FreigabeElektroHeizen` | `7902` | 1 | `Number` | — | `indicator` | 300 s | Service - Elektroheizung: Heizwasser-Durchlauferhitzer fuer Raumheizung freigegeben Zustände: 0=Gesperrt; 1=Freigegeben. |
| `StatusHeizstabSt1` | `0488` | 1 | `Number` | — | `indicator` | 10 s | Relais Heizstab Stufe 1 aktiv (0..1) Zustände: 0=Aus; 1=Ein. |
| `StatusHeizstabSt2` | `0489` | 1 | `Number` | — | `indicator` | 10 s | Relais Heizstab Stufe 2 aktiv (0..1) Zustände: 0=Aus; 1=Ein. |

### Warmwasser

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `TempWWIstOben` | `010D` | 2 | `Number` | °C | `value.temperature` | 60 s | Information - Warmwasser: Warmwassertemperatur oben (0..95) |
| `TempPufferIst` | `010B` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Allgemein: Pufferspeichertemperatur (0..95) |
| `TempWWIstUnten` | `010F` | 2 | `Number` | °C | `value.temperature` | 300 s | Information - Warmwasser: Warmwassertemperatur unten (0..95) |
| `TempSolSp` | `0113` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Solar: Solar Speichertemperatur (0..95) |
| `StatusPumpeZirk` | `0490` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Warmwasser: Zirkulationspumpe (0..1) |
| `StatusVentilWW` | `0494` | 1 | `Number` | — | `indicator` | 15 s | Diagnose - Waermepumpe: 3-W-Ventil Heizen WW1 (0 (Heizen)..1 (WW)) |
| `StatusVentilWW2` | `0495` | 1 | `Number` | — | `indicator` | nicht im Profil | Diagnose - Waermepumpe: 3-W-Ventil Heizen WW2 (0 (Heizen)..1 (WW)) |
| `StatusSpeicherPumpe` | `0496` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Warmwasser: Speicherladepumpe (0..1) Zustände: 0=Aus; 1=Ein. |
| `AnzWarmwasserventil` | `0514` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Schaltzyklen: Warmwasserventil |
| `LZVentilWW` | `0594` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Warmwasserventil (?) |
| `LZSpeicherPumpe` | `0596` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Speicherladepumpe in Stunden |
| `TempWWSoll` | `6000` | 2 | `Number` | °C | `value.temperature` | 300 s | Bedienung WW - Betriebsdaten WW: Warmwassersolltemperatur (10..60 (95)) |
| `TempWWSoll2` | `600C` | 2 | `Number` | °C | `value.temperature` | 300 s | Bedienung WW - Betriebsdaten WW: Zweiter Sollwert (10..60 (95)) |
| `HystereseWWWaermepumpe` | `6007` | 2 | `Number` | — | `value` | 600 s | Service - Warmwasser: Einschalthysterese der Waermepumpe in K |
| `TemperaturanstiegWWProStunde` | `600D` | 2 | `Number` | — | `value` | 600 s | Service - Warmwasser: erwarteter Mindest-Temperaturanstieg pro Stunde in K/h |
| `WWEinmal` | `B020` | 1 | `Number` | — | `value` | 30 s | Bedienung WW: Status einmalige Warmwasserbereitung (0=normal, 2=einmal WW) |
| `WWBetriebsartExtern` | `A3C2` | 1 | `Number` | — | `value` | 60 s | Externer WW-Modus, read-only live-validiert: 255 bedeutet interne Regelung |
| `DrehzahlWarmwasserpumpe` | `B422` | 2 | `Number` | % | `value` | 30 s | Warmwasserpumpe: Ansteuerung in Prozent; Nutzwert Byte 0, Sensorstatus Byte 1 |
| `StatusSensorWarmwasserpumpe` | `B422` | 2 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Warmwasserpumpe: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler Zustände: 0=OK; 1=Kurzschluss; 2=Unterbrechung; 3=Referenzfehler; 4=Unter Minimum; 5=Ueber Maximum; 6=Nicht vorhanden; 7=Pruefung; 8=Fehler; 9=Kommunikationsfehler. |

### Verdichter und Kältekreis

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `KaeltekreisID` | `06EE` | 2 | `Number` | — | `value` | nicht im Profil | Information - Kaeltekreis: interne Kaeltekreis-ID/Subtyp |
| `TempSauggas` | `011E` | 2 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Kaeltekreis: Sauggastemperatur |
| `TempFluessiggas` | `013B` | 2 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Kaeltekreis: Fluessiggastemperatur |
| `TempSauggasReversibel` | `013C` | 2 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Kaeltekreis: Sauggastemperatur reversibler Betrieb |
| `TempSekVLWaermetauscher` | `013D` | 2 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Kaeltekreis: Sekundaervorlauf am Waermetauscher |
| `TempVerdampfung` | `0E10` | 3 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Ausseneinheit: Verdampfungstemperatur; Status in Byte 2 |
| `TempKondensation` | `0E12` | 3 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Ausseneinheit: Kondensationstemperatur; Status in Byte 2 |
| `TempHeissgas` | `0E1B` | 3 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Ausseneinheit: Heissgastemperatur; Status in Byte 2 |
| `TempVerdichter` | `0E1E` | 3 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Ausseneinheit: Verdichtertemperatur; Status in Byte 2 |
| `DruckSauggas` | `B410` | 3 | `Number` | bar | `value.pressure` | 60 s | Diagnose - Kaeltekreis: Sauggasdruck; Status in Byte 2 |
| `DruckHeissgas` | `B411` | 3 | `Number` | bar | `value.pressure` | 60 s | Diagnose - Kaeltekreis: Heissgasdruck; Status in Byte 2 |
| `StatusSensorDruckSauggas` | `B410` | 3 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Sauggasdruck: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler |
| `StatusSensorDruckHeissgas` | `B411` | 3 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Heissgasdruck: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler |
| `StatusV1` | `0480` | 1 | `Number` | — | `indicator` | 15 s | Diagnose - Anlagenuebersicht: Verdichter 1 (Schuetz) (0..1) |
| `StatusV2` | `0481` | 1 | `Number` | — | `indicator` | 15 s | Diagnose - Anlagenuebersicht: Verdichter 2 (Schuetz) (0..1) |
| `StatusVerdichterRelais` | `0428` | 1 | `Number` | — | `indicator` | nicht im Profil | Diagnose - Waermepumpe 1: Verdichterrelais EEV1 Zustände: 0=Aus; 1=Ein. |
| `StatusAbtauband` | `04C1` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Kaeltekreis: elektrisches Abtauband/Begleitheizung aktiv Zustände: 0=Aus; 1=Ein. |
| `StatusAbtaupuffer` | `04C6` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Kaeltekreis: Abtaupuffer aktiv Zustände: 0=Aus; 1=Ein. |
| `AnzVerdichter` | `0500` | 4 | `Number` | — | `value` | 3600 s | Statistik - Schaltzyklen: Einschaltungen Verdichter 1 |
| `LZVerdichter` | `0580` | 4 | `Number` | h | `value.interval` | 3600 s | Statistik - Betriebsstunden: Verdichter 1 in Stunden |
| `LZVerdSt1` | `1620` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Verdichter auf Stufe 1 (?) |
| `LZVerdSt2` | `1622` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Verdichter auf Stufe 2 (?) |
| `LZVerdSt3` | `1624` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Verdichter auf Stufe 3 (?) |
| `LZVerdSt4` | `1626` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Verdichter auf Stufe 4 (?) |
| `LZVerdSt5` | `1628` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Verdichter auf Stufe 5 (?) |
| `SpdKomp` | `1A54` | 1 | `Number` | Hz | `value.frequency` | 30 s | Diagnose - Verdichter: Kompressorfrequenz; Wert groesser 0 bedeutet Verdichter aktiv |
| `LastVerdichter` | `1AC3` | 1 | `Number` | — | `value` | 30 s | Last am Verdichter |
| `TempSekVLMax` | `5001` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Service - Verdichter 1: maximale sekundaere Vorlauftemperatur |
| `DrehzahlLuefterVerdichter` | `B420` | 2 | `Number` | % | `value` | 30 s | Primaerquelle/Luefter: Ansteuerung in Prozent; Nutzwert Byte 0, Sensorstatus Byte 1 |
| `StellungExpansionsventilProzent` | `B424` | 2 | `Number` | % | `value` | 30 s | Elektronisches Expansionsventil: Oeffnung in Prozent; Nutzwert Byte 0, Sensorstatus Byte 1 |
| `StatusSensorExpansionsventil` | `B424` | 2 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Expansionsventil: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler Zustände: 0=OK; 1=Kurzschluss; 2=Unterbrechung; 3=Referenzfehler; 4=Unter Minimum; 5=Ueber Maximum; 6=Nicht vorhanden; 7=Pruefung; 8=Fehler; 9=Kommunikationsfehler. |
| `MeldungenVerdichter1Raw` | `0704` | 32 | `Mixed/String` | — | `text` | aus (`-1`) | Diagnose - Rohes Bitfeld anstehender Meldungen Verdichter 1 |
| `MeldungenVerdichterRaw` | `0708` | 32 | `Mixed/String` | — | `text` | aus (`-1`) | Diagnose - Rohes Bitfeld anstehender Verdichtermeldungen |

### Pumpen, Ventile und Aktoren

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `StatusQuellePri1` | `0482` | 1 | `Number` | — | `indicator` | nicht im Profil | Diagnose - Anlagenuebersicht: Primaerquelle 1 (Vent. oder Primaerpumpe (0..1) |
| `StatusQuellePri2` | `0483` | 1 | `Number` | — | `indicator` | nicht im Profil | Diagnose - Anlagenuebersicht: Primaerquelle 2 (Primaerpumpe) (0..1) |
| `StatusSekP` | `0484` | 1 | `Number` | — | `indicator` | 15 s | Diagnose - Anlagenuebersicht: Sekundaerpumpe 1 (0..1) |
| `StatusPumpe` | `048D` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Heizkreis HK1: Heizkreispumpe (0..1) |
| `StatusPumpe2` | `048E` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Heizkreis HK2: Heizkreispumpe (0..1) Zustände: 0=Aus; 1=Ein. |
| `AnzHeizkreispumpeHK2` | `050E` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Schaltzyklen: Heizkreispumpe HK2 |
| `LZPumpeSek` | `0584` | 4 | `Number` | h | `value.interval` | 3600 s | Statistik - Betriebsstunden Anlage: Betriebsstunden Sekundaerpumpe (?) |
| `LZPumpe` | `058D` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Heizkreispumpe HK1 in Stunden |
| `LZPumpe2` | `058E` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Heizkreispumpe HK2 in Stunden |
| `LZPumpe3` | `058F` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Heizkreispumpe HK3 in Stunden |
| `LZUPumpe` | `0590` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden Anlage: Betriebsstunden Umwaelzpumpe (?) |
| `SpdFan` | `1A53` | 1 | `Number` | — | `value` | 30 s | Geschwindigkeit Luefter |
| `LZWP` | `5005` | 2 | `Number` | — | `value` | nicht im Profil | Diagnose - Waermepumpe: interner Laufzeitwert; Einheit firmwareabhaengig, nicht als Stunden historisieren |
| `DrehzahlSekundaerpumpe` | `B421` | 2 | `Number` | % | `value` | 30 s | Sekundaerpumpe: Ansteuerung in Prozent; Nutzwert Byte 0, Sensorstatus Byte 1 |
| `StatusSensorPrimaerquelle` | `B420` | 2 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Primaerquelle/Luefter: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler Zustände: 0=OK; 1=Kurzschluss; 2=Unterbrechung; 3=Referenzfehler; 4=Unter Minimum; 5=Ueber Maximum; 6=Nicht vorhanden; 7=Pruefung; 8=Fehler; 9=Kommunikationsfehler. |
| `StatusSensorSekundaerpumpe` | `B421` | 2 | `Number` | — | `indicator.maintenance` | 300 s | Sensorstatus Sekundaerpumpe: 0=OK, 1=Kurzschluss, 2=Unterbrechung, 3=Referenzfehler, 4=unter Min, 5=ueber Max, 6=nicht vorhanden, 7=Check, 8=Fehler, 9=Kommunikationsfehler Zustände: 0=OK; 1=Kurzschluss; 2=Unterbrechung; 3=Referenzfehler; 4=Unter Minimum; 5=Ueber Maximum; 6=Nicht vorhanden; 7=Pruefung; 8=Fehler; 9=Kommunikationsfehler. |
| `MeldungenAnlageRaw` | `0700` | 32 | `Mixed/String` | — | `text` | aus (`-1`) | Diagnose - Rohes Bitfeld anstehender Meldungen der Waermepumpenregelung |

### Heizkreise und Anlagenbetrieb

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `TempSekVL` | `0105` | 2 | `Number` | °C | `value.temperature` | 30 s | Information - Heizkreis HK1: Vorlauftemperatur Sekundaer 1 (0..95) |
| `TempSekRL` | `0106` | 2 | `Number` | °C | `value.temperature` | 30 s | Diagnose - Anlagenuebersicht: Ruecklauftemperatur Sekundaer 1 (0..95) |
| `TempPriVL` | `0103` | 2 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Anlagenuebersicht: Vorlauftemperatur Primaerquelle (-20..95) |
| `TempPriRL` | `0104` | 2 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Anlagenuebersicht: Ruecklauftemperatur Primaerquelle (-20..95) |
| `TempSek2RL` | `0107` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Diagnose - Anlagenuebersicht: Ruecklauftemperatur Sekundaer 2 (0..95) |
| `TempAnlVL` | `010A` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Allgemein: Anlagenvorlauftemperatur (0..95) |
| `TempSolRL` | `0112` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Solar: Solar Ruecklauftemperatur (0..95) |
| `TempSek2VL` | `0114` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK2: Vorlauftemperatur Sekundaer 2 (0..95) |
| `TempSek3VL` | `0115` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK3: Vorlauftemperatur Sekundaer 3 (0..95) |
| `TempRaumIst` | `0116` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK1: Raumtemperatur HK1 (0..40) |
| `TempRaumIst2` | `0117` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK2: Raumtemperatur HK2 (0..40) |
| `TempRaumIst3` | `0118` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK3: Raumtemperatur HK3 (0..40) |
| `TempKuehlVL` | `0119` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK1: Vorlauftemperatur Kuehlkreis 1 (0..95) |
| `TempKuehlVL2` | `0119` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK1: Vorlauftemperatur Kuehlkreis 1 (0..95) |
| `TempKuehlVL3` | `0119` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK1: Vorlauftemperatur Kuehlkreis 1 (0..95) |
| `TempRaumSoll` | `011B` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK1: Raumsolltemperatur HK1 von FB (10..30) |
| `TempRaumSoll2` | `011C` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK2: Raumsolltemperatur HK2 von FB (10..30) |
| `TempRaumSoll3` | `011D` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Heizkreis HK3: Raumsolltemperatur HK3 von FB (10..30) |
| `AnzHK` | `050D` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Schaltzyklen Anlage: Einschaltungen Heizkreis (?) |
| `StatusAC` | `096C` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Heizkreis HK1: Kuehlung fuer HK1 (0..1) |
| `StatusAC2` | `096D` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Heizkreis HK2: Kuehlung fuer HK2 (0..1) |
| `StatusAC3` | `096E` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Heizkreis HK3: Kuehlung fuer HK3 (0..1) |
| `TempVLSoll` | `1800` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Diagnose - Heizkreis HK1: Vorlaufsolltemperatur HK1 (0..95) |
| `TempVLSoll2` | `1801` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Diagnose - Heizkreis HK2: Vorlaufsolltemperatur HK2 (0..95) |
| `TempVLSoll3` | `1802` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Diagnose - Heizkreis HK3: Vorlaufsolltemperatur HK3 (0..95) |
| `TempRaumSollNormal` | `2000` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Raumsolltemperatur normal (10..30) |
| `TempRaumSollRed` | `2001` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Raumsolltemperatur reduzierter Betrieb (10..30) |
| `HKLNiveau` | `2006` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Niveau der Heizkennlinie (-15..40) |
| `HKLNeigung` | `2007` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Neigung der Heizkennlinie (0..35) |
| `TempRaumSollParty` | `2022` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Party Solltemperatur (10..30) |
| `TempRaumSollNormal2` | `3000` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK2 - Heizkreis 2: Raumsolltemperatur normal (10..30) |
| `TempRaumSollRed2` | `3001` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK2 - Heizkreis 2: Raumsolltemperatur reduzierter Betrieb (10..30) |
| `HKLNiveau2` | `3006` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK2 - Heizkreis 2: Niveau der Heizkennlinie (-15..40) |
| `HKLNeigung2` | `3007` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK2 - Heizkreis 2: Neigung der Heizkennlinie (0..35) |
| `TempRaumSollParty2` | `3022` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK2 - Heizkreis 2: Party Solltemperatur (10..30) |
| `TempRaumSollNormal3` | `4000` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK3 - Heizkreis 3: Raumsolltemperatur normal (10..30) |
| `TempRaumSollRed3` | `4001` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK3 - Heizkreis 3: Raumsolltemperatur reduzierter Betrieb (10..30) |
| `HKLNiveau3` | `4006` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK3 - Heizkreis 3: Niveau der Heizkennlinie (-15..40) |
| `HKLNeigung3` | `4007` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK3 - Heizkreis 3: Neigung der Heizkennlinie (0..35) |
| `TempRaumSollParty3` | `4022` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Bedienung HK3 - Heizkreis 3: Party Solltemperatur (10..30) |
| `KKLNiveau` | `7110` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Niveau Kuehlkennlinie (-15..40) |
| `KKLNeigung` | `7111` | 2 | `Number` | — | `value` | nicht im Profil | Bedienung HK1 - Heizkreis 1: Neigung Kuehlkennlinie (0..35) |
| `Betriebsart` | `B000` | 1 | `String` | — | `text` | 300 s | Bedienung HK1 - Heizkreis 1: Betriebsart (0..4) |
| `BetriebsartHK2` | `B001` | 1 | `String` | — | `text` | 300 s | Betriebsart zweite RAM-Adresse aus Referenzkonfiguration, nur lesend |
| `BetriebsartExternHK1` | `A400` | 1 | `Number` | — | `value` | 60 s | Externer HK1-Modus, read-only live-validiert: 255 bedeutet interne Regelung |
| `BetriebsartExternHK2` | `A440` | 1 | `Number` | — | `value` | 60 s | Externer HK2-Modus, read-only live-validiert: 255 bedeutet interne Regelung |
| `BetriebsartExternHK3` | `A480` | 1 | `Number` | — | `value` | 60 s | Externer HK3-Modus, read-only live-validiert: 255 bedeutet interne Regelung |

### Solar und Kühlung

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `TempSolKoll` | `0111` | 2 | `Number` | °C | `value.temperature` | nicht im Profil | Information - Solar: Solar Kollektortemperatur (-20..190) |
| `StatusActiveCoolingRelais` | `048C` | 1 | `Number` | — | `indicator` | nicht im Profil | Diagnose - Kuehlung: Relais Active Cooling Zustände: 0=Aus; 1=Ein. |
| `StatusPufferBypassKuehlen` | `04B3` | 1 | `Number` | — | `indicator` | nicht im Profil | Information - Kuehlung: Puffer-Ueberbrueckung aktiv Zustände: 0=Aus; 1=Ein. |
| `SolarRegler` | `190A` | 4 | `Number` | °C | `value.temperature` | nicht im Profil | Diagnose - Solar: Solarertrag Reglermethoden (0..1150000) |

### Laufzeiten und Zähler

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `LZAC` | `058C` | 4 | `Number` | h | `value.interval` | 3600 s | Statistik - Betriebsstunden Anlage: Active Cooling in Stunden |
| `LZAbtauband` | `05C1` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden: elektrisches Abtauband/Begleitheizung |
| `LZAbtaupuffer` | `05C6` | 4 | `Number` | h | `value.interval` | nicht im Profil | Statistik - Betriebsstunden: Abtaupuffer |

### Diagnose und Rohdaten

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `AnlagennameRaw` | `0074` | 16 | `Mixed/String` | — | `text` | aus (`-1`) | Information - Allgemein: Anlagenname als Rohbytes |
| `InbetriebnahmeDatumRaw` | `0078` | 3 | `Mixed/String` | — | `text` | aus (`-1`) | Information - Allgemein: Inbetriebnahmedatum als Rohbytes |
| `SystemStatusRaw` | `0080` | 1 | `Number` | — | `value` | aus (`-1`) | Information - Allgemein: interner Systemstatus, Semantik geraeteabhaengig |
| `TempPlattenwaermetauscher` | `0E50` | 3 | `Number` | °C | `value.temperature` | 60 s | Diagnose - Inneneinheit: Plattenwaermetauscher; Status in Byte 2 |
| `StatusExtW` | `048B` | 1 | `Number` | — | `indicator` | nicht im Profil | Diagnose - Allgemein: Relais Ansteuerung ext. Waermeerzeuge (0..1) |
| `LetzteMeldungRaw` | `0710` | 9 | `Mixed/String` | — | `text` | aus (`-1`) | Diagnose - Letzter Meldungspuffereintrag als Rohbytes |

### Allgemein, Identifikation und Konfiguration

| ioBroker-State unter `viessmann.0.get` | Adresse | Bytes | Typ | Einheit | Rolle | Polling | Erklärung / Zustände |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `DevType` | `00F8` | 2 | `String` | — | `info.name` | nicht im Profil | Information - Allgemein: Anlagentyp (204D) |
| `Anlagenschema` | `7700` | 1 | `Number` | — | `value` | nicht im Profil | Information - Anlage: konfiguriertes Anlagenschema |
| `Anlagenzeit` | `08E0` | 8 | `String` | — | `date` | nicht im Profil | Information - Allgemein: Datum und Uhrzeit der Regelung |
| `TempA` | `0101` | 2 | `Number` | °C | `value.temperature` | 300 s | Information - Allgemein: Aussentemperatur (-40..70) |
| `AnzQuelleSek` | `0504` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Schaltzyklen Anlage: Einschaltungen Sekundaerquelle (?) |
| `AnzActiveCooling` | `050C` | 4 | `Number` | — | `value` | nicht im Profil | Statistik - Schaltzyklen: Active Cooling |
| `SpdFanOut` | `1A52` | 1 | `Number` | — | `value` | 30 s | Outdoor Fanspeed |
| `TempOAT` | `1A5C` | 1 | `Number` | °C | `value.temperature` | nicht im Profil | OAT Temperature |
| `TempICT` | `1A5D` | 1 | `Number` | °C | `value.temperature` | nicht im Profil | OCT Temperature |
| `TempCCT` | `1A5E` | 1 | `Number` | °C | `value.temperature` | nicht im Profil | CCT Temperature |
| `TempHST` | `1A5F` | 1 | `Number` | °C | `value.temperature` | nicht im Profil | HST Temperature |
| `TempOMT` | `1A60` | 1 | `Number` | °C | `value.temperature` | nicht im Profil | OMT Temperature |
| `ReceiveHeartbeatKonfiguration` | `779C` | 1 | `Number` | — | `value` | 3600 s | LON Receive-Heartbeat-Konfiguration in Minuten, strikt read-only |

## 9. Forschungs- und Hilfskommandos ohne normalen ioBroker-State

Diese Kommandos beginnen bewusst nicht mit `get` oder `set`. Der Adapter importiert sie daher nicht als normale Datenpunkte. Sie dienen manuellen Rohabfragen und der Protokollforschung.

| vcontrold-Kommando | Adresse | Bytes | Protokollaktion | Einheit | Zweck |
| --- | --- | ---: | --- | --- | --- |
| `readRawA400Byte` | `A400` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A400; encoding not yet confirmed |
| `readRawA401Byte` | `A401` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A401; encoding not yet confirmed |
| `readRawA403Byte` | `A403` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A403; encoding not yet confirmed |
| `readRawA406Byte` | `A406` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A406; encoding not yet confirmed |
| `readRawA3C0Byte` | `A3C0` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A3C0; encoding not yet confirmed |
| `readRawA3C2Byte` | `A3C2` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A3C2; encoding not yet confirmed |
| `readRawA3C5Byte` | `A3C5` | 1 | `getaddr` | — | READ ONLY one-byte candidate for A3C5; encoding not yet confirmed |
| `readRawReceiveHeartbeat779CByte` | `779C` | 1 | `getaddr` | — | READ ONLY first raw byte of LON receive heartbeat parameter |
| `readRawReceiveHeartbeat779CWord` | `779C` | 2 | `getaddr` | — | READ ONLY two-byte comparison for LON receive heartbeat parameter |
| `readScheduleRaw1570` | `1570` | 36 | `geteeprom` | `CO` | EEPROM-Zeitprogramm Testblock ab 0x1570, ausschliesslich lesend |

## 10. Verworfen, unbestätigt oder bewusst gesperrt

| Adresse | Status | Entscheidung |
| --- | --- | --- |
| `0400` | dreimal Fehlercode 1 | Nicht übernommen; vorhandene funktionierende Verdichterstates bleiben maßgeblich. |
| `0404` | dreimal Fehlercode 1 | Nicht übernommen. |
| `5525` | dreimal Fehlercode 1 | Nicht übernommen; `0101` bleibt die funktionierende Außentemperatur. |
| `A401`, `A403`, `A406`, `A3C0`, `A3C5` | direkte Reads jeweils Fehlercode 4 | Keine normalen get-States; Schreibkandidaten nur mit kontrollierter Wirkungsprüfung. |
| `A380`, `A382`, `A383` | zentrale Anlagenmanager-Eingänge mit hoher Eingriffspriorität | Immer für Writes gesperrt. |
| `779C` | Receive-Heartbeat-Konfiguration, gelesen als 20 Minuten | Strikt read-only; nicht ändern. |
| Zeitprogramme / Schedule-Bereiche | möglicherweise persistent | Nur lesen; EEPROM-Write verboten. |

## 11. Adapter-Backport und Artefakte

- Quellpatch: `adapter-patches/ioBroker.viessmann-1.7.4-human-readable.patch`
- Installationspaket: `adapter-patches/iobroker.viessmann-1.7.4-vitocal-backport.tgz`
- Prüfsumme: `adapter-patches/SHA256SUMS`
- Projektprüfung: `npm test`, `npm run check`, `xmllint --noout config/vcontrold.xml config/vito.xml`
- Der Adapter benötigt Node.js 20 oder neuer; ein Wechsel auf Node.js 22 ist für diesen Backport nicht erforderlich.

Der Backport aktualisiert vorhandene Objektmetadaten per Upsert und löscht alte States oder History nicht automatisch. Für reine Anzeigenamen wäre später ein separates `iobrokerDisplayName` sinnvoll, damit die technische State-ID stabil bleibt.

## 12. Deployment- und Rollback-Grundsätze

Vor jedem Deployment werden `vito.xml`, `vcontrold.xml`, Adapterverzeichnis und Instanzkonfiguration gesichert. Nach dem Kopieren werden XML-Syntax, Dienste, Adapterlogs und Objektmetadaten geprüft. Beim reinen Deployment der neuen set-States wird absichtlich kein Heizungswert geschrieben.

Rollback bedeutet:

1. gesicherte XML-Dateien zurückkopieren;
2. vorheriges Adapterverzeichnis beziehungsweise vorheriges TGZ wiederherstellen;
3. vcontrold und `viessmann.0` neu starten;
4. Verbindung, Lesezustände und das Fehlen unerwarteter Writes prüfen.

## 13. Maßgebliche Projektdateien

- `config/vito.xml` – aktive Technik-ID-/Kommando-Definitionen
- `config/vcontrold.xml` – P300-Protokoll, Datentypen, Skalierungen und serielle Schnittstelle
- `config/iobroker-polling.json` – empfohlenes Pollingprofil
- `lib/runtime-datapoints.js` – Runtime-Datenpunktkatalog und Sperradressen
- `lib/runtime-write-guard.js` – weitergehendes Sicherheitsmodell für spätere Automation
- `lib/p300-frame.js` – Offline-Encoder für überprüfbare P300-Schreibrahmen
- `docs/WO1C_RUNTIME_CONTROL.md` – Detailkonzept und Testphasen
- `docs/IOBROKER_MAXIMAL_READOUT.md` – Details zu Leistung, Energie und ioBroker-Darstellung
- `scripts/check-project.js` – automatische Sicherheits- und Konsistenzprüfung

## 14. Offene Punkte

- Live-Deployment der fünf neuen geschützten set-States und objektseitige Prüfung von `write=true`, Rolle, Einheit, Min/Max und Zustandslisten.
- Kontrollierter Einzeltest von A401/A400, danach A403/A400 und zuletzt A3C0/A3C2.
- Receive-Heartbeat-/Timeout-Test ohne zyklische Erneuerung.
- Neustart-/Power-Cycle-Test zur praktischen RAM-Klassifikation.
- Optional separate menschenlesbare `common.name`-Anzeige ohne Änderung der stabilen State-IDs.

---

*Diese Datei wird aus den aktiven XML-Definitionen und dem Pollingprofil erzeugt. Änderungen am Datenpunktkatalog sollten anschließend mit `npm run docs:overview` neu dokumentiert und mit `npm run check` geprüft werden.*

