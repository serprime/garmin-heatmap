/* Datenordner auf der Platte via File System Access API (Chrome/Edge). Globales Objekt: STORE
 * Ordner-Handle wird in IndexedDB gemerkt, damit die Freigabe beim naechsten Start nur bestaetigt werden muss.
 */
window.STORE = (function () {
  'use strict';

  var DB_NAME = 'garmin-heatmap';
  var dirHandle = null;

  function supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function kvGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readonly');
        var r = tx.objectStore('kv').get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function kvSet(key, value) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /** Ordner-Dialog oeffnen (braucht Klick). */
  async function pickFolder() {
    dirHandle = await window.showDirectoryPicker({ id: 'garmin-heatmap-data', mode: 'readwrite', startIn: 'documents' });
    await kvSet('dataDir', dirHandle);
    return dirHandle;
  }

  /** Gemerkten Ordner laden. Rueckgabe: 'granted' | 'prompt' | 'none' */
  async function restore() {
    var h = await kvGet('dataDir').catch(function () { return null; });
    if (!h) return 'none';
    var state = await h.queryPermission({ mode: 'readwrite' });
    if (state === 'granted') { dirHandle = h; return 'granted'; }
    dirHandle = null;
    pendingHandle = h;
    return 'prompt';
  }
  var pendingHandle = null;

  /** Freigabe fuer gemerkten Ordner anfordern (braucht Klick). */
  async function requestPermission() {
    if (!pendingHandle) return false;
    var state = await pendingHandle.requestPermission({ mode: 'readwrite' });
    if (state === 'granted') { dirHandle = pendingHandle; pendingHandle = null; return true; }
    return false;
  }

  async function forget() {
    dirHandle = null; pendingHandle = null;
    await kvSet('dataDir', null);
  }

  function isReady() { return !!dirHandle; }
  function name() { return dirHandle ? dirHandle.name : (pendingHandle ? pendingHandle.name : null); }

  async function getDir(path, create) {
    if (!dirHandle) throw new Error('Kein Datenordner verbunden');
    var dir = dirHandle;
    var parts = path.split('/').filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: !!create });
      } catch (e) {
        if (e.name === 'NotFoundError') return null;
        throw e;
      }
    }
    return dir;
  }

  function splitPath(path) {
    var parts = path.split('/').filter(Boolean);
    var file = parts.pop();
    return { dir: parts.join('/'), file: file };
  }

  async function fileHandle(path, create) {
    var sp = splitPath(path);
    var dir = await getDir(sp.dir, create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(sp.file, { create: !!create });
    } catch (e) {
      if (e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async function exists(path) {
    return !!(await fileHandle(path, false));
  }

  async function readText(path) {
    var fh = await fileHandle(path, false);
    if (!fh) return null;
    var file = await fh.getFile();
    return await file.text();
  }

  async function readJSON(path) {
    var txt = await readText(path);
    if (txt === null || txt === '') return null;
    try { return JSON.parse(txt); } catch (e) { console.warn('Ungueltiges JSON in', path, e); return null; }
  }

  async function readBytes(path) {
    var fh = await fileHandle(path, false);
    if (!fh) return null;
    var file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async function write(path, data) {
    var fh = await fileHandle(path, true);
    var w = await fh.createWritable();
    try {
      await w.write(data);
    } finally {
      await w.close();
    }
  }

  function writeJSON(path, obj) {
    return write(path, JSON.stringify(obj));
  }

  async function listDir(path) {
    var dir = await getDir(path, false);
    if (!dir) return [];
    var names = [];
    for await (var entry of dir.values()) names.push({ name: entry.name, kind: entry.kind });
    return names;
  }

  async function remove(path) {
    var sp = splitPath(path);
    var dir = await getDir(sp.dir, false);
    if (!dir) return;
    try { await dir.removeEntry(sp.file, { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
  }

  return {
    supported: supported, pickFolder: pickFolder, restore: restore, requestPermission: requestPermission, forget: forget,
    isReady: isReady, name: name, exists: exists, readText: readText, readJSON: readJSON, readBytes: readBytes,
    write: write, writeJSON: writeJSON, listDir: listDir, remove: remove
  };
})();
