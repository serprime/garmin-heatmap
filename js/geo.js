/* Geo-Hilfsfunktionen: Web-Mercator, Vereinfachung, Rasterung, Heatmap-Modell. Globales Objekt: GEO */
window.GEO = (function () {
  'use strict';

  var MODEL_ZOOM = 18;            // Koordinaten im Heatmap-Modell: Welt-Pixel bei Zoom 18 (~0,6 m/px am Aequator)
  var WORLD = 256 * Math.pow(2, MODEL_ZOOM);
  var SIMPLIFY_TOLERANCE = 4;     // px bei Zoom 18 (~1,5-2,5 m)
  var CELL_PX = 48;               // Rasterzelle fuer Haeufigkeitszaehlung (~19 m bei 48° Breite)
  var MAX_JUMP_M = 400;           // groessere Spruenge zwischen zwei Punkten trennen die Linie (Tunnel, GPS-Ausfall)
  var BUCKETS = [1, 2, 4, 8, 16]; // Mindest-Anzahl Aktivitaeten fuer Stufe 1..5
  var BUCKET_LABELS = ['1×', '2–3×', '4–7×', '8–15×', '16×+'];

  function lonLatToWorld(lon, lat) {
    var s = Math.sin(lat * Math.PI / 180);
    s = Math.max(-0.9999, Math.min(0.9999, s));
    var x = (lon + 180) / 360 * WORLD;
    var y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
    return [x, y];
  }

  function worldToLonLat(x, y) {
    var lon = x / WORLD * 360 - 180;
    var n = Math.PI - 2 * Math.PI * y / WORLD;
    var lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return [lon, lat];
  }

  function metersPerPixel(lat) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, MODEL_ZOOM);
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* Douglas-Peucker auf flachem Array [x0,y0,x1,y1,...]; liefert neues flaches Array. */
  function simplify(flat, tolerance) {
    var n = flat.length / 2;
    if (n <= 2) return flat.slice();
    var sq = tolerance * tolerance;
    var keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop();
      var a = seg[0], b = seg[1];
      var ax = flat[a * 2], ay = flat[a * 2 + 1], bx = flat[b * 2], by = flat[b * 2 + 1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var maxD = -1, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var px = flat[i * 2], py = flat[i * 2 + 1];
        var d;
        if (len2 === 0) { d = (px - ax) * (px - ax) + (py - ay) * (py - ay); }
        else {
          var t = ((px - ax) * dx + (py - ay) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var qx = ax + t * dx, qy = ay + t * dy;
          d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > sq && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(flat[k * 2], flat[k * 2 + 1]);
    return out;
  }

  /* Track (lat[], lon[]) -> Liste von vereinfachten, delta-kodierten Linien in Modell-Koordinaten. */
  function trackToLines(lat, lon) {
    var lines = [];
    var cur = [];
    var prevLat = null, prevLon = null;
    for (var i = 0; i < lat.length; i++) {
      var la = lat[i], lo = lon[i];
      if (la === null || lo === null || la === undefined || lo === undefined) continue;
      if (Math.abs(la) > 85 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) continue;
      if (prevLat !== null && haversine(prevLat, prevLon, la, lo) > MAX_JUMP_M) {
        if (cur.length >= 4) lines.push(cur);
        cur = [];
      }
      var w = lonLatToWorld(lo, la);
      cur.push(w[0], w[1]);
      prevLat = la; prevLon = lo;
    }
    if (cur.length >= 4) lines.push(cur);
    var out = [];
    for (var j = 0; j < lines.length; j++) {
      var s = simplify(lines[j], SIMPLIFY_TOLERANCE);
      if (s.length >= 4) out.push(encodeDeltas(s));
    }
    return out;
  }

  function encodeDeltas(flat) {
    var out = new Array(flat.length);
    var px = 0, py = 0;
    for (var i = 0; i < flat.length; i += 2) {
      var x = Math.round(flat[i]), y = Math.round(flat[i + 1]);
      out[i] = x - px; out[i + 1] = y - py;
      px = x; py = y;
    }
    return out;
  }

  function decodeDeltas(enc) {
    var out = new Float64Array(enc.length);
    var x = 0, y = 0;
    for (var i = 0; i < enc.length; i += 2) {
      x += enc[i]; y += enc[i + 1];
      out[i] = x; out[i + 1] = y;
    }
    return out;
  }

  function cellKey(cx, cy) { return cx * 4194304 + cy; }

  /* Rastert eine Strecke auf das Zellgitter (alle durchquerten Zellen). */
  function rasterizeSegment(x0, y0, x1, y1, visit) {
    var cs = CELL_PX;
    var cx = Math.floor(x0 / cs), cy = Math.floor(y0 / cs);
    var ex = Math.floor(x1 / cs), ey = Math.floor(y1 / cs);
    visit(cx, cy);
    if (cx === ex && cy === ey) return;
    var dx = x1 - x0, dy = y1 - y0;
    var stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    var tMaxX = dx !== 0 ? (((dx > 0 ? cx + 1 : cx) * cs) - x0) / dx : Infinity;
    var tMaxY = dy !== 0 ? (((dy > 0 ? cy + 1 : cy) * cs) - y0) / dy : Infinity;
    var tDeltaX = dx !== 0 ? Math.abs(cs / dx) : Infinity;
    var tDeltaY = dy !== 0 ? Math.abs(cs / dy) : Infinity;
    var guard = 0;
    while ((cx !== ex || cy !== ey) && guard++ < 100000) {
      if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
      else { cy += stepY; tMaxY += tDeltaY; }
      visit(cx, cy);
    }
  }

  /* Zellen einer Aktivitaet (dedupliziert). lines: delta-kodierte Linien. */
  function activityCells(lines) {
    var set = new Set();
    for (var l = 0; l < lines.length; l++) {
      var f = decodeDeltas(lines[l]);
      for (var i = 2; i < f.length; i += 2) {
        rasterizeSegment(f[i - 2], f[i - 1], f[i], f[i + 1], function (cx, cy) { set.add(cellKey(cx, cy)); });
      }
    }
    return set;
  }

  /* Haeufigkeit pro Zelle ueber alle Aktivitaeten: Map(cellKey -> Anzahl Aktivitaeten). */
  function buildCounts(activities) {
    var counts = new Map();
    var ids = Object.keys(activities);
    for (var a = 0; a < ids.length; a++) {
      var cells = activityCells(activities[ids[a]].lines);
      cells.forEach(function (k) { counts.set(k, (counts.get(k) || 0) + 1); });
    }
    return counts;
  }

  function bucketOf(count) {
    var b = 0;
    for (var i = 0; i < BUCKETS.length; i++) if (count >= BUCKETS[i]) b = i + 1;
    return b;
  }

  function countAt(counts, x, y) {
    return counts.get(cellKey(Math.floor(x / CELL_PX), Math.floor(y / CELL_PX))) || 0;
  }

  /* Baut GeoJSON: pro Aktivitaet Linien-Abschnitte ('runs') mit konstanter Haeufigkeitsstufe.
   * props: { f: Stufe 1..5, c: max. Anzahl, t: Typ, y: Jahr, id } */
  function buildGeoJSON(activities, counts) {
    var features = [];
    var ids = Object.keys(activities);
    var stats = { activities: ids.length, points: 0, byBucket: [0, 0, 0, 0, 0, 0] };
    for (var a = 0; a < ids.length; a++) {
      var act = activities[ids[a]];
      for (var l = 0; l < act.lines.length; l++) {
        var f = decodeDeltas(act.lines[l]);
        var n = f.length / 2;
        if (n < 2) continue;
        var c = new Int32Array(n);
        for (var i = 0; i < n; i++) c[i] = countAt(counts, f[i * 2], f[i * 2 + 1]);
        // Median-Glaettung gegen Einzelausreisser an Zellgrenzen
        var sm = new Int32Array(n);
        for (var j = 0; j < n; j++) {
          var p = c[j > 0 ? j - 1 : j], q = c[j], r = c[j < n - 1 ? j + 1 : j];
          sm[j] = Math.max(Math.min(p, q), Math.min(Math.max(p, q), r));
        }
        var runBucket = -1, coords = [];
        var flush = function () {
          if (coords.length >= 2) {
            features.push({ type: 'Feature', properties: { f: runBucket, t: act.t, y: act.y, id: ids[a] }, geometry: { type: 'LineString', coordinates: coords } });
            stats.points += coords.length;
            stats.byBucket[runBucket]++;
          }
        };
        for (var s = 0; s < n - 1; s++) {
          var b = bucketOf(Math.min(sm[s], sm[s + 1]));
          if (b !== runBucket) {
            if (runBucket >= 0) { coords.push(worldToLonLat(f[s * 2], f[s * 2 + 1])); flush(); }
            runBucket = b; coords = [];
          }
          coords.push(worldToLonLat(f[s * 2], f[s * 2 + 1]));
        }
        coords.push(worldToLonLat(f[(n - 1) * 2], f[(n - 1) * 2 + 1]));
        flush();
      }
    }
    return { geojson: { type: 'FeatureCollection', features: features }, stats: stats };
  }

  /* Bounding Box [minLon, minLat, maxLon, maxLat] aller Aktivitaeten (optional gefiltert). */
  function bounds(activities, filter) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var ids = Object.keys(activities);
    for (var a = 0; a < ids.length; a++) {
      var act = activities[ids[a]];
      if (filter && !filter(act)) continue;
      for (var l = 0; l < act.lines.length; l++) {
        var f = decodeDeltas(act.lines[l]);
        for (var i = 0; i < f.length; i += 2) {
          if (f[i] < minX) minX = f[i]; if (f[i] > maxX) maxX = f[i];
          if (f[i + 1] < minY) minY = f[i + 1]; if (f[i + 1] > maxY) maxY = f[i + 1];
        }
      }
    }
    if (minX === Infinity) return null;
    var sw = worldToLonLat(minX, maxY), ne = worldToLonLat(maxX, minY);
    return [sw[0], sw[1], ne[0], ne[1]];
  }

  /* Garmin-Typ -> Gruppe fuer Filter/Farben */
  function typeGroup(typeKey) {
    var k = (typeKey || '').toLowerCase();
    if (/cycling|biking|bike|ride|cycl/.test(k)) return 'cycling';
    if (/running|run/.test(k)) return 'running';
    if (/hiking|walking|walk|hike/.test(k)) return 'walking';
    if (/swim/.test(k)) return 'swimming';
    if (/ski|snowboard|snowshoe/.test(k)) return 'winter';
    return 'other';
  }

  return {
    MODEL_ZOOM: MODEL_ZOOM, CELL_PX: CELL_PX, BUCKETS: BUCKETS, BUCKET_LABELS: BUCKET_LABELS,
    lonLatToWorld: lonLatToWorld, worldToLonLat: worldToLonLat, metersPerPixel: metersPerPixel, haversine: haversine,
    simplify: simplify, trackToLines: trackToLines, encodeDeltas: encodeDeltas, decodeDeltas: decodeDeltas,
    buildCounts: buildCounts, buildGeoJSON: buildGeoJSON, bucketOf: bucketOf, bounds: bounds, typeGroup: typeGroup
  };
})();
