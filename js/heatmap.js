/* Heatmap-Karte mit MapLibre GL. Globales Objekt: HEATMAP
 * Modi: 'map' (vereinfachte Karte, OpenFreeMap Positron), 'sat' (Esri World Imagery), 'game' (dunkel, Neon-Glow)
 * Basemaps kommen ohne API-Key von OpenFreeMap (Vektor) bzw. Esri (Raster); Fallback: OSM-Raster.
 */
window.HEATMAP = (function () {
  'use strict';

  var map = null, loaded = false;
  var mode = 'map', palette = 'neon', labels = true;
  var pendingData = null, currentFilter = null;
  var groups = {}; // layerId -> Gruppe ('light', 'light-labels', 'dark', 'dark-labels', 'sat', 'sat-labels')
  var LINE_LAYERS = ['trk-casing', 'trk-line', 'trk-glow-outer', 'trk-glow-inner', 'trk-core'];
  var OFM = 'https://tiles.openfreemap.org';
  var DARK_DROP = /building|landuse|aeroway|road_oneway|railway|highway_name|highway_path|road_pier|road_area_pier|water_name|place_suburb|place_other|landcover_wood/;

  var PALETTES = {
    neon:    { label: 'Neon',    core: ['#38bdf8', '#7dd3fc', '#bae6fd', '#e0f2fe', '#ffffff'], glow: ['#0369a1', '#0284c7', '#0ea5e9', '#22d3ee', '#67e8f9'] },
    magenta: { label: 'Magenta', core: ['#e879f9', '#f0abfc', '#f5d0fe', '#fae8ff', '#ffffff'], glow: ['#86198f', '#a21caf', '#c026d3', '#d946ef', '#e879f9'] },
    fire:    { label: 'Feuer',   core: ['#fb923c', '#fbbf24', '#fde047', '#fef08a', '#ffffff'], glow: ['#991b1b', '#dc2626', '#ea580c', '#f59e0b', '#facc15'] },
    lime:    { label: 'Lime',    core: ['#a3e635', '#bef264', '#d9f99d', '#ecfccb', '#ffffff'], glow: ['#3f6212', '#4d7c0f', '#65a30d', '#84cc16', '#a3e635'] }
  };
  var ANALYSIS = { colors: ['#2563eb', '#16a34a', '#eab308', '#f97316', '#dc2626'], widths: [1.6, 2.4, 3.2, 4.2, 5.6] };
  var CORE_W = [1.2, 1.8, 2.6, 3.4, 4.4];
  var ZOOM_STOPS = [[4, 0.45], [8, 0.7], [11, 1], [14, 1.6], [17, 3], [20, 6]];

  function byBucket(values) { return ['match', ['get', 'f'], 1, values[0], 2, values[1], 3, values[2], 4, values[3], 5, values[4], values[0]]; }
  /* Zoom-abhaengige Skalierung: 'zoom' darf in MapLibre nur im aeusseren interpolate stehen, daher Bucket-Match pro Stop. */
  function zoomScaled(base) {
    var expr = ['interpolate', ['exponential', 1.3], ['zoom']];
    ZOOM_STOPS.forEach(function (st) {
      expr.push(st[0], Array.isArray(base) ? byBucket(base.map(function (v) { return +(v * st[1]).toFixed(3); })) : +(base * st[1]).toFixed(3));
    });
    return expr;
  }
  function width(values, mult) { return zoomScaled(values.map(function (v) { return v * mult; })); }

  function baseStyle() {
    return {
      version: 8,
      glyphs: OFM + '/fonts/{fontstack}/{range}.pbf',
      sprite: OFM + '/sprites/ofm_f384/ofm',
      sources: {
        'esri-sat': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        'esri-labels': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        tracks: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.4, buffer: 32 }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#05070d' } },
        { id: 'base-sat', type: 'raster', source: 'esri-sat', layout: { visibility: 'none' } },
        // Analyse-Linien
        { id: 'trk-casing', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': width(ANALYSIS.widths.map(function (w) { return w + 2; }), 1) } },
        { id: 'trk-line', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': byBucket(ANALYSIS.colors), 'line-opacity': 0.95, 'line-width': width(ANALYSIS.widths, 1) } },
        // Game-Linien (Glow)
        { id: 'trk-glow-outer', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: { 'line-color': byBucket(PALETTES.neon.glow), 'line-opacity': 0.28, 'line-blur': zoomScaled(6), 'line-width': width(CORE_W, 7) } },
        { id: 'trk-glow-inner', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: { 'line-color': byBucket(PALETTES.neon.glow), 'line-opacity': 0.6, 'line-blur': zoomScaled(2), 'line-width': width(CORE_W, 3) } },
        { id: 'trk-core', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: { 'line-color': byBucket(PALETTES.neon.core), 'line-opacity': 1, 'line-width': width(CORE_W, 1) } },
        { id: 'labels-sat', type: 'raster', source: 'esri-labels', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9 } }
      ]
    };
  }

  function init(containerId) {
    if (map) return map;
    groups = { 'base-sat': 'sat', 'labels-sat': 'sat-labels' };
    map = new maplibregl.Map({
      container: containerId, style: baseStyle(), center: [14.5, 47.7], zoom: 6.5, minZoom: 2, maxZoom: 20,
      preserveDrawingBuffer: true, attributionControl: { compact: true }, fadeDuration: 100
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('error', function (e) { if (e && e.error && !/sprite|image/i.test(String(e.error.message))) console.warn('MapLibre:', e.error.message); });
    map.on('load', function () {
      loaded = true;
      if (pendingData) { map.getSource('tracks').setData(pendingData); pendingData = null; }
      if (currentFilter) applyFilter();
      applyMode();
      loadBasemaps();
    });
    return map;
  }

  /* Basemap-Layer aus einem fertigen MapLibre-Style uebernehmen (Flaechen/Linien unter, Labels ueber den Tracks). */
  function addStyleLayers(style, prefix, group, drop, overrides) {
    Object.keys(style.sources || {}).forEach(function (name) {
      if (!map.getSource(name)) {
        var src = Object.assign({}, style.sources[name]);
        if (name === 'openmaptiles') src.attribution = '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
        map.addSource(name, src);
      }
    });
    (style.layers || []).forEach(function (orig) {
      if (drop && drop.test(orig.id)) return;
      var layer = JSON.parse(JSON.stringify(orig));
      layer.id = prefix + orig.id;
      var isLabel = layer.type === 'symbol';
      layer.layout = layer.layout || {};
      layer.layout.visibility = 'none';
      if (overrides) overrides(layer);
      groups[layer.id] = isLabel ? group + '-labels' : group;
      try {
        map.addLayer(layer, isLabel ? 'labels-sat' : 'trk-casing');
      } catch (e) { console.warn('Layer uebersprungen:', layer.id, e.message); }
    });
  }

  function addOsmFallback() {
    if (map.getSource('osm')) return;
    map.addSource('osm', { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' });
    map.addLayer({ id: 'base-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } }, 'trk-casing');
    groups['base-osm'] = 'light';
  }

  async function fetchStyle(name) {
    var r = await fetch(OFM + '/styles/' + name);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }

  async function loadBasemaps() {
    var results = await Promise.allSettled([fetchStyle('positron'), fetchStyle('dark')]);
    if (results[0].status === 'fulfilled') {
      addStyleLayers(results[0].value, 'L:', 'light', null, null);
    } else {
      console.warn('OpenFreeMap Positron nicht erreichbar, nutze OSM-Raster:', results[0].reason && results[0].reason.message);
      addOsmFallback();
    }
    if (results[1].status === 'fulfilled') {
      addStyleLayers(results[1].value, 'D:', 'dark', DARK_DROP, function (layer) {
        if (layer.type === 'background') layer.paint = { 'background-color': '#070a12' };
        if (layer.type === 'symbol') {
          layer.paint = layer.paint || {};
          layer.paint['text-color'] = 'rgba(200,210,230,0.75)';
          layer.paint['text-halo-color'] = 'rgba(5,7,13,0.9)';
          layer.paint['text-halo-width'] = 1.2;
        }
        if (/boundary/.test(layer.id)) { layer.paint = layer.paint || {}; layer.paint['line-color'] = 'rgba(120,135,170,0.5)'; }
        if (/^D:water$/.test(layer.id)) { layer.paint = { 'fill-color': '#0d1322' }; }
        if (/waterway/.test(layer.id)) { layer.paint = layer.paint || {}; layer.paint['line-color'] = '#0f1a2e'; }
        if (/highway/.test(layer.id) && layer.type === 'line') { layer.paint = layer.paint || {}; layer.paint['line-opacity'] = 0.35; }
      });
    }
    applyMode();
  }

  function vis(id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }

  function applyMode() {
    if (!loaded) return;
    var game = mode === 'game';
    var want = { light: mode === 'map', 'light-labels': mode === 'map' && labels, dark: game, 'dark-labels': game && labels, sat: mode === 'sat', 'sat-labels': mode === 'sat' && labels };
    Object.keys(groups).forEach(function (id) { vis(id, !!want[groups[id]]); });
    vis('trk-casing', !game); vis('trk-line', !game);
    vis('trk-glow-outer', game); vis('trk-glow-inner', game); vis('trk-core', game);
    map.setPaintProperty('trk-casing', 'line-color', mode === 'sat' ? '#000000' : '#ffffff');
    map.setPaintProperty('trk-casing', 'line-opacity', mode === 'sat' ? 0.55 : 0.85);
    applyPalette();
  }

  function applyPalette() {
    if (!loaded) return;
    var p = PALETTES[palette] || PALETTES.neon;
    map.setPaintProperty('trk-glow-outer', 'line-color', byBucket(p.glow));
    map.setPaintProperty('trk-glow-inner', 'line-color', byBucket(p.glow));
    map.setPaintProperty('trk-core', 'line-color', byBucket(p.core));
  }

  function setMode(m) { mode = m; applyMode(); }
  function setPalette(p) { palette = p; applyPalette(); }
  function setLabels(on) { labels = on; applyMode(); }

  /** Modell-Aktivitaeten -> Haeufigkeiten -> GeoJSON -> Karte. Liefert Statistik. */
  function setActivities(activities) {
    var counts = GEO.buildCounts(activities);
    var built = GEO.buildGeoJSON(activities, counts);
    built.geojson.features.sort(function (a, b) { return a.properties.f - b.properties.f; });
    if (loaded) map.getSource('tracks').setData(built.geojson); else pendingData = built.geojson;
    built.stats.cells = counts.size;
    return built.stats;
  }

  /** filter: { groups: [...], years: [...] } (leer/undefined = alles) */
  function setFilter(filter) {
    currentFilter = filter;
    applyFilter();
  }

  function applyFilter() {
    if (!loaded) return;
    var f = currentFilter || {};
    var parts = ['all'];
    if (f.groups && f.groups.length) parts.push(['in', ['get', 't'], ['literal', f.groups]]);
    if (f.years && f.years.length) parts.push(['in', ['get', 'y'], ['literal', f.years]]);
    var expr = parts.length > 1 ? parts : null;
    for (var i = 0; i < LINE_LAYERS.length; i++) map.setFilter(LINE_LAYERS[i], expr);
  }

  function fitBounds(bbox) {
    if (!map || !bbox) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 600, maxZoom: 15 });
  }

  function resize() { if (map) map.resize(); }

  function attributionText() {
    if (mode === 'sat') return 'Imagery © Esri · Tracks: Garmin';
    return '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors · Tracks: Garmin';
  }

  /** PNG-Export mit Fusszeile. caption: { title, subtitle } */
  function exportPNG(caption) {
    return new Promise(function (resolve, reject) {
      if (!map || !loaded) return reject(new Error('Karte nicht bereit'));
      var done = false;
      function grab() {
        if (done) return; done = true;
        try {
          var src = map.getCanvas();
          var W = src.width, H = src.height;
          var dpr = W / map.getContainer().clientWidth;
          var c = document.createElement('canvas');
          c.width = W; c.height = H;
          var ctx = c.getContext('2d');
          ctx.drawImage(src, 0, 0);
          var fh = Math.round(96 * dpr);
          var g = ctx.createLinearGradient(0, H - fh * 1.6, 0, H);
          g.addColorStop(0, 'rgba(5,7,13,0)'); g.addColorStop(1, 'rgba(5,7,13,0.85)');
          ctx.fillStyle = g; ctx.fillRect(0, H - fh * 1.6, W, fh * 1.6);
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'alphabetic';
          ctx.font = '700 ' + Math.round(26 * dpr) + 'px -apple-system, "Helvetica Neue", Arial, sans-serif';
          ctx.fillText(caption.title || 'Heatmap', 24 * dpr, H - 44 * dpr);
          ctx.font = '400 ' + Math.round(15 * dpr) + 'px -apple-system, "Helvetica Neue", Arial, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillText(caption.subtitle || '', 24 * dpr, H - 20 * dpr);
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.font = '400 ' + Math.round(11 * dpr) + 'px -apple-system, "Helvetica Neue", Arial, sans-serif';
          ctx.fillText(attributionText(), W - 16 * dpr, H - 14 * dpr);
          c.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('PNG konnte nicht erzeugt werden')); }, 'image/png');
        } catch (e) { reject(e); }
      }
      map.once('render', function () { setTimeout(grab, 50); });
      map.triggerRepaint();
      setTimeout(grab, 1500);
    });
  }

  return {
    PALETTES: PALETTES, ANALYSIS: ANALYSIS, init: init, setMode: setMode, setPalette: setPalette, setLabels: setLabels,
    setActivities: setActivities, setFilter: setFilter, fitBounds: fitBounds, resize: resize, exportPNG: exportPNG,
    getMode: function () { return mode; }, getMap: function () { return map; }
  };
})();
