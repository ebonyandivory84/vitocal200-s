# Maximale lesende Auswertung der Vitocal 200-S (WO1C / 204D)

Stand: 29. August 2026

## Ergebnis

`config/vito.xml` stellt die verifizierten beziehungsweise klar gekennzeichneten Community-Diagnoseadressen als reine Lesepunkte bereit. `config/vcontrold.xml` dekodiert Temperaturen, Laufzeiten, Prozentwerte, Sensorstatus, Druck, Leistung und Heizstabstufen bereits vor der Übergabe an ioBroker.

Der bevorzugte Rückport
`adapter-patches/ioBroker.viessmann-1.7.4-human-readable.patch` ergänzt die für eine saubere Darstellung nötige ioBroker-Seite, ohne einen Wechsel auf Adapter 2.0.5 zu erzwingen:

- vorhandene Objekte werden mit aktuellen Namen, Einheiten, Rollen, Wertebereichen und Zustandsbezeichnungen aktualisiert;
- alte States und deren Historie werden absichtlich nicht automatisch gelöscht;
- Text- und Rohantworten bleiben Strings und verlieren keine führenden Nullen oder nachfolgenden Bytes;
- Energiebilanzen werden mit dem zur Anlage gehörenden Register `163F` dynamisch in kWh umgerechnet;
- der XML-Neuimport übernimmt bestehende Pollingintervalle anhand von Kommando- oder State-Namen;
- die explizit freigegebenen SETADDR-Kommandos werden durch eine feste Kommando-/Adress-Whitelist, Werteprüfung, Rate-Limit und `ack`-Filter geschützt.

Der Rückport ist exakt gegen den offiziellen Git-Tag `v1.7.4` erstellt und unter Node.js 20 getestet. Adapter 1.7.4 deklariert Node.js 20 oder neuer; Node 22 ist dafür nicht erforderlich. Falls auf dem ioBroker-Host noch Node 18 oder älter läuft, ist mindestens ein Update auf Node 20 nötig.

Zusätzlich zum Quellpatch liegt mit `adapter-patches/iobroker.viessmann-1.7.4-vitocal-backport.tgz` ein fertig gepacktes Installationsartefakt vor. Seine SHA-256-Prüfsumme steht in `adapter-patches/SHA256SUMS`. Das Paket behält intern bewusst die Adapterversion 1.7.4 und ersetzt deshalb nur eine zuvor gesicherte Installation derselben Version.

Der Patch für `ioBroker.viessmann` 2.0.5 bleibt als spätere Alternative unter `adapter-patches/ioBroker.viessmann-2.0.5-human-readable.patch` erhalten und benötigt Node.js 22 oder neuer.

## Geschützte Runtime-Schreibkandidaten

Folgende neuen Objekte werden unter `viessmann.0.set` angelegt und sind in ioBroker grundsätzlich
beschreibbar. Das Anlegen oder der Adapterstart sendet noch keinen Wert:

| ioBroker-State | Adresse | Erlaubte Werte |
| --- | --- | --- |
| `BetriebsartExternHK1` | `A400` | `1`, `13`, `100`, `255` |
| `RaumsollExternHK1` | `A401` | ganzzahlig `18..24 °C` |
| `VorlaufsollExternHK1` | `A403` | ganzzahlig `20..45 °C` |
| `WWBetriebsartExtern` | `A3C2` | `1`, `255` |
| `WWSollExtern` | `A3C0` | ganzzahlig `40..50 °C` |

Der Adapter prüft zusätzlich, dass jedes Kommando exakt mit seiner erwarteten Technik-ID verbunden
ist. Andere XML-SET-Kommandos erhalten dadurch keinen generischen Schreibweg. Alle fünf verwenden
P300 `SETADDR`; ein EEPROM-Schreibmakro ist nicht aktiv. Die endgültige RAM-/Timeout-Einordnung
bleibt trotzdem Gegenstand der getrennten Mehr-Punkte-Livetests.

## Die für Leistung und Heizstab entscheidenden States

| ioBroker-State unter `viessmann.0.get` | Adresse | Einheit | Bedeutung |
| --- | --- | --- | --- |
| `LeistungElektrischVerdichter` | `16A4` | W | von der Regelung berechnete momentane elektrische Verdichterleistung |
| `LeistungThermischHeizen` | `16A0` | W | momentan abgegebene thermische Leistung im Heizbetrieb |
| `LeistungThermischWW` | `16A1` | W | momentan abgegebene thermische Leistung bei Warmwasserbereitung |
| `AnlagenIstleistungProzent` | `A38F`, Byte 0 | % | zentrale Anlagen-Istleistung; Rohwert 0..200 wird in 0,5-%-Schritten dekodiert |
| `StatusAnlagenIstleistung` | `A38F`, Byte 1 | 0/1 | Status der zentralen Anlagen-Istleistung: Anlage aus/ein |
| `LeistungHeizstab` | `1909` | W | Community-Adresse, 3-kW-Stufen; mit den Relaiszuständen plausibilisieren |
| `StatusHeizstabSt1` | `0488` | 0/1 | Relais der ersten Heizstabstufe |
| `StatusHeizstabSt2` | `0489` | 0/1 | Relais der zweiten Heizstabstufe |
| `StatusWWNachheizung` | `048A` | 0/1 | Relais der elektrischen Warmwasser-Nachheizung |
| `KonfigurierteLeistungHeizstab` | `7907` | W | konfigurierte maximale Heizstableistung: Rohwert 1/2/3 wird als 3000/6000/9000 W dargestellt; kein Liveverbrauch |
| `StatusEVUSperreHeizstab` | `03C4` | 0/1 | Eingang der EVU-Sperre für den Heizwasser-Durchlauferhitzer |
| `FreigabeElektroWW` | `6015` | 0/1 | konfigurierte Freigabe für elektrische Warmwasserbereitung |
| `StrategieElektroWW` | `6040` | Zahl/Status | Regelstrategie für elektrische Warmwasser-Nachladung; Codierung firmwareabhängig |

Für eine robuste Heizstaberkennung sollten `0488`, `0489` und `1909` gemeinsam betrachtet werden. Ein einzelner Wert aus `1909` ist wegen seiner Community-Herkunft noch kein ausreichender Beweis. Typische Plausibilität:

- beide Relais aus und `1909 = 0 W`: Heizstab aus;
- eine Relaisstufe ein und ungefähr `3000 W`: eine Stufe aktiv;
- beide Relaisstufen ein und ungefähr `6000 W`: zwei Stufen aktiv;
- Widerspruch zwischen Register und Relais: Rohwerte protokollieren und `1909` nicht für Automationen verwenden.

Eine sinnvolle Schätzung ist:

```text
geschätzte elektrische Wärmepumpenleistung
  = LeistungElektrischVerdichter + LeistungHeizstab
```

Diese Summe enthält Pumpen, Regelung, Außengerät-Nebenverbrauch und Standby nicht sicher. Für den realen Gesamtverbrauch der Wärmepumpe bleibt ein eigener dreiphasiger Energiezähler in ihrer Zuleitung die maßgebliche Quelle.

## Warum bisher scheinbare Rohwerte erschienen

Es lagen mehrere unterschiedliche Ursachen vor:

1. Energiebilanzregister `1640`, `1650`, `1660` und `1670` sind keine direkt gespeicherten kWh. Es gilt:

   ```text
   kWh = Rohwert × EnergieFaktor(163F) / 10
   ```

2. Laufzeitregister speichern Sekunden. Die neue Einheit `CS` rechnet sie mit `V / 3600` in Stunden um.
3. `B420` bis `B424` liefern zwei Bytes. Byte 0 ist der Prozentwert, Byte 1 der Sensorstatus. Die Einheiten `PSB0` und `SSB1` trennen beide Informationen.
4. `A38F` liefert ebenfalls zwei Bytes, aber Byte 0 verwendet 0,5-%-Schritte. `PHB0` rechnet deshalb `B0 / 2`; Byte 1 wird separat als Anlagenstatus ausgewertet. Die Adresse wurde am realen Gerät dreimal fehlerfrei gelesen. Die ebenfalls geprüften fremden Kandidaten `0400`, `0404` und `5525` lieferten dagegen reproduzierbar Fehlercode 1 und wurden nicht übernommen.
5. Diagnosepuffer ohne numerische Einheit sind Byte-/Textfolgen. Der bisherige Adapter versuchte dennoch, einen Zahlenanfang zu extrahieren. Der Patch erhält die vollständige Antwort als String.
6. `5030` und `5130` sind Konfigurations- beziehungsweise Nennwerte des Verdichters, keine aktuelle elektrische Leistungsaufnahme.
7. `7907` wurde am realen Gerät viermal als `0x03` gelesen. Da gleichzeitig `0488`, `0489` und `1909` jeweils null meldeten, beschreibt die Adresse die konfigurierte maximale Heizstableistung von 9 kW und nicht die momentane Aufnahme.
8. `5012` wurde viermal als `0x0F` gelesen und wird als read-only Verdichter-Betriebsartenfreigabe `Standardfreigabe` dargestellt. Der aktuelle Verdichterbetrieb wird weiterhin über die vorhandenen Relais-, Leistungs- und Modulationswerte bestimmt.

Die vier neuen `...KWh`-States sind die menschenlesbaren Energiewerte. Die gleichnamigen States ohne `KWh` bleiben als Diagnose-Rohwerte vorhanden, werden im empfohlenen Pollingprofil aber nicht zyklisch gelesen.

## Effizienzwerte

| State | Adresse | Länge | Skalierung |
| --- | --- | --- | --- |
| `JAZ` | `1680` | 1 Byte | `V / 10` |
| `JAZHeiz` | `1681` | 1 Byte | `V / 10` |
| `JAZWW` | `1682` | 1 Byte | `V / 10` |
| `COPHeiz` | `1690` | 2 Byte | `V / 10` |

JAZ und COP sind Anlagenwerte der Regelung. Für Abrechnung oder eine belastbare Arbeitszahl sollte weiterhin der externe Stromzähler mit einem geeigneten Wärmemengenzähler verglichen werden.

## Pollingprofil

`config/iobroker-polling.json` ist ein produktiver, detailreicher Vorschlag:

- Heizstab, Verdichterleistung und wichtige Relais: 10 bis 15 Sekunden;
- Modulation, Pumpen und Verdichter-Sollwerte: 30 Sekunden;
- Kältekreis-Temperaturen und Drücke: 60 Sekunden;
- Konfiguration und Sensorstatus: 5 bis 10 Minuten;
- Zähler, Laufzeiten, JAZ und Energie: 1 Stunde;
- unsichere Identifikations- und Meldungspuffer: `-1`, also standardmäßig deaktiviert.

`EnergieFaktor` steht im Profil und im XML vor den skalierten kWh-States. Beim ersten Start kann der Adapter zusätzlich auf den zuletzt in ioBroker gespeicherten Faktor zurückgreifen. Fehlt ein positiver Faktor vollständig, veröffentlicht er bewusst keinen irreführend beschrifteten kWh-Wert.

Nicht jede Vitocal-Variante beantwortet jeden Diagnosepunkt. Wiederholte `ERR`-Antworten sollten für den betreffenden State zu einem Pollingintervall von `-1` führen.

## Installation und Migration

1. Vor Änderungen die produktiven Dateien und die ioBroker-Instanzkonfiguration sichern:

   ```sh
   cp /etc/vcontrold/vito.xml /etc/vcontrold/vito.xml.bak-20260828
   cp /etc/vcontrold/vcontrold.xml /etc/vcontrold/vcontrold.xml.bak-20260828
   ```

2. Die beiden Dateien aus `config/` in das tatsächlich konfigurierte vcontrold-Verzeichnis kopieren und dort prüfen:

   ```sh
   xmllint --noout /etc/vcontrold/vcontrold.xml /etc/vcontrold/vito.xml
   ```

3. `vcontrold` neu starten und zunächst einige entscheidende Kommandos direkt testen:

   ```text
   getLeistungElektrischVerdichter
   getLeistungHeizstab
   getStatusHeizstabSt1
   getStatusHeizstabSt2
   getEnergieFaktor
   ```

4. Auf dem ioBroker-Host `node --version` prüfen. Für den Rückport auf Adapter 1.7.4 muss das Ergebnis mindestens Node 20 sein.
5. Im Quellverzeichnis einer unveränderten offiziellen Adapterversion 1.7.4 den Rückport prüfen und anwenden:

   ```sh
   git apply --check /pfad/ioBroker.viessmann-1.7.4-human-readable.patch
   git apply /pfad/ioBroker.viessmann-1.7.4-human-readable.patch
   npm ci
   npm test
   npm run lint
   ```

6. Den Adapter installieren beziehungsweise neu starten und einen XML-Neuimport auslösen.
7. Das Pollingprofil in der Adapterkonfiguration übernehmen. Bereits vorhandene Intervalle werden vom Patch nach Kommando oder State-Namen bewahrt; neue States starten andernfalls mit `-1`.
8. Alte oder umbenannte States bleiben absichtlich erhalten. Erst nach mehreren Tagen Vergleich und nach Kontrolle vorhandener History-Verknüpfungen manuell stilllegen oder löschen.

## Abnahme am realen Gerät

Während einer Warmwasserladung sollten mindestens diese Werte mit Zeitstempel aufgezeichnet werden:

- Haus- oder Wärmepumpenzähler in W;
- `LeistungElektrischVerdichter`;
- `LeistungHeizstab`;
- `StatusHeizstabSt1` und `StatusHeizstabSt2`;
- `StatusWWNachheizung`;
- Warmwasser-Ist und -Soll;
- Außentemperatur;
- `FreigabeElektroWW`, `StrategieElektroWW` und die beiden Warmwasser-Hysteresen.

Erst wenn `1909` bei mindestens drei Schaltvorgängen zu den beiden Relais und zum externen Zähler passt, sollte `LeistungHeizstab` als verlässlicher Leistungswert für Visualisierung oder Alarmierung verwendet werden.

## Sicherheitsgrenze

Diese Erweiterung dient der Beobachtung. Sie ergänzt keine Schreibadresse und ändert keine vorhandene Schreibsemantik. Aktiv bleiben nur die bereits vorhandenen manuellen Kompatibilitätskommandos `setBetriebsart` (`B000`) und `setWWEinmal` (`B020`). Alle experimentellen A-Adressen bleiben in der produktiven XML read-only.
