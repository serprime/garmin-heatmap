/* Garmin Personal API Client (ueber den lokalen Proxy). Globales Objekt: GARMIN */
window.GARMIN = (function () {
  'use strict';

  var TOKEN_KEY = 'garmin-heatmap.token';
  var PAGE_SIZE = 200; // getestet: 200 geht, 500 liefert HTTP 500
  var ZIP_ACCEPT = 'application/zip, application/x-zip-compressed, application/octet-stream';
  var MIN_INTERVAL_MS = 80;
  var lastRequest = 0;
  var queue = Promise.resolve();

  function cfg() { return window.GARMIN_HEATMAP_CONFIG || {}; }
  function base() { return (cfg().proxyUrl || 'http://127.0.0.1:8787').replace(/\/+$/, ''); }
  function apiKey() { return (cfg().apiKey || '').trim(); }

  async function proxyHealth() {
    try {
      var r = await fetch(base() + '/health', { cache: 'no-store' });
      if (!r.ok) return false;
      var j = await r.json();
      return j && j.ok === true;
    } catch (e) {
      return false;
    }
  }

  function throttle() {
    queue = queue.then(function () {
      var wait = Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now());
      return new Promise(function (res) { setTimeout(res, wait); }).then(function () { lastRequest = Date.now(); });
    });
    return queue;
  }

  function jwtExp(token) {
    try {
      var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = JSON.parse(atob(payload + '='.repeat((4 - payload.length % 4) % 4)));
      return (json.exp || 0) * 1000;
    } catch (e) { return 0; }
  }

  function storedToken() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; }
  }

  /** Access-Token holen (24h gueltig), gecached in localStorage. */
  async function getToken(force) {
    var t = storedToken();
    if (!force && t && t.key === apiKey().slice(-6) && t.exp - Date.now() > 60 * 60 * 1000) return t.token;
    if (!apiKey()) throw new Error('Kein API-Key in config.js');
    await throttle();
    var r = await fetch(base() + '/garmin/personalapitoken-service/personal-api/personal-api-key/token', {
      method: 'POST', headers: { 'Authorization': 'ApiKey ' + apiKey(), 'Accept': '*/*' }
    });
    if (!r.ok) throw new Error('Token-Anfrage fehlgeschlagen: HTTP ' + r.status + (r.status === 401 ? ' (API-Key ungueltig oder abgelaufen?)' : ''));
    var token = (await r.text()).trim();
    var exp = jwtExp(token);
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: token, exp: exp, key: apiKey().slice(-6) }));
    return token;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** GET mit Bearer-Token, Retry bei 429/5xx, Token-Refresh bei 401. */
  async function request(path, accept) {
    var attempt = 0;
    var forceToken = false;
    while (true) {
      var token = await getToken(forceToken);
      forceToken = false;
      await throttle();
      var r;
      try {
        r = await fetch(base() + '/garmin' + path, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': accept || 'application/json' } });
      } catch (e) {
        if (attempt++ < 3) { await sleep(1000 * attempt); continue; }
        throw new Error('Proxy nicht erreichbar (' + e.message + ')');
      }
      if (r.ok) return r;
      if (r.status === 401 && attempt === 0) { attempt++; forceToken = true; continue; }
      if ((r.status === 429 || r.status >= 500) && attempt < 4) {
        attempt++;
        await sleep(r.status === 429 ? 5000 * attempt : 1500 * attempt);
        continue;
      }
      var txt = '';
      try { txt = (await r.text()).slice(0, 200); } catch (e) { /* ignore */ }
      var err = new Error('HTTP ' + r.status + ' bei ' + path + (txt ? ': ' + txt : ''));
      err.status = r.status;
      throw err;
    }
  }

  async function searchActivities(start, limit) {
    var r = await request('/activitylist-service/activities/search/activities?start=' + start + '&limit=' + (limit || PAGE_SIZE));
    return await r.json();
  }

  async function getActivity(id) {
    var r = await request('/activity-service/activity/' + id);
    return await r.json();
  }

  async function downloadOriginal(id) {
    var r = await request('/download-service/files/activity/' + id, ZIP_ACCEPT);
    return await r.arrayBuffer();
  }

  /** Alle Aktivitaeten seitenweise laden (neueste zuerst). onPage(page, start) kann true liefern, um abzubrechen. */
  async function fetchSummaries(onPage) {
    var start = 0;
    var all = [];
    while (true) {
      var page = await searchActivities(start, PAGE_SIZE);
      if (!Array.isArray(page)) throw new Error('Unerwartete Antwort der Aktivitaetssuche');
      all = all.concat(page);
      var stop = onPage ? await onPage(page, start) : false;
      if (stop || page.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
    }
    return all;
  }

  return {
    PAGE_SIZE: PAGE_SIZE, apiKey: apiKey, base: base, proxyHealth: proxyHealth, getToken: getToken,
    searchActivities: searchActivities, getActivity: getActivity, downloadOriginal: downloadOriginal, fetchSummaries: fetchSummaries
  };
})();
