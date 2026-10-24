// Kopiere diese Datei nach config.js und trage deinen Garmin Personal API Key ein.
// Key erstellen: https://connect.garmin.com/app/settings/personalApiToken
window.GARMIN_HEATMAP_CONFIG = {
  // Garmin Personal API Key (wird nur an den lokalen Proxy gesendet, der ihn an Garmin weiterreicht)
  apiKey: "",

  // Adresse des lokalen Mini-Proxys (proxy.py / start.command)
  proxyUrl: "http://127.0.0.1:8787",

  // Parallele Downloads beim Sync
  concurrency: 3,
};
