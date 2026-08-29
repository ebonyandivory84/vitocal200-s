# WO1C Runtime Control - Sicherheits- und Validierungskonzept

## Geltungsbereich

Dieses Dokument gilt für die vorhandene Vitocal 200-S mit Vitotronic 200 WO1C und Geräte-ID `204D`.
Die offizielle Viessmann-Dokumentation beschreibt die A-Datenpunkte als Eingänge externer
Regelungssysteme mit Receive-Heartbeat. Sie beschreibt jedoch nicht vollständig, wie dieselben
Technik-IDs beim direkten P300-/Optolink-Zugriff byteweise kodiert werden.

Darum gilt bis zur praktischen Prüfung die Bezeichnung `externalRuntimeInput` oder
`runtimeCandidate`, nicht `EEPROM-safe`.

## Datenpunktkatalog

| Technik-ID | Funktion | Vorgesehene Nutzung | Risiko / Status |
|---|---|---|---|
| `A400` | Externer HK1-Modus | bevorzugt: `13`; Rückkehr: `255` | 1-Byte-Read und neutraler Write `255` bestätigt; Aktivwert ungetestet |
| `A401` | Externer HK1-Raumsollwert | bevorzugt zusammen mit `A400=13` | 18-24 °C normal, 10-30 °C hart; Rohformat offen |
| `A406` | Effektiver HK1-Raumsollwert | READ, Übernahmeprüfung | Rohformat offen |
| `A403` | Externer HK1-Vorlaufsollwert | nur Expert-Modus mit `A400=100` | stärkerer Override; standardmäßig aus |
| `A440` | Externer HK2-Modus | mögliche spätere HK2-Steuerung; Rückkehr `255` | 1-Byte-Read bestätigt; Write ungetestet |
| `A480` | Externer HK3-Modus | mögliche spätere HK3-Steuerung; Rückkehr `255` | 1-Byte-Read bestätigt; Write ungetestet |
| `A3C2` | Externer WW-Modus | `1` aktiv, `255` interne Regelung | neutraler Write `255` bestätigt; Aktivwert kann Zusatzheizung anfordern und ist ungetestet |
| `A3C0` | Externer WW-Sollwert | 40-50 °C normal | Hardlimit 55 °C; Rohformat offen |
| `A3C5` | Effektiver WW-Sollwert | READ, Übernahmeprüfung | Rohformat offen |
| `B020` | 1x Warmwasser | manuelles Ereignis, nur `0` oder `2` | direkter Kompatibilitäts-State wieder aktiv; kein zyklischer Write |
| `B000` | Betriebsart | manuelle Legacy-/Kompatibilitätsbedienung, nur `0/1/2` | direkter State wieder aktiv; Persistenz unbekannt, keine Automatik |
| `A380` | Anlagen-Mindestleistung | nur dokumentieren | höchste Priorität; Write immer gesperrt |
| `A382` | Anlagenmodus | Forschung | kein produktiver Write |
| `A383` | Anlagen-Vorlaufsollwert | Forschung | kein produktiver Write |
| `779C` | LON Receive-Heartbeat | maximal READ | Konfigurationsparameter; niemals ändern |
| Schedule/EEPROM | Zeitprogramme | READ ONLY | EEPROM-Write verboten |

## Offizielle logische Semantik

### Heizkreis HK1

Die bevorzugte spätere PV-Strategie ist:

1. moderaten ganzzahligen Sollwert an `A401` vorgeben,
2. anschließend `A400=13` (`HVAC_ECONOMY`) aktivieren,
3. bei Ende immer explizit `A400=255` senden.

Bei der Wärmepumpen-spezifischen Abbildung bleibt mit `HVAC_ECONOMY` die interne Ermittlung des
Vorlaufsollwerts über Heizkennlinie und weitere interne Schutz-/Sparfunktionen maßgeblich. Die
Viessmann-Anwendungshinweise beschreiben für diese externe Anforderung keine Anforderung der
Zusatzheizung. `A400=1` darf nur im Expert-Modus verwendet werden, weil eine verzögerte
Zusatzheizung möglich ist. `A400=100` plus `A403` übersteuert einen größeren Teil der internen
Heizkreislogik und bleibt experimentell.

### Warmwasser

Die spätere dynamische WW-Strategie ist:

1. moderaten ganzzahligen Sollwert an `A3C0` vorgeben,
2. anschließend `A3C2=1` aktivieren,
3. Heizstab-Relais `0488` und `0489` überwachen,
4. bei Ende oder Heizstabeinsatz explizit `A3C2=255` senden.

Die externe WW-Anforderung kann laut Viessmann eine Zusatzheizung zuschalten. Sie ist daher nicht
heizstabsicher. `A3C0` bleibt zunächst bei 40-50 °C und kann softwareseitig nie über 55 °C gesetzt
werden.

### Receive-Heartbeat

Für Wärmepumpen nennt Viessmann den Parameter `779C`; die Werkseinstellung beträgt 20 Minuten.
Vitogate erneuert schreibbare `0xAnnn`-Eingänge auf LON zyklisch. Daraus folgt nicht automatisch,
dass ein direkter Optolink-Write denselben Heartbeat bedient. `779C` bleibt unverändert und
read-only. Ein eigener 60-Sekunden-Refresh bleibt deaktiviert, bis ein separater 20- bis
25-minütiger Timeout-Test das Verhalten an dieser konkreten WO1C bestätigt hat.

## Rohkodierungsstatus

Die Suche in den vorhandenen Benutzer-XMLs, dem OpenV-Wiki, dem vcontrold-Quellbaum und den
lokalen Vitosoft-Recherchedateien ergab zunächst keine belastbare direkte Optolink-Definition für
die A-Technik-IDs. Am 27. August 2026 wurden deshalb zuerst ausschließlich lesende P300-Abfragen
an der konkreten WO1C durchgeführt. Danach folgten nach ausdrücklicher Freigabe zwei
zustandsneutrale Schreibtests mit dem bereits gelesenen Neutralwert `255`.

| Technik-ID | Drei Live-Reads | Ergebnis |
|---|---|---|
| `A400` | `FF`, `FF`, `FF` | 1 Byte lesbar; aktuell 255 / interne Regelung |
| `A3C2` | `FF`, `FF`, `FF` | 1 Byte lesbar; aktuell 255 / interne WW-Regelung |
| `A440` | zweimal `FF` | HK2-Modus 1 Byte lesbar; aktuell 255 / interne Regelung |
| `A480` | zweimal `FF` | HK3-Modus 1 Byte lesbar; aktuell 255 / interne Regelung |
| `779C` | `14`, `14`, `14` | 1 Byte lesbar; 0x14 = 20 Minuten |
| `B420` | mehrfach `0000` | 2 Byte lesbar; Luefterdrehzahl Verdichter, Anlage beim Test inaktiv |
| `B421` | mehrfach `0000` | 2 Byte lesbar; Drehzahl Sekundaerpumpe, Anlage beim Test inaktiv |
| `B423` | mehrfach `0000` | 2 Byte lesbar; Leistung Verdichter als Rohwert, Einheit/Skalierung noch offen |
| `B424` | mehrfach `0000` | 2 Byte lesbar; Stellung Expansionsventil als Rohwert, Einheit/Skalierung noch offen |
| `A401` | dreimal Fehlercode 4 | direkter Read auf dieser WO1C nicht verfügbar oder anders abgebildet |
| `A403` | dreimal Fehlercode 4 | direkter Read auf dieser WO1C nicht verfügbar oder anders abgebildet |
| `A406` | dreimal Fehlercode 4 | direkter Read auf dieser WO1C nicht verfügbar oder anders abgebildet |
| `A3C0` | dreimal Fehlercode 4 | direkter Read auf dieser WO1C nicht verfügbar oder anders abgebildet |
| `A3C5` | dreimal Fehlercode 4 | direkter Read auf dieser WO1C nicht verfügbar oder anders abgebildet |
| `A441/A443/A446` | zweimal Fehlercode 4 | HK2-Soll-/Effektivwerte direkt nicht verfügbar oder anders abgebildet |
| `A481/A483/A486` | zweimal Fehlercode 4 | HK3-Soll-/Effektivwerte direkt nicht verfügbar oder anders abgebildet |

`A400`, `A3C2` und `779C` sind deshalb als aktive read-only-Kommandos in `config/vito.xml`
aufgenommen. Die übrigen Punkte bleiben ausschließlich als `readRaw...`-Forschungskommandos
vorhanden. Aus einer erfolgreichen Lesung wird keine Write-Sicherheit oder RAM-Persistenz abgeleitet.

### Offline validierte P300-Schreibrahmen

Die Quellcodeprüfung von vcontrold bestätigt, dass `uchar` genau ein Byte erzeugt, `SETADDR` den
P300-Funktionscode `00 02` verwendet und die Prüfsumme aus Längenbyte plus Payload gebildet wird.
Der Offline-Encoder in `lib/p300-frame.js` reproduziert damit folgende Rahmen:

| Logische Vorgabe | Vollständiger P300-Rahmen |
|---|---|
| `A400=13` / Heizen mit `HVAC_ECONOMY` | `41 06 00 02 A4 00 01 0D BA` |
| `A400=255` / interne HK1-Regelung | `41 06 00 02 A4 00 01 FF AC` |
| `A3C2=1` / externe WW-Anforderung | `41 06 00 02 A3 C2 01 01 6F` |
| `A3C2=255` / interne WW-Regelung | `41 06 00 02 A3 C2 01 FF 6D` |

Am 27. August 2026 bestätigte die reale WO1C `A400=255` und `A3C2=255` jeweils mit `OK`; der
unmittelbare Readback blieb `255`, Heizstab Stufe 1/2 blieb aus und die Verdichterleistung blieb
`0 W`. Damit sind Telegrammformat, Geräteannahme und neutraler Rücksetzpfad für diese beiden Werte
bestätigt. Nicht bestätigt sind die Aktivwerte `A400=13` und `A3C2=1`, Sollwertübergabe,
Heartbeat-/Timeout-Verhalten und Persistenz. Die A-Set-Kommandos wurden nach dem Test zunächst
wieder entfernt und am 29. August 2026 auf ausdrücklichen Wunsch als eng begrenzte, noch
ungetestete Runtime-Kandidaten in die produktive XML aufgenommen. Allein das Exponieren der States
sendet noch kein Schreibtelegramm.

Eine Adresse darf im `RuntimeWriteGuard` erst freigegeben werden, wenn folgende Evidenz erfasst ist:

- bestätigte Payload-Länge,
- vcontrold-Datentyp,
- Skalierung,
- Endianness beziehungsweise `not-applicable` bei einem Byte,
- mindestens drei konsistente reale Lesezyklen oder eine eindeutige OpenV-/vcontrold-Quelldefinition,
- plausibler Vergleich von `A406` und `A3C5` mit den angezeigten Sollwerten.

## Geschützte Write-Schicht im ioBroker-Backport

Auf dem Raspberry ist `iobroker.viessmann` Version 1.7.4 installiert. Der ursprüngliche Adapter
erzeugte aus jedem XML-Kommando mit Präfix `set` einen beschreibbaren State und stellte jede
State-Änderung ungeprüft als vcontrold-Kommando in seine Warteschlange. Der lokale Backport wurde
deshalb um eine fest kodierte Kommando-/Adress-Whitelist, Integer- und Wertebereichsprüfung,
ein adressbezogenes Rate-Limit und einen `ack`-Filter erweitert. Ein XML-Eintrag allein kann damit
keine beliebige neue Schreibadresse aktivieren.

Die beiden vorhandenen Kompatibilitätsdefinitionen `setBetriebsart` (`B000`) und `setWWEinmal`
(`B020`) bleiben auf `0/1/2` beziehungsweise `0/2` begrenzt. Die Befehle verwenden P300 `SETADDR`
und nicht das separate EEPROM-Schreibkommando. Die Persistenz von `B000` bleibt trotzdem unbekannt.

Zusätzlich sind genau fünf externe A-Eingänge als beschreibbare States exponiert. Der Backport
akzeptiert nur folgende Kombinationen:

| State | Adresse | Adapterseitig erlaubte Werte |
|---|---|---|
| `set.BetriebsartExternHK1` | `A400` | `1`, `13`, `100`, `255` |
| `set.RaumsollExternHK1` | `A401` | ganzzahlig `18..24 °C` |
| `set.VorlaufsollExternHK1` | `A403` | ganzzahlig `20..45 °C` |
| `set.WWBetriebsartExtern` | `A3C2` | `1`, `255` |
| `set.WWSollExtern` | `A3C0` | ganzzahlig `40..50 °C` |

Unbekannte Kommandos, abweichende XML-Adressen, Werte außerhalb dieser Grenzen, nicht ganzzahlige
Werte und Wiederholungen innerhalb einer Sekunde werden verworfen. Erfolgreich von vcontrold mit
`OK` bestätigte Writes werden im State mit `ack=true` quittiert und dadurch nicht erneut gesendet.

## RuntimeWriteGuard

Der Guard in `lib/runtime-write-guard.js` erzwingt:

- expliziten Datenpunktkatalog statt generischem Adress-Write,
- globales Feature-Flag, standardmäßig `false`,
- Hardware-Verfügbarkeit,
- adressbezogene Readback-/Encoding-Validierung,
- ganzzahlige und enge Sollwertbereiche,
- separate Expert-Flags,
- Rate-Limit und Duplikatunterdrückung,
- ununterdrückbare Resetwerte `255`,
- Sollwert-vor-Modus-Reihenfolge,
- Refresh nur bei aktivem Override,
- Best-Effort-Reset bei stale inputs und Shutdown,
- Kommunikationsfehler-Latch ohne weitere Schreibversuche.

`A380`, `A382`, `A383`, `779C`, bekannte permanente Sollwerte, Schedule-Bereiche und unbekannte
Adressen werden unabhängig von Feature-Flags blockiert. `enableExperimentalPlantManager` ist
vorbereitet, hebt die Sperre für `A380` aber ausdrücklich nicht auf.

## ioBroker-States

Lesestates nach verifizierter Lesekodierung:

- `viessmann.0.get.BetriebsartExternHK1`
- `viessmann.0.get.BetriebsartExternHK2`
- `viessmann.0.get.BetriebsartExternHK3`
- `viessmann.0.get.RaumsollExternHK1`
- `viessmann.0.get.RaumsollEffektivHK1`
- `viessmann.0.get.VorlaufsollExternHK1`
- `viessmann.0.get.WWBetriebsartExtern`
- `viessmann.0.get.WWSollExtern`
- `viessmann.0.get.WWSollEffektiv`

Die fünf Runtime-Kandidaten erscheinen bewusst als geschützte `viessmann.0.set.*`-States. Für eine
spätere Automatik bleibt eine vollständige `RuntimeWriteGuard`-Integration mit Diagnosezuständen
vorgesehen, unter anderem:

- `info.runtimeControlAvailable`
- `info.runtimeControlValidated`
- `info.runtimeHeartbeatValidated`
- `info.runtimeControlActive`
- `info.runtimeControlMode`
- `info.lastRuntimeWrite`
- `info.lastRuntimeReadback`
- `info.runtimeWriteError`
- `info.optolinkConnected`
- getrennte Aktivanzeigen für Heizung und Warmwasser

## Leistung und tatsächlicher Stromverbrauch

`16A4` ist die von der Regelung berechnete elektrische Verdichterleistung in Watt. Der Wert umfasst
nicht zuverlässig Heizstab, Pumpen, Regelung, Standby und sonstige Verbraucher. Die Register
`1660` und `1670` liefern elektrische Energiebilanzen des Verdichters für Heizen und Warmwasser;
`1640` und `1650` sind die entsprechenden thermischen Energieregister. `163F` ist der zugehörige
Energiefaktor. `0488` und `0489` zeigen die beiden Heizstab-Relaisstufen.

Für die reale gesamte Leistungsaufnahme und eine belastbare PV-Regelung ist ein externer
dreiphasiger Stromzähler in der Wärmepumpenzuleitung die maßgebliche Quelle. Die internen Register
sind nützliche Diagnose- und Lernwerte, aber kein Ersatz für diesen Zähler.

## Live-Validierung nach Rückkehr des Optolink-Kabels

### Phase A - nur lesen

1. CP2102 unter `/dev/serial/by-id` eindeutig identifizieren.
2. Die sieben A-Datenpunkte mehrfach lesen und Rohtelegramm, Payload, Länge und Dekodierung loggen.
3. Mindestens drei konsistente Zyklen erfassen.
4. `A406` und `A3C5` auf Plausibilität prüfen.
5. Erst danach lokale Read-Kommandos ergänzen und erneut testen.

### Phase B - separater, manueller A400/A401-Test

Erst nach ausdrücklicher Freigabe: Baseline erfassen, `A401` auf aktuellen Sollwert oder höchstens
+1 K setzen, danach `A400=13`, sofort alles zurücklesen, Heizstabstatus prüfen und den kurzen Test
immer explizit mit `A400=255` beenden.

### Phase C - separater Heartbeat-Test

Erst nach erfolgreicher Phase B: Override setzen, 20-25 Minuten keine Erneuerung senden und
beobachten, ob die interne Regelung tatsächlich wieder übernimmt. Erst dieses Ergebnis darf
`runtimeHeartbeatValidated=true` setzen.

### Phase D - Warmwasser

Erst nach den Heizkreisprüfungen: moderater Zielwert (typisch 45 °C), `A3C2=1`, `A3C5`, Verdichter
und `0488/0489` beobachten und explizit mit `A3C2=255` beenden. Bei Heizstabeinsatz sofort abbrechen.

## Zeitprogramme und EEPROM

Zeitprogramme bleiben ausschließlich lesbar. `readScheduleRaw1570` nutzt das P300-EEPROM-Read-
Kommando. In der Projektprüfung ist ein aktiver EEPROM-Write ausdrücklich verboten. Für die
gewünschte Automatik ersetzen temporäre `A400/A401`- beziehungsweise `A3C2/A3C0`-Vorgaben später
das häufige Umschreiben von Zeitprogrammen.

## Quellen

- Viessmann, *Vitogate 300 Datenpunktliste - 204D Vitocal xxx-S, Vitotronic 200 Typ WO1C*, ab Version 2.1.2.0.
- Viessmann, *Vitogate 300 - Anwendungshinweise für verschiedene Wärmeerzeuger*, Dokument 5799740.
- OpenV GitHub Issue 681 und die dort verlinkten WO1C-Erfahrungswerte wurden nur als Community-Evidenz für Leistungsregister behandelt, nicht als Herstellerbeleg für Genauigkeit oder Runtime-Persistenz.
