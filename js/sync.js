/* Sync: Katalog (catalog.json), Aktivitaetsdateien und Heatmap-Modell (heatmap.json) im Datenordner. Globales Objekt: SYNC */
window.SYNC = (function () {
  'use strict';

  var CATALOG_PATH = 'catalog.json';
  var MODEL_PATH = 'heatmap.json';
  var FLUSH_EVERY = 20;

  var catalog = null; // { version, updatedAt, lastCheckAt, activities: { id: entry } }
  var model = null;   // { version, zoom, cellPx, activities: { id: { t, y, d, lines } } }
  var listeners = [];
  var state = { phase: 'idle', running: false, message: '', total: 0, done: 0, failed: 0, current: '', pending: [], log: [], modelVersion: 0 };

  function on(fn) { listeners.push(fn); }
  function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](state); }
  function log(msg) {
    var t = new Date();
    state.log.push(('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2) + '  ' + msg);
    if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
    emit();
  }
  function setPhase(phase, message) { state.phase = phase; state.message = message || ''; emit(); }

  async function load() {
    catalog = (await STORE.readJSON(CATALOG_PATH)) || { version: 1, activities: {} };
    if (!catalog.activities) catalog.activities = {};
    model = (await STORE.readJSON(MODEL_PATH)) || { version: 1, zoom: GEO.MODEL_ZOOM, cellPx: GEO.CELL_PX, activities: {} };
    if (!model.activities) model.activities = {};
    state.pending = pendingIds();
    state.modelVersion++;
    emit();
  }

  async function saveCatalog() { catalog.updatedAt = new Date().toISOString(); await STORE.writeJSON(CATALOG_PATH, catalog); }
  async function saveModel() { model.updatedAt = new Date().toISOString(); await STORE.writeJSON(MODEL_PATH, model); state.modelVersion++; }

  function slim(s) {
    var typeKey = s.activityType && s.activityType.typeKey;
    return {
      id: String(s.activityId), name: s.activityName || '', type: typeKey || 'other', group: GEO.typeGroup(typeKey),
      start: s.startTimeLocal || '', startGMT: s.startTimeGMT || '', dist: s.distance, dur: s.duration, movingDur: s.movingDuration,
      elev: s.elevationGain, elevLoss: s.elevationLoss, avgSpd: s.averageSpeed, maxSpd: s.maxSpeed, avgHr: s.averageHR, maxHr: s.maxHR,
      cal: s.calories, lat: s.startLatitude, lon: s.startLongitude, loc: s.locationName || null, manual: !!s.manualActivity,
      avgPower: s.avgPower, normPower: s.normPower, avgCad: s.averageBikingCadenceInRevPerMinute || s.averageRunningCadenceInStepsPerMinute
    };
  }

  function pendingIds() {
    var ids = Object.keys(catalog.activities).filter(function (id) { return !catalog.activities[id].done; });
    ids.sort(function (a, b) { return (catalog.activities[b].start || '').localeCompare(catalog.activities[a].start || ''); });
    return ids;
  }

  function stats() {
    var ids = Object.keys(catalog.activities);
    var s = { total: ids.length, done: 0, withGps: 0, noFile: 0, failed: 0, pending: 0, distance: 0 };
    for (var i = 0; i < ids.length; i++) {
      var e = catalog.activities[ids[i]];
      if (e.done) s.done++; else s.pending++;
      if (e.gps > 0) { s.withGps++; s.distance += e.dist || 0; }
      if (e.noFile) s.noFile++;
      if (e.err) s.failed++;
    }
    return s;
  }

  /** Katalog mit Garmin abgleichen. full=true: alle Seiten; sonst Abbruch, sobald eine Seite keine neuen IDs enthaelt. */
  async function refreshCatalog(full) {
    setPhase('catalog', 'Aktivitätsliste von Garmin laden …');
    var newIds = [];
    var seen = 0;
    await GARMIN.fetchSummaries(async function (page, start) {
      var unknownOnPage = 0;
      for (var i = 0; i < page.length; i++) {
        var s = page[i];
        var id = String(s.activityId);
        var entry = catalog.activities[id];
        if (!entry) {
          entry = slim(s);
          entry.files = { summary: false, activity: false, original: false, track: false };
          entry.gps = null;
          entry.done = false;
          catalog.activities[id] = entry;
          newIds.push(id);
          unknownOnPage++;
        } else {
          var fresh = slim(s);
          Object.keys(fresh).forEach(function (k) { entry[k] = fresh[k]; });
        }
        if (!entry.files.summary) {
          await STORE.writeJSON('activities/' + id + '/summary.json', s);
          entry.files.summary = true;
        }
      }
      seen += page.length;
      state.message = 'Aktivitätsliste: ' + seen + ' geprüft, ' + newIds.length + ' neu';
      emit();
      return !full && unknownOnPage === 0;
    });
    catalog.lastCheckAt = new Date().toISOString();
    await saveCatalog();
    state.pending = pendingIds();
    log('Abgleich: ' + seen + ' Aktivitäten geprüft, ' + newIds.length + ' neu, ' + state.pending.length + ' ausstehend');
    return newIds;
  }

  async function check() {
    if (state.running) return state.pending.length;
    state.running = true;
    try {
      await refreshCatalog(false);
      setPhase('idle', '');
      return state.pending.length;
    } catch (e) {
      log('Fehler beim Prüfen: ' + e.message);
      setPhase('error', e.message);
      throw e;
    } finally {
      state.running = false;
      emit();
    }
  }

  function year(start) { var y = parseInt((start || '').slice(0, 4), 10); return isNaN(y) ? 0 : y; }

  function toArrayBuffer(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }

  async function processOne(id) {
    var e = catalog.activities[id];
    var dir = 'activities/' + id + '/';
    var entry = null;
    if (!e.files) e.files = { summary: false, activity: false, original: false, track: false };

    if (!e.files.activity) {
      var a = await GARMIN.getActivity(id);
      await STORE.writeJSON(dir + 'activity.json', a);
      e.files.activity = true;
    }
    if (!e.files.original && !e.noFile) {
      try {
        var buf = await GARMIN.downloadOriginal(id);
        var entries = await ZIP.read(buf);
        if (!entries.length) throw new Error('Leeres ZIP');
        entry = entries[0];
        e.originalName = entry.name || (id + '.fit');
        await STORE.write(dir + e.originalName, entry.data);
        e.files.original = true;
      } catch (err) {
        if (err.status === 404 || err.status === 403) { e.noFile = true; log(id + ': keine Originaldatei (' + err.status + ')'); }
        else throw err;
      }
    }
    if (!e.files.track) {
      if (e.files.original && /\.fit$/i.test(e.originalName || '')) {
        var bytes = entry ? entry.data : await STORE.readBytes(dir + e.originalName);
        var decoded = FIT.decode(toArrayBuffer(bytes));
        var track = FIT.toTrack(decoded);
        e.gps = track.gps;
        e.records = track.n;
        if (track.gps > 0) {
          await STORE.writeJSON(dir + 'track.json', track);
          var lines = GEO.trackToLines(track.lat, track.lon);
          if (lines.length) model.activities[id] = { t: e.group, y: year(e.start), d: (e.start || '').slice(0, 10), lines: lines };
        }
      } else {
        e.gps = 0;
      }
      e.files.track = true;
    }
    e.done = true;
    delete e.err;
  }

  /** Alle ausstehenden Aktivitaeten herunterladen und verarbeiten. */
  async function download() {
    if (state.running) return;
    state.running = true;
    var ids = state.pending.slice();
    state.total = ids.length; state.done = 0; state.failed = 0;
    setPhase('download', 'Lade ' + ids.length + ' Aktivitäten …');
    log('Download gestartet: ' + ids.length + ' Aktivitäten');
    var concurrency = Math.max(1, Math.min(6, (window.GARMIN_HEATMAP_CONFIG || {}).concurrency || 3));
    var next = 0, sinceFlush = 0;
    var startedAt = Date.now();

    async function worker() {
      while (next < ids.length) {
        var id = ids[next++];
        var e = catalog.activities[id];
        state.current = FMT.date(e.start) + ' ' + (e.name || id);
        emit();
        try {
          await processOne(id);
        } catch (err) {
          e.err = err.message;
          state.failed++;
          log('Fehler bei ' + id + ' (' + (e.name || '') + '): ' + err.message);
        }
        state.done++;
        var elapsed = (Date.now() - startedAt) / 1000;
        var rate = state.done / Math.max(1, elapsed);
        var eta = Math.round((ids.length - state.done) / Math.max(0.01, rate));
        state.message = state.done + ' / ' + ids.length + ' · ' + (state.failed ? state.failed + ' Fehler · ' : '') + 'noch ca. ' + FMT.durShort(eta);
        emit();
        if (++sinceFlush >= FLUSH_EVERY) { sinceFlush = 0; await saveCatalog(); await saveModel(); }
      }
    }
    try {
      var workers = [];
      for (var w = 0; w < concurrency; w++) workers.push(worker());
      await Promise.all(workers);
      await saveCatalog();
      await saveModel();
      state.pending = pendingIds();
      state.current = '';
      log('Download fertig: ' + (state.done - state.failed) + ' ok, ' + state.failed + ' Fehler');
      setPhase('done', state.failed ? state.failed + ' Aktivitäten mit Fehlern – erneut versuchen über „Herunterladen“' : 'Alle Aktivitäten geladen');
    } catch (e) {
      log('Abbruch: ' + e.message);
      await saveCatalog(); await saveModel();
      setPhase('error', e.message);
    } finally {
      state.running = false;
      emit();
    }
  }

  /** Heatmap-Modell aus den lokalen track.json-Dateien neu aufbauen (z.B. nach Parameteraenderung). */
  async function rebuildModel() {
    if (state.running) return;
    state.running = true;
    var ids = Object.keys(catalog.activities).filter(function (id) { return catalog.activities[id].gps > 0; });
    state.total = ids.length; state.done = 0; state.failed = 0;
    setPhase('rebuild', 'Modell neu aufbauen …');
    model = { version: 1, zoom: GEO.MODEL_ZOOM, cellPx: GEO.CELL_PX, activities: {} };
    try {
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i], e = catalog.activities[id];
        var track = await STORE.readJSON('activities/' + id + '/track.json');
        if (track && track.lat) {
          var lines = GEO.trackToLines(track.lat, track.lon);
          if (lines.length) model.activities[id] = { t: e.group, y: year(e.start), d: (e.start || '').slice(0, 10), lines: lines };
        } else {
          e.files.track = false; e.done = false; state.failed++;
        }
        state.done++;
        if (i % 25 === 0) { state.message = state.done + ' / ' + ids.length; emit(); }
      }
      await saveModel();
      await saveCatalog();
      state.pending = pendingIds();
      log('Modell neu aufgebaut: ' + Object.keys(model.activities).length + ' Aktivitäten mit GPS');
      setPhase('done', 'Modell neu aufgebaut');
    } catch (e) {
      log('Fehler beim Neuaufbau: ' + e.message);
      setPhase('error', e.message);
    } finally {
      state.running = false;
      emit();
    }
  }

  /** Fehlerhafte Aktivitaeten zuruecksetzen, damit sie beim naechsten Download erneut versucht werden. */
  function resetFailed() {
    Object.keys(catalog.activities).forEach(function (id) {
      var e = catalog.activities[id];
      if (e.err) { delete e.err; e.done = false; }
    });
    state.pending = pendingIds();
    emit();
  }

  return {
    state: state, on: on, log: log, load: load, catalog: function () { return catalog; }, model: function () { return model; },
    stats: stats, check: check, download: download, refreshCatalog: refreshCatalog, rebuildModel: rebuildModel, resetFailed: resetFailed, saveCatalog: saveCatalog
  };
})();
