/* UI-Logik: Tabs, Status, Sync-Steuerung, Heatmap-Steuerung, Poster-Liste. */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  var ui = { folder: 'none', proxy: false, key: false, mapInit: false, modelVersionShown: -1, listShown: 0, listFilter: '', activeTab: 'sync' };

  /* ---------- Tabs ---------- */
  function showTab(name) {
    ui.activeTab = name;
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('hidden', t.id !== 'tab-' + name); });
    if (name === 'heatmap') initHeatmap();
    if (name === 'poster') renderList();
    try { localStorage.setItem('garmin-heatmap.tab', name); } catch (e) { /* ignore */ }
  }

  /* ---------- Status ---------- */
  function pill(id, ok, text) {
    var el = $(id);
    el.className = 'pill ' + (ok === null ? 'warn' : ok ? 'ok' : 'bad');
    el.textContent = text;
  }

  function renderStatus() {
    var folderName = STORE.name();
    pill('#pill-folder', ui.folder === 'granted', ui.folder === 'granted' ? 'Ordner: ' + folderName : ui.folder === 'prompt' ? 'Ordner: Freigabe nötig' : 'Kein Datenordner');
    pill('#pill-proxy', ui.proxy, ui.proxy ? 'Proxy ok' : 'Proxy aus');
    pill('#pill-key', ui.key, ui.key ? 'API-Key ok' : 'API-Key fehlt');

    $('#folder-state').textContent = ui.folder === 'granted' ? 'Verbunden: „' + folderName + '“' : ui.folder === 'prompt' ? 'Gemerkter Ordner „' + folderName + '“ braucht deine Freigabe.' : 'Noch kein Ordner gewählt. Wähle z.B. den Ordner data/ neben index.html.';
    $('#btn-grant').classList.toggle('hidden', ui.folder !== 'prompt');
    $('#btn-pick').textContent = ui.folder === 'none' ? 'Datenordner wählen' : 'Anderen Ordner wählen';
    $('#proxy-state').textContent = ui.proxy ? 'Erreichbar unter ' + GARMIN.base() : 'Nicht erreichbar unter ' + GARMIN.base() + '. Starte ihn mit „python3 proxy.py“ oder Doppelklick auf start.command.';
    $('#key-state').textContent = ui.key ? 'API-Key aus config.js geladen (endet auf …' + GARMIN.apiKey().slice(-4) + ')' : 'Kein Key. Kopiere config.example.js nach config.js und trage deinen Garmin Personal API Key ein.';

    var ready = ui.folder === 'granted';
    var s = ready ? SYNC.stats() : null;
    $('#stat-total').textContent = s ? FMT.int(s.total) : '–';
    $('#stat-done').textContent = s ? FMT.int(s.done) : '–';
    $('#stat-gps').textContent = s ? FMT.int(s.withGps) : '–';
    $('#stat-pending').textContent = s ? FMT.int(s.pending) : '–';
    $('#stat-failed').textContent = s ? FMT.int(s.failed) : '–';
    $('#stat-km').textContent = s ? FMT.km(s.distance, 0) : '–';
    var cat = ready ? SYNC.catalog() : null;
    $('#stat-check').textContent = cat && cat.lastCheckAt ? new Date(cat.lastCheckAt).toLocaleString('de-AT') : '–';

    var canSync = ready && ui.proxy && ui.key && !SYNC.state.running;
    $('#btn-check').disabled = !canSync;
    $('#btn-download').disabled = !canSync || !SYNC.state.pending.length;
    $('#btn-download').textContent = 'Herunterladen' + (SYNC.state.pending.length ? ' (' + SYNC.state.pending.length + ')' : '');
    $('#btn-full').disabled = !canSync;
    $('#btn-rebuild').disabled = !ready || SYNC.state.running;
    $('#btn-reset-failed').disabled = !ready || SYNC.state.running || !(s && s.failed);

    var banner = $('#new-banner');
    var n = SYNC.state.pending.length;
    banner.classList.toggle('hidden', !(ready && n > 0 && !SYNC.state.running));
    $('#new-banner-text').textContent = n === 1 ? '1 Aktivität wartet auf den Download.' : n + ' Aktivitäten warten auf den Download.';
  }

  function renderProgress(st) {
    var bar = $('#bar-fill');
    var pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    var show = st.running || st.phase === 'done' || st.phase === 'error';
    $('#progress').classList.toggle('hidden', !show);
    bar.style.width = (st.phase === 'catalog' ? 100 : pct) + '%';
    bar.classList.toggle('indeterminate', st.phase === 'catalog');
    bar.classList.toggle('error', st.phase === 'error');
    $('#progress-text').textContent = st.message || '';
    $('#progress-current').textContent = st.running && st.current ? st.current : '';
    var log = $('#log');
    log.textContent = st.log.slice(-200).join('\n');
    log.scrollTop = log.scrollHeight;
    renderStatus();
  }

  /* ---------- Startup ---------- */
  async function init() {
    $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    SYNC.on(renderProgress);

    if (!STORE.supported()) {
      $('#unsupported').classList.remove('hidden');
    }
    ui.key = !!GARMIN.apiKey();
    if (!window.GARMIN_HEATMAP_CONFIG) $('#key-state').textContent = 'config.js nicht gefunden.';
    ui.proxy = await GARMIN.proxyHealth();
    if (STORE.supported()) {
      ui.folder = await STORE.restore();
      if (ui.folder === 'granted') await loadData();
    }
    renderStatus();
    wireButtons();

    var tab = 'sync';
    try { tab = localStorage.getItem('garmin-heatmap.tab') || 'sync'; } catch (e) { /* ignore */ }
    if (ui.folder !== 'granted') tab = 'sync';
    showTab(tab);

    if (ui.folder === 'granted' && ui.proxy && ui.key) autoCheck();
  }

  async function loadData() {
    await SYNC.load();
    ui.modelVersionShown = -1;
    if (ui.mapInit) refreshHeatmapData();
    renderStatus();
  }

  async function autoCheck() {
    try {
      var n = await SYNC.check();
      SYNC.log(n ? n + ' Aktivitäten zum Download bereit' : 'Alles aktuell – keine neuen Aktivitäten');
    } catch (e) { /* bereits geloggt */ }
    renderStatus();
  }

  function wireButtons() {
    $('#btn-pick').addEventListener('click', async function () {
      try {
        await STORE.pickFolder();
        ui.folder = 'granted';
        await loadData();
        renderStatus();
        if (ui.proxy && ui.key) autoCheck();
      } catch (e) { if (e.name !== 'AbortError') alert('Ordner konnte nicht geöffnet werden: ' + e.message); }
    });
    $('#btn-grant').addEventListener('click', async function () {
      if (await STORE.requestPermission()) {
        ui.folder = 'granted';
        await loadData();
        renderStatus();
        if (ui.proxy && ui.key) autoCheck();
      }
    });
    $('#btn-proxy-retry').addEventListener('click', async function () {
      ui.proxy = await GARMIN.proxyHealth();
      renderStatus();
      if (ui.proxy && ui.folder === 'granted' && ui.key) autoCheck();
    });
    $('#btn-check').addEventListener('click', autoCheck);
    $('#btn-download').addEventListener('click', runDownload);
    $('#btn-banner-download').addEventListener('click', runDownload);
    $('#btn-full').addEventListener('click', async function () {
      if (SYNC.state.running) return;
      SYNC.state.running = true;
      try { await SYNC.refreshCatalog(true); } catch (e) { SYNC.log('Fehler: ' + e.message); }
      SYNC.state.running = false;
      SYNC.state.phase = 'idle';
      renderStatus();
    });
    $('#btn-rebuild').addEventListener('click', async function () {
      await SYNC.rebuildModel();
      ui.modelVersionShown = -1;
      if (ui.mapInit) refreshHeatmapData();
    });
    $('#btn-reset-failed').addEventListener('click', function () { SYNC.resetFailed(); renderStatus(); });
    $('#btn-clear-log').addEventListener('click', function () { SYNC.state.log.length = 0; renderProgress(SYNC.state); });

    // Heatmap
    $$('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('[data-mode]').forEach(function (x) { x.classList.toggle('active', x === b); });
        HEATMAP.setMode(b.dataset.mode);
        $('#palette-row').classList.toggle('hidden', b.dataset.mode !== 'game');
        $('#legend').classList.toggle('game', b.dataset.mode === 'game');
        renderLegend();
      });
    });
    $('#palette').addEventListener('change', function () { HEATMAP.setPalette(this.value); renderLegend(); });
    $('#labels').addEventListener('change', function () { HEATMAP.setLabels(this.checked); });
    $('#btn-fit').addEventListener('click', function () { HEATMAP.fitBounds(GEO.bounds(SYNC.model().activities, activityFilterFn())); });
    $('#btn-export').addEventListener('click', async function () {
      try {
        var s = heatmapStats();
        var blob = await HEATMAP.exportPNG({ title: 'Meine Heatmap', subtitle: FMT.int(s.count) + ' Aktivitäten · ' + FMT.km(s.distance, 0) + ' · ' + s.years });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'heatmap-' + HEATMAP.getMode() + '-' + new Date().toISOString().slice(0, 10) + '.png';
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { alert('Export fehlgeschlagen: ' + e.message); }
    });

    // Poster
    $('#list-search').addEventListener('input', function () { ui.listFilter = this.value.toLowerCase(); ui.listShown = 0; renderList(); });
    $('#list-more').addEventListener('click', function () { renderList(true); });
    $$('[data-format]').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('[data-format]').forEach(function (x) { x.classList.toggle('active', x === b); });
        POSTER.setOptions({ format: b.dataset.format }); renderPoster();
      });
    });
    $('#poster-palette').addEventListener('change', function () { POSTER.setOptions({ palette: this.value }); renderPoster(); });
    $('#poster-profile').addEventListener('change', function () { POSTER.setOptions({ showProfile: this.checked }); renderPoster(); });
    $('#poster-stats').addEventListener('change', function () { POSTER.setOptions({ showStats: this.checked }); renderPoster(); });
    $('#poster-title').addEventListener('change', function () { POSTER.setOptions({ showTitle: this.checked }); renderPoster(); });
    $('#btn-poster-download').addEventListener('click', function () { POSTER.download($('#poster-canvas')); });
    $('#btn-poster-copy').addEventListener('click', async function () {
      try { await POSTER.copy($('#poster-canvas')); flash($('#btn-poster-copy'), 'Kopiert!'); }
      catch (e) { alert('Kopieren fehlgeschlagen: ' + e.message); }
    });

    var palSel = $('#palette'), palSel2 = $('#poster-palette');
    Object.keys(HEATMAP.PALETTES).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = HEATMAP.PALETTES[k].label; palSel.appendChild(o);
      var o2 = o.cloneNode(true); palSel2.appendChild(o2);
    });
  }

  async function runDownload() {
    await SYNC.download();
    ui.modelVersionShown = -1;
    if (ui.mapInit) refreshHeatmapData();
    renderList();
  }

  function flash(btn, text) {
    var old = btn.textContent; btn.textContent = text;
    setTimeout(function () { btn.textContent = old; }, 1500);
  }

  /* ---------- Heatmap ---------- */
  function initHeatmap() {
    if (!ui.mapInit) {
      ui.mapInit = true;
      HEATMAP.init('map');
      renderLegend();
    }
    setTimeout(function () { HEATMAP.resize(); }, 50);
    refreshHeatmapData();
  }

  function selectedGroups() { return $$('#filter-groups input:checked').map(function (i) { return i.value; }); }
  function selectedYears() { return $$('#filter-years input:checked').map(function (i) { return parseInt(i.value, 10); }); }
  function activityFilterFn() {
    var g = selectedGroups(), y = selectedYears();
    return function (a) { return g.indexOf(a.t) >= 0 && y.indexOf(a.y) >= 0; };
  }

  function heatmapStats() {
    var acts = SYNC.model() ? SYNC.model().activities : {};
    var cat = SYNC.catalog() ? SYNC.catalog().activities : {};
    var f = activityFilterFn();
    var count = 0, distance = 0, minY = Infinity, maxY = -Infinity;
    Object.keys(acts).forEach(function (id) {
      if (!f(acts[id])) return;
      count++;
      distance += (cat[id] && cat[id].dist) || 0;
      if (acts[id].y < minY) minY = acts[id].y; if (acts[id].y > maxY) maxY = acts[id].y;
    });
    return { count: count, distance: distance, years: count ? (minY === maxY ? String(minY) : minY + '–' + maxY) : '' };
  }

  function refreshHeatmapData() {
    if (!SYNC.model()) return;
    if (ui.modelVersionShown === SYNC.state.modelVersion) return;
    ui.modelVersionShown = SYNC.state.modelVersion;
    var acts = SYNC.model().activities;
    var overlay = $('#map-overlay');
    overlay.classList.remove('hidden');
    overlay.textContent = 'Berechne Heatmap …';
    setTimeout(function () {
      var t0 = performance.now();
      var stats = HEATMAP.setActivities(acts);
      buildFilters(acts);
      applyHeatmapFilter();
      var first = !ui.fitted;
      ui.fitted = true;
      if (first) HEATMAP.fitBounds(GEO.bounds(acts));
      overlay.classList.add('hidden');
      $('#map-stats').textContent = stats.activities ? FMT.int(stats.activities) + ' Aktivitäten · ' + FMT.int(stats.points) + ' Punkte · ' + FMT.int(stats.cells) + ' Zellen · ' + Math.round(performance.now() - t0) + ' ms' : 'Noch keine Aktivitäten mit GPS. Erst im Sync-Tab herunterladen.';
    }, 30);
  }

  function buildFilters(acts) {
    var groups = {}, years = {};
    Object.keys(acts).forEach(function (id) { var a = acts[id]; groups[a.t] = (groups[a.t] || 0) + 1; years[a.y] = (years[a.y] || 0) + 1; });
    var order = ['cycling', 'running', 'walking', 'swimming', 'winter', 'other'];
    var gEl = $('#filter-groups');
    var prevG = selectedGroups(), hadG = gEl.children.length > 0;
    gEl.innerHTML = '';
    order.filter(function (g) { return groups[g]; }).forEach(function (g) {
      var checked = hadG ? prevG.indexOf(g) >= 0 : true;
      gEl.insertAdjacentHTML('beforeend', '<label><input type="checkbox" value="' + g + '"' + (checked ? ' checked' : '') + '> ' + FMT.groupLabel(g) + ' <span class="count">' + groups[g] + '</span></label>');
    });
    var yEl = $('#filter-years');
    var prevY = selectedYears(), hadY = yEl.children.length > 0;
    yEl.innerHTML = '';
    Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
      var checked = hadY ? prevY.indexOf(y) >= 0 : true;
      yEl.insertAdjacentHTML('beforeend', '<label><input type="checkbox" value="' + y + '"' + (checked ? ' checked' : '') + '> ' + y + ' <span class="count">' + years[y] + '</span></label>');
    });
    $$('#filter-groups input, #filter-years input').forEach(function (i) { i.addEventListener('change', applyHeatmapFilter); });
    $('#years-all').onclick = function () { $$('#filter-years input').forEach(function (i) { i.checked = true; }); applyHeatmapFilter(); };
    $('#years-none').onclick = function () { $$('#filter-years input').forEach(function (i) { i.checked = false; }); applyHeatmapFilter(); };
  }

  function applyHeatmapFilter() {
    HEATMAP.setFilter({ groups: selectedGroups(), years: selectedYears() });
    var s = heatmapStats();
    $('#filter-stats').textContent = FMT.int(s.count) + ' Aktivitäten · ' + FMT.km(s.distance, 0);
  }

  function renderLegend() {
    var el = $('#legend');
    var game = HEATMAP.getMode() === 'game';
    var pal = HEATMAP.PALETTES[$('#palette').value] || HEATMAP.PALETTES.neon;
    var colors = game ? pal.core : HEATMAP.ANALYSIS.colors;
    var glows = game ? pal.glow : HEATMAP.ANALYSIS.colors;
    var html = '<div class="legend-title">Wie oft gefahren</div>';
    GEO.BUCKET_LABELS.forEach(function (label, i) {
      var w = 2 + i * 1.5;
      html += '<div class="legend-row"><span class="legend-line" style="height:' + w + 'px;background:' + colors[i] + ';box-shadow:0 0 ' + (game ? 6 + i * 3 : 0) + 'px ' + glows[i] + '"></span><span>' + label + '</span></div>';
    });
    el.innerHTML = html;
  }

  /* ---------- Poster ---------- */
  function listEntries() {
    var cat = SYNC.catalog();
    if (!cat) return [];
    var all = Object.keys(cat.activities).map(function (id) { return cat.activities[id]; });
    all.sort(function (a, b) { return (b.start || '').localeCompare(a.start || ''); });
    if (ui.listFilter) {
      all = all.filter(function (e) { return ((e.name || '') + ' ' + FMT.typeLabel(e.type) + ' ' + (e.loc || '') + ' ' + (e.start || '')).toLowerCase().indexOf(ui.listFilter) >= 0; });
    }
    return all;
  }

  function renderList(more) {
    var el = $('#activity-list');
    var entries = listEntries();
    if (more) ui.listShown += 100; else ui.listShown = 100;
    var shown = entries.slice(0, ui.listShown);
    if (!entries.length) {
      el.innerHTML = '<div class="empty">' + (SYNC.catalog() ? 'Keine Aktivitäten gefunden.' : 'Erst Datenordner verbinden und Aktivitäten herunterladen.') + '</div>';
    } else {
      el.innerHTML = shown.map(function (e) {
        var cur = POSTER.current();
        return '<div class="act' + (cur && cur.id === e.id ? ' active' : '') + (e.gps ? '' : ' nogps') + '" data-id="' + e.id + '">' +
          '<div class="act-top"><span class="act-name">' + FMT.esc(e.name || FMT.typeLabel(e.type)) + '</span><span class="act-date">' + FMT.date(e.start) + '</span></div>' +
          '<div class="act-sub"><span class="badge ' + e.group + '">' + FMT.esc(FMT.typeLabel(e.type)) + '</span> ' + FMT.km(e.dist) + ' · ' + FMT.dur(e.dur) + (e.elev ? ' · ' + FMT.meters(e.elev) : '') + (e.gps ? '' : ' · <em>kein GPS</em>') + '</div></div>';
      }).join('');
    }
    $('#list-more').classList.toggle('hidden', shown.length >= entries.length);
    $('#list-count').textContent = entries.length ? shown.length + ' von ' + entries.length : '';
    $$('#activity-list .act').forEach(function (d) {
      d.addEventListener('click', async function () {
        var e = SYNC.catalog().activities[d.dataset.id];
        $$('#activity-list .act').forEach(function (x) { x.classList.toggle('active', x === d); });
        await POSTER.load(e);
        renderPoster();
      });
    });
  }

  function renderPoster() {
    var canvas = $('#poster-canvas');
    var cur = POSTER.current();
    $('#poster-empty').classList.toggle('hidden', !!cur);
    $('#poster-wrap').classList.toggle('hidden', !cur);
    if (!cur) return;
    POSTER.render(canvas);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
