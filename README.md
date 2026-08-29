# Vitocal 200-S WO1C: vcontrold und sichere Runtime-Steuerung

Dieses Projekt enthält die vom Raspberry Pi gesicherten vcontrold-Konfigurationen,
eine strikt geschützte Vorbereitung der offiziellen externen WO1C-Runtime-Eingänge
und den Validierungsplan für die Geräte-ID `204D`.

Aktueller Status:

- Bestehende Leistungs-, Energie- und Heizstab-Lesepunkte sind in `config/vito.xml` enthalten.
- Die beiden vorhandenen manuellen Kompatibilitaetskommandos `setBetriebsart` (`B000`, nur `0/1/2`) und `setWWEinmal` (`B020`, nur `0/2`) sind auf ausdruecklichen Wunsch lokal und auf dem Raspberry wieder aktiv. Sie nutzen P300 `SETADDR`, nicht den EEPROM-Schreibbefehl, duerfen aber nicht zyklisch angesteuert werden.
- Die fuenf externen Runtime-Kandidaten `A400`, `A401`, `A403`, `A3C2` und `A3C0` sind auf ausdruecklichen Wunsch als beschreibbare `viessmann.0.set.*`-States vorbereitet und am 29. August 2026 produktiv deployt. Der Adapter akzeptiert ausschliesslich eine fest kodierte Kommando-/Adress-Whitelist, ganzzahlige sichere Wertebereiche und ignoriert `ack=true`; unbekannte SET-Kommandos bleiben blockiert.
- Alle Runtime-Feature-Flags stehen standardmäßig auf `false`.
- Am 27. August 2026 wurden nach ausdruecklicher Freigabe genau zwei zustandsneutrale reale Schreibtelegramme gesendet: `A400=255` und `A3C2=255`. Beide wurden mit `OK` bestaetigt und unmittelbar als `255` zurueckgelesen; Heizstab und Verdichter blieben aus. Aktivwerte wurden nicht geschrieben.
- Der CP2102-Optolink-Adapter wird wieder stabil unter `/dev/serial/by-id` erkannt. `A400`, `A3C2`, `A440`, `A480` und `779C` sind als Ein-Byte-Reads bestaetigt und als produktive Read-States aufgenommen; die zugehoerigen Soll-/Effektivwerte liefern auf dieser WO1C ueber direkten P300-Zugriff Fehlercode 4.
- Die zusaetzlichen 204D-Referenzadressen `B420`, `B421`, `B423` und `B424` antworten als 2-Byte-Reads ohne Fehlercode und sind als produktive Read-States aufgenommen. Einheit und Skalierung von `B423`/`B424` bleiben bis zur Beobachtung bei laufendem Verdichter als Rohwerte gekennzeichnet.
- Der rein lesende Live-Test am 29. August 2026 verwarf die fremden Kandidaten `0400`, `0404` und `5525` nach jeweils drei reproduzierbaren Fehlercode-1-Antworten. Nur `A38F` antwortete dreimal konsistent mit zwei Bytes und wurde ergänzend als Anlagen-Istleistung in Prozent sowie Anlagenstatus aufgenommen; bestehende Adressen wurden nicht ersetzt.
- Der rein lesende Community-Abgleich am 29. August 2026 bestätigte in vier Durchläufen `7907=0x03` und `5012=0x0F`. Beide Werte sind als stündlich gelesene, strikt read-only Konfigurationsdatenpunkte aufgenommen: konfigurierte Heizstableistung `9000 W` und Verdichter-Betriebsartenfreigabe `Standardfreigabe`. `B0D0=0x00` war ebenfalls lesbar, bleibt wegen der ungeklärten Doppelung zu `B020` aber nur ein manuelles Forschungskommando.
- Die beiden neuen read-only States sind produktiv deployt: `viessmann.0.get.KonfigurierteLeistungHeizstab=9000 W` und `viessmann.0.get.FreigabeVerdichterBetriebsarten=15` (`Standardfreigabe`). Beide Objekte besitzen `write=false`, werden stündlich gelesen, und die Deployment-Logprüfung ergab null SETADDR-Kommandos.
- Die vcontrold-Quellcodeanalyse und `lib/p300-frame.js` validieren die Ein-Byte-P300-Rahmung. Fuer `A400` und `A3C2` ist jetzt zusaetzlich die Geraeteannahme des Neutralwerts `255` belegt; Aktivwirkung, Timeout und Persistenz bleiben unbestaetigt.
- Das Exponieren der neuen Schreib-States sendet selbst kein Telegramm. Reale Aktivwerte werden erst in den dokumentierten Einzeltests geschrieben; bis dahin bleiben die Punkte Runtime-Kandidaten und gelten nicht als abschliessend RAM-validiert.
- Beim produktiven XML-Neuimport wurden alle fuenf Objekte mit `write=true` und korrekten Metadaten angelegt. Alle zugehoerigen States blieben ohne Wert, und die Logpruefung ergab null neue SETADDR-Kommandos.
- Die produktiv gewünschten ioBroker-Polling-Intervalle sind in `config/iobroker-polling.json` versioniert, weil ein XML-Neuimport des Adapters alle Intervalle auf `-1` zurücksetzt.

## Lokale Prüfung

```sh
npm test
npm run check
xmllint --noout config/vcontrold.xml config/vito.xml
```

Die technische Einordnung, die geplanten ioBroker-States und der sichere Live-Testablauf stehen in
`docs/WO1C_RUNTIME_CONTROL.md`.

Die zentrale, automatisch aus XML und Pollingprofil erzeugte Gesamtdokumentation steht in
`VITOCAL_200S_VCONTROLD_IOBROKER_UEBERSICHT.md`. Sie enthält den vollständigen aktiven
`viessmann.0.get`-Katalog, alle freigegebenen `set`-Werte und die RAM-/Heartbeat-Testprozedur.

## Maximale lesende Auswertung und ioBroker-Darstellung

Die optimierten Leistungs-, Energie-, Heizstab-, Kältekreis-, Laufzeit- und Diagnosedatenpunkte sind in `config/vito.xml` und `config/vcontrold.xml` enthalten. Das empfohlene produktive Pollingprofil steht in `config/iobroker-polling.json`.

Für die vorhandene Installation liegt unter `adapter-patches/ioBroker.viessmann-1.7.4-human-readable.patch` ein unter Node.js 20 getesteter Rückport bereit. Er aktualisiert vorhandene Objektmetadaten, ohne alte States oder History automatisch zu löschen, erhält Rohantworten als Strings, skaliert die Energiebilanzen mit dem gerätespezifischen Faktor `163F` in kWh und schützt die explizit freigegebenen SETADDR-Kommandos durch Adress-/Werte-Whitelist, Integerprüfung, Rate-Limit und `ack`-Filter. Damit ist kein Wechsel auf Node.js 22 erforderlich; Adapter 1.7.4 benötigt aber mindestens Node.js 20.

Das direkt übertragbare Paket heißt `adapter-patches/iobroker.viessmann-1.7.4-vitocal-backport.tgz`; die Prüfsumme ist in `adapter-patches/SHA256SUMS` hinterlegt.

Der Patch für Adapter 2.0.5 bleibt als spätere Node-22-Alternative erhalten.

Adressen, Einheiten, Bedeutung der Leistungswerte, Heizstaberkennung sowie Installation und Abnahme sind in `docs/IOBROKER_MAXIMAL_READOUT.md` beschrieben.
