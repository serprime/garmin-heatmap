/* Minimaler FIT-Decoder (Garmin Flexible and Interoperable Data Transfer).
 * Liest record-Messages (GPS, Hoehe, Puls, Speed, ...) und session-Messages.
 * Keine Abhaengigkeiten. Globales Objekt: FIT
 */
window.FIT = (function () {
  'use strict';

  var FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in Unix-Sekunden
  var SEMI = 180 / 2147483648; // Semicircles -> Grad

  // baseType -> [bytes, reader-name, invalid value]
  var BASE = {
    0x00: [1, 'u8', 0xFF], 0x01: [1, 's8', 0x7F], 0x02: [1, 'u8', 0xFF],
    0x83: [2, 's16', 0x7FFF], 0x84: [2, 'u16', 0xFFFF],
    0x85: [4, 's32', 0x7FFFFFFF], 0x86: [4, 'u32', 0xFFFFFFFF],
    0x07: [1, 'str', null], 0x88: [4, 'f32', null], 0x89: [8, 'f64', null],
    0x0A: [1, 'u8', 0], 0x8B: [2, 'u16', 0], 0x8C: [4, 'u32', 0],
    0x0D: [1, 'u8', 0xFF], 0x8E: [8, 's64', null], 0x8F: [8, 'u64', null], 0x90: [8, 'u64', 0]
  };

  // record (global message 20)
  var RECORD_FIELDS = {
    253: ['t', 1, 0], 0: ['lat', null, 0], 1: ['lon', null, 0], 2: ['ele', 1 / 5, -500],
    3: ['hr', 1, 0], 4: ['cad', 1, 0], 5: ['dist', 1 / 100, 0], 6: ['spd', 1 / 1000, 0],
    7: ['pwr', 1, 0], 13: ['tmp', 1, 0], 73: ['spd', 1 / 1000, 0], 78: ['ele', 1 / 5, -500]
  };
  // session (global message 18)
  var SESSION_FIELDS = {
    253: ['t', 1, 0], 2: ['startTime', 1, 0], 3: ['startLat', null, 0], 4: ['startLon', null, 0],
    5: ['sport', 1, 0], 6: ['subSport', 1, 0], 7: ['elapsed', 1 / 1000, 0], 8: ['timer', 1 / 1000, 0],
    9: ['distance', 1 / 100, 0], 11: ['calories', 1, 0], 14: ['avgSpeed', 1 / 1000, 0], 15: ['maxSpeed', 1 / 1000, 0],
    16: ['avgHr', 1, 0], 17: ['maxHr', 1, 0], 22: ['ascent', 1, 0], 23: ['descent', 1, 0]
  };

  function readValue(view, off, type, littleEndian) {
    switch (type) {
      case 'u8': return view.getUint8(off);
      case 's8': return view.getInt8(off);
      case 'u16': return view.getUint16(off, littleEndian);
      case 's16': return view.getInt16(off, littleEndian);
      case 'u32': return view.getUint32(off, littleEndian);
      case 's32': return view.getInt32(off, littleEndian);
      case 'f32': return view.getFloat32(off, littleEndian);
      case 'f64': return view.getFloat64(off, littleEndian);
      case 'u64': return Number(view.getBigUint64(off, littleEndian));
      case 's64': return Number(view.getBigInt64(off, littleEndian));
      default: return null;
    }
  }

  function applyField(target, def, raw) {
    var name = def[0], scale = def[1], offset = def[2];
    if (scale === null) { // semicircles
      target[name] = raw * SEMI;
    } else if (name === 't' || name === 'startTime') {
      target[name] = raw + FIT_EPOCH;
    } else {
      target[name] = raw * scale + offset;
    }
  }

  /** Dekodiert einen ArrayBuffer. Rueckgabe: { records: [...], sessions: [...], fileType } */
  function decode(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var records = [];
    var sessions = [];
    var pos = 0;
    var fileType = null;

    while (pos + 12 <= bytes.length) {
      var headerSize = bytes[pos];
      if (headerSize !== 12 && headerSize !== 14) break;
      if (String.fromCharCode(bytes[pos + 8], bytes[pos + 9], bytes[pos + 10], bytes[pos + 11]) !== '.FIT') break;
      var dataSize = view.getUint32(pos + 4, true);
      var p = pos + headerSize;
      var end = Math.min(p + dataSize, bytes.length);
      var defs = {};
      var lastTs = 0;

      while (p < end) {
        var hdr = bytes[p++];
        var localType, def;
        if (hdr & 0x80) { // compressed timestamp header
          localType = (hdr >> 5) & 0x03;
          var offset5 = hdr & 0x1F;
          def = defs[localType];
          if (!def) break;
          var base = lastTs & ~0x1F;
          lastTs = (offset5 >= (lastTs & 0x1F)) ? base + offset5 : base + offset5 + 0x20;
          p = readData(def, p, lastTs);
        } else if (hdr & 0x40) { // definition message
          localType = hdr & 0x0F;
          var hasDev = (hdr & 0x20) !== 0;
          var arch = bytes[p + 1];
          var little = arch === 0;
          var global = little ? view.getUint16(p + 2, true) : view.getUint16(p + 2, false);
          var nFields = bytes[p + 4];
          p += 5;
          var fields = [];
          var total = 0;
          for (var i = 0; i < nFields; i++) {
            var fnum = bytes[p], fsize = bytes[p + 1], btype = bytes[p + 2];
            p += 3;
            fields.push({ num: fnum, size: fsize, base: BASE[btype] || [1, 'u8', 0xFF] });
            total += fsize;
          }
          if (hasDev) {
            var nDev = bytes[p++];
            for (var d = 0; d < nDev; d++) {
              total += bytes[p + 1];
              p += 3;
            }
          }
          defs[localType] = { global: global, little: little, fields: fields, size: total };
        } else { // normal data message
          localType = hdr & 0x0F;
          def = defs[localType];
          if (!def) break;
          p = readData(def, p, null);
        }
      }
      pos = p + 2; // CRC ueberspringen; evtl. folgt eine weitere (verkettete) FIT-Datei
      if (pos < end) pos = end + 2;
    }

    function readData(def, p, forcedTs) {
      var map = def.global === 20 ? RECORD_FIELDS : def.global === 18 ? SESSION_FIELDS : def.global === 0 ? { 0: ['type', 1, 0] } : null;
      if (!map) return p + def.size;
      var obj = {};
      var q = p;
      for (var i = 0; i < def.fields.length; i++) {
        var f = def.fields[i];
        var fd = map[f.num];
        if (fd && f.base[1] !== 'str' && f.size >= f.base[0]) {
          var raw = readValue(view, q, f.base[1], def.little);
          var invalid = f.base[2];
          var isInvalid = invalid === null ? (typeof raw === 'number' && isNaN(raw)) : raw === invalid;
          if (!isInvalid && raw !== null) applyField(obj, fd, raw);
        }
        q += f.size;
      }
      if (def.global === 20) {
        if (obj.t !== undefined) lastTs = obj.t - FIT_EPOCH; else if (forcedTs !== null) obj.t = forcedTs + FIT_EPOCH;
        records.push(obj);
      } else if (def.global === 18) {
        sessions.push(obj);
      } else if (def.global === 0) {
        fileType = obj.type;
      }
      return p + def.size;
    }

    return { records: records, sessions: sessions, fileType: fileType };
  }

  /** Wandelt decode()-Records in ein kompaktes spaltenorientiertes Track-Objekt um. */
  function toTrack(decoded) {
    var cols = ['t', 'lat', 'lon', 'ele', 'hr', 'cad', 'spd', 'dist', 'pwr', 'tmp'];
    var recs = decoded.records;
    var track = { n: recs.length, gps: 0 };
    var present = {};
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      for (var c = 0; c < cols.length; c++) if (r[cols[c]] !== undefined) present[cols[c]] = true;
      if (r.lat !== undefined && r.lon !== undefined) track.gps++;
    }
    for (var k = 0; k < cols.length; k++) {
      var name = cols[k];
      if (!present[name]) continue;
      var arr = new Array(recs.length);
      for (var j = 0; j < recs.length; j++) {
        var v = recs[j][name];
        if (v === undefined) arr[j] = null;
        else if (name === 'lat' || name === 'lon') arr[j] = Math.round(v * 1e6) / 1e6;
        else if (name === 'ele' || name === 'spd' || name === 'dist') arr[j] = Math.round(v * 100) / 100;
        else arr[j] = v;
      }
      track[name] = arr;
    }
    if (decoded.sessions.length) {
      var s = decoded.sessions[0];
      track.session = { sport: s.sport, subSport: s.subSport, distance: s.distance, timer: s.timer, elapsed: s.elapsed, ascent: s.ascent, descent: s.descent, avgHr: s.avgHr, maxHr: s.maxHr, avgSpeed: s.avgSpeed, maxSpeed: s.maxSpeed, calories: s.calories };
    }
    return track;
  }

  return { decode: decode, toTrack: toTrack, FIT_EPOCH: FIT_EPOCH };
})();
