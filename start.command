#!/bin/bash
# Doppelklick im Finder: startet den Mini-Proxy und oeffnet die App im Browser.
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 nicht gefunden. Bitte installieren (z.B. xcode-select --install)."
  read -r -p "Enter zum Schliessen"
  exit 1
fi
( sleep 1; open "http://127.0.0.1:8787/" ) &
python3 proxy.py
