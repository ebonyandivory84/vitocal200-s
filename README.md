# Vitocal 200-S WO1C: vcontrold und sichere Runtime-Steuerung

Dieses Projekt enthält die vom Raspberry Pi gesicherten vcontrold-Konfigurationen,
eine strikt geschützte Vorbereitung der offiziellen externen WO1C-Runtime-Eingänge
und den Validierungsplan für die Geräte-ID `204D`.

Aktueller Status:

- Bestehende Leistungs-, Energie- und Heizstab-Lesepunkte sind in `config/vito.xml` enthalten.
- Die beiden vorhandenen manuellen Kompatibilitaetskommandos `setBetriebsart` (`B000`, nur `0/1/2`) und `setWWEinmal` (`B020`, nur `0/2`) sind auf ausdruecklichen Wunsch lokal und auf dem Raspberry wieder aktiv. Sie nutzen P300 `SETADDR`, nicht den EEPROM-Schreibbefehl, duerfen aber nicht zyklisch angesteuert werden.
- Die A-Datenpunkte sind logisch katalogisiert. Produktiv aktiv sind weiterhin nur die Read-Kommandos; A-Schreibkommandos werden nicht dauerhaft in der vcontrold-XML exponiert.
- Alle Runtime-Feature-Flags stehen standardmäßig auf `false`.
- Am 27. August 2026 wurden nach ausdruecklicher Freigabe genau zwei zustandsneutrale reale Schreibtelegramme gesendet: `A400=255` und `A3C2=255`. Beide wurden mit `OK` bestaetigt und unmittelbar als `255` zurueckgelesen; Heizstab und Verdichter blieben aus. Aktivwerte wurden nicht geschrieben.
- Der CP2102-Optolink-Adapter wird wieder stabil unter `/dev/serial/by-id` erkannt. `A400`, `A3C2`, `A440`, `A480` und `779C` sind als Ein-Byte-Reads bestaetigt und als produktive Read-States aufgenommen; die zugehoerigen Soll-/Effektivwerte liefern auf dieser WO1C ueber direkten P300-Zugriff Fehlercode 4.
- Die zusaetzlichen 204D-Referenzadressen `B420`, `B421`, `B423` und `B424` antworten als 2-Byte-Reads ohne Fehlercode und sind als produktive Read-States aufgenommen. Einheit und Skalierung von `B423`/`B424` bleiben bis zur Beobachtung bei laufendem Verdichter als Rohwerte gekennzeichnet.
- Die vcontrold-Quellcodeanalyse und `lib/p300-frame.js` validieren die Ein-Byte-P300-Rahmung. Fuer `A400` und `A3C2` ist jetzt zusaetzlich die Geraeteannahme des Neutralwerts `255` belegt; Aktivwirkung, Timeout und Persistenz bleiben unbestaetigt.
- Die produktiv gewünschten ioBroker-Polling-Intervalle sind in `config/iobroker-polling.json` versioniert, weil ein XML-Neuimport des Adapters alle Intervalle auf `-1` zurücksetzt.

## Lokale Prüfung

```sh
npm test
npm run check
xmllint --noout config/vcontrold.xml config/vito.xml
```

Die technische Einordnung, die geplanten ioBroker-States und der sichere Live-Testablauf stehen in
`docs/WO1C_RUNTIME_CONTROL.md`.

## Maximale lesende Auswertung und ioBroker-Darstellung

Die optimierten Leistungs-, Energie-, Heizstab-, Kältekreis-, Laufzeit- und Diagnosedatenpunkte sind in `config/vito.xml` und `config/vcontrold.xml` enthalten. Das empfohlene produktive Pollingprofil steht in `config/iobroker-polling.json`.

Für die vorhandene Installation liegt unter `adapter-patches/ioBroker.viessmann-1.7.4-human-readable.patch` ein unter Node.js 20 getesteter Rückport bereit. Er aktualisiert vorhandene Objektmetadaten, ohne alte States oder History automatisch zu löschen, erhält Rohantworten als Strings und skaliert die Energiebilanzen mit dem gerätespezifischen Faktor `163F` in kWh. Damit ist kein Wechsel auf Node.js 22 erforderlich; Adapter 1.7.4 benötigt aber mindestens Node.js 20.

Das direkt übertragbare Paket heißt `adapter-patches/iobroker.viessmann-1.7.4-vitocal-backport.tgz`; die Prüfsumme ist in `adapter-patches/SHA256SUMS` hinterlegt.

Der Patch für Adapter 2.0.5 bleibt als spätere Node-22-Alternative erhalten.

Adressen, Einheiten, Bedeutung der Leistungswerte, Heizstaberkennung sowie Installation und Abnahme sind in `docs/IOBROKER_MAXIMAL_READOUT.md` beschrieben.
