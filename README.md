# Garmin Heatmap

Lokale Web-App (reines HTML/JavaScript) für die Garmin Personal API:

- **Sync**: lädt alle Garmin-Aktivitäten (Summary, Details, Original-FIT) in einen Ordner auf deiner Platte und prüft beim Start auf neue Aktivitäten.
- **Heatmap**: alle GPS-Tracks auf einer Karte (vereinfachte Karte, Satellit oder dunkler „Game“-Look mit Neon-Glow). Linienbreite und Farbe zeigen, wie oft ein Abschnitt gefahren wurde.
- **Poster**: Share-Grafik einer einzelnen Aktivität (1:1, 4:5, 9:16) als PNG.

## Voraussetzungen

- Chrome oder Edge (File System Access API zum Speichern der Dateien)
- `python3` für den Mini-Proxy (ohne weitere Abhängigkeiten)
- Garmin Personal API Key: https://connect.garmin.com/app/settings/personalApiToken

## Einrichten

1. `config.example.js` nach `config.js` kopieren und den API-Key eintragen.
2. `start.command` doppelklicken (oder im Terminal `python3 proxy.py`). Das startet den Proxy auf `http://127.0.0.1:8787/` und öffnet die App.
3. Im Tab **Sync** einen Datenordner wählen (z.B. `data/` in diesem Verzeichnis) und „Herunterladen“ klicken.

Die Seite kann auch direkt per Doppelklick auf `index.html` geöffnet werden. Heatmap und Poster funktionieren dann ohne Proxy, nur der Download von Garmin braucht ihn.

## Warum ein Proxy?

Die Garmin-API sendet keine CORS-Header, deshalb darf der Browser sie nicht direkt aufrufen. `proxy.py` leitet Aufrufe unter `/garmin/...` 1:1 an `https://personal.connectapi.garmin.com` weiter und ergänzt die CORS-Header. Er speichert nichts; der API-Key kommt im Request-Header aus dem Browser.

## Datenordner

```
catalog.json              Liste aller Aktivitäten (Kurzinfos + Download-Status)
heatmap.json              Heatmap-Modell: vereinfachte Linien pro Aktivität (Welt-Pixel bei Zoom 18, delta-kodiert)
activities/<id>/
  summary.json            Eintrag aus der Aktivitätssuche
  activity.json           /activity-service/activity/<id>
  <id>_ACTIVITY.fit       Originaldatei (aus dem ZIP von /download-service)
  track.json              dekodierte Messpunkte (t, lat, lon, ele, hr, cad, spd, dist, pwr, tmp)
```

Die Häufigkeit pro Abschnitt wird beim Laden der Heatmap aus `heatmap.json` berechnet: jede Aktivität markiert die Rasterzellen (~20 m), die sie durchquert; die Zellenzähler ergeben die Stufen 1×, 2–3×, 4–7×, 8–15×, 16×+.

## Dateien

- `index.html` – UI
- `js/garmin.js` – API-Client (Token, Suche, Details, Download) über den Proxy
- `js/store.js` – Datenordner (File System Access API)
- `js/fit.js` – FIT-Decoder, `js/zip.js` – ZIP-Reader
- `js/geo.js` – Projektion, Vereinfachung, Rasterung, GeoJSON
- `js/sync.js` – Download-Ablauf, Katalog, Modell
- `js/heatmap.js` – MapLibre-Karte, `js/poster.js` – Poster-Renderer
- `js/app.js` – UI-Logik
- `proxy.py`, `start.command` – Mini-Proxy
