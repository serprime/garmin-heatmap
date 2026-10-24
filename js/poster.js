/* Poster-Grafik einer einzelnen Aktivitaet (Canvas). Globales Objekt: POSTER */
window.POSTER = (function () {
  'use strict';

  var FORMATS = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] };
  var opts = { format: 'portrait', palette: 'neon', showProfile: true, showStats: true, showTitle: true };
  var current = null, track = null, lines = null;

  function setOptions(o) { Object.keys(o).forEach(function (k) { opts[k] = o[k]; }); }
  function getOptions() { return opts; }

  async function load(entry) {
    current = entry;
    track = await STORE.readJSON('activities/' + entry.id + '/track.json');
    lines = null;
    if (track && track.lat) {
      lines = GEO.trackToLines(track.lat, track.lon).map(GEO.decodeDeltas);
    }
    return { entry: entry, hasTrack: !!(lines && lines.length) };
  }

  function font(weight, px) { return weight + ' ' + Math.round(px) + 'px -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif'; }

  function statsFor(e) {
    var s = [];
    s.push({ label: 'Distanz', value: FMT.km(e.dist) });
    s.push({ label: 'Zeit', value: FMT.dur(e.movingDur || e.dur) });
    if (e.group === 'running' || e.group === 'walking') s.push({ label: 'Ø Pace', value: FMT.pace(e.avgSpd) });
    else s.push({ label: 'Ø Tempo', value: FMT.speed(e.avgSpd) });
    if (e.elev != null && e.elev > 0) s.push({ label: 'Höhenmeter', value: FMT.meters(e.elev) });
    else if (e.avgHr) s.push({ label: 'Ø Puls', value: Math.round(e.avgHr) + ' bpm' });
    if (s.length < 4 && e.avgHr) s.push({ label: 'Ø Puls', value: Math.round(e.avgHr) + ' bpm' });
    return s.slice(0, 4);
  }

  function smooth(arr, win) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      var a = Math.max(0, i - win), b = Math.min(arr.length - 1, i + win), sum = 0, n = 0;
      for (var j = a; j <= b; j++) { sum += arr[j]; n++; }
      out[i] = sum / n;
    }
    return out;
  }

  /** Rendert das Poster in den Canvas. */
  function render(canvas) {
    var size = FORMATS[opts.format] || FORMATS.portrait;
    var W = size[0], H = size[1];
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var p = HEATMAP.PALETTES[opts.palette] || HEATMAP.PALETTES.neon;
    var glow = p.glow[2], core = p.core[1], bright = p.core[4];
    var e = current || {};
    var M = Math.round(W * 0.075);

    // Hintergrund
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0c1120'); bg.addColorStop(1, '#04060b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Layout
    var y = M;
    if (opts.showTitle) {
      ctx.fillStyle = '#ffffff';
      ctx.font = font(800, W * 0.062);
      ctx.textBaseline = 'top';
      var title = e.name || FMT.typeLabel(e.type);
      ctx.fillText(fitText(ctx, title, W - 2 * M), M, y);
      y += W * 0.075;
      ctx.font = font(500, W * 0.028);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      var sub = [FMT.date(e.start), FMT.typeLabel(e.type), e.loc].filter(Boolean).join('  ·  ');
      ctx.fillText(sub, M, y);
      y += W * 0.06;
    }
    var bottomBlocks = 0;
    var statsH = opts.showStats ? W * 0.16 : 0;
    var profileH = (opts.showProfile && track && track.ele) ? W * 0.14 : 0;
    var routeTop = y + M * 0.3;
    var routeBottom = H - M - statsH - profileH - (statsH ? M * 0.5 : 0) - (profileH ? M * 0.4 : 0);
    var boxW = W - 2 * M, boxH = Math.max(100, routeBottom - routeTop);

    // Route
    if (lines && lines.length) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      lines.forEach(function (f) { for (var i = 0; i < f.length; i += 2) { if (f[i] < minX) minX = f[i]; if (f[i] > maxX) maxX = f[i]; if (f[i + 1] < minY) minY = f[i + 1]; if (f[i + 1] > maxY) maxY = f[i + 1]; } });
      var pad = 0.06;
      var scale = Math.min(boxW * (1 - 2 * pad) / Math.max(1, maxX - minX), boxH * (1 - 2 * pad) / Math.max(1, maxY - minY));
      var ox = M + (boxW - (maxX - minX) * scale) / 2, oy = routeTop + (boxH - (maxY - minY) * scale) / 2;
      var tx = function (x) { return ox + (x - minX) * scale; }, ty = function (yy) { return oy + (yy - minY) * scale; };

      // Hintergrund-Glow hinter der Route
      var rg = ctx.createRadialGradient(W / 2, routeTop + boxH / 2, 10, W / 2, routeTop + boxH / 2, Math.max(boxW, boxH) * 0.7);
      rg.addColorStop(0, hexA(glow, 0.18)); rg.addColorStop(1, hexA(glow, 0));
      ctx.fillStyle = rg; ctx.fillRect(0, routeTop - M, W, boxH + 2 * M);

      var base = Math.max(2.5, W / 300);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      var passes = [
        { w: base * 9, a: 0.16, c: glow, blur: base * 10 },
        { w: base * 4, a: 0.45, c: glow, blur: base * 3 },
        { w: base * 1.6, a: 1, c: core, blur: 0 },
        { w: base * 0.6, a: 0.9, c: bright, blur: 0 }
      ];
      passes.forEach(function (ps) {
        ctx.save();
        ctx.globalAlpha = ps.a; ctx.strokeStyle = ps.c; ctx.lineWidth = ps.w;
        if (ps.blur) { ctx.shadowBlur = ps.blur; ctx.shadowColor = ps.c; }
        lines.forEach(function (f) {
          ctx.beginPath();
          ctx.moveTo(tx(f[0]), ty(f[1]));
          for (var i = 2; i < f.length; i += 2) ctx.lineTo(tx(f[i]), ty(f[i + 1]));
          ctx.stroke();
        });
        ctx.restore();
      });
      // Start / Ziel
      var first = lines[0], last = lines[lines.length - 1];
      dot(ctx, tx(first[0]), ty(first[1]), base * 2.2, '#ffffff', glow);
      dot(ctx, tx(last[last.length - 2]), ty(last[last.length - 1]), base * 2.2, bright, glow, true);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = font(500, W * 0.03);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(track ? 'Keine GPS-Daten in dieser Aktivität' : 'Track noch nicht geladen', W / 2, routeTop + boxH / 2);
      ctx.textAlign = 'left';
    }

    // Hoehenprofil
    var yy = routeBottom + M * 0.4;
    if (profileH) {
      var ele = [], dist = [];
      for (var i = 0; i < track.n; i++) if (track.ele[i] != null) { ele.push(track.ele[i]); dist.push(track.dist && track.dist[i] != null ? track.dist[i] : i); }
      if (ele.length > 10) {
        var sm = smooth(ele, Math.max(2, Math.round(ele.length / 200)));
        var emin = Math.min.apply(null, sm), emax = Math.max.apply(null, sm);
        var span = Math.max(30, emax - emin);
        var dmax = dist[dist.length - 1] || ele.length;
        ctx.save();
        ctx.beginPath();
        for (var k = 0; k < sm.length; k++) {
          var px = M + (dist[k] / dmax) * boxW, py = yy + profileH - ((sm[k] - emin) / span) * profileH * 0.85;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.lineTo(M + boxW, yy + profileH); ctx.lineTo(M, yy + profileH); ctx.closePath();
        var pg = ctx.createLinearGradient(0, yy, 0, yy + profileH);
        pg.addColorStop(0, hexA(glow, 0.55)); pg.addColorStop(1, hexA(glow, 0.02));
        ctx.fillStyle = pg; ctx.fill();
        ctx.beginPath();
        for (var k2 = 0; k2 < sm.length; k2++) {
          var px2 = M + (dist[k2] / dmax) * boxW, py2 = yy + profileH - ((sm[k2] - emin) / span) * profileH * 0.85;
          k2 === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
        }
        ctx.strokeStyle = core; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = font(500, W * 0.02);
        ctx.textBaseline = 'bottom';
        ctx.fillText(Math.round(emin) + ' – ' + Math.round(emax) + ' m', M, yy - 4);
      }
      yy += profileH + M * 0.5;
    }

    // Stats
    if (statsH) {
      var stats = statsFor(e);
      var colW = boxW / stats.length;
      ctx.textBaseline = 'top';
      // Wertgroesse so waehlen, dass der breiteste Wert in seine Spalte passt
      var valueSize = W * 0.048;
      ctx.font = font(700, valueSize);
      var widest = Math.max.apply(null, stats.map(function (s) { return ctx.measureText(s.value).width; }));
      if (widest > colW * 0.88) valueSize = valueSize * (colW * 0.88) / widest;
      stats.forEach(function (s, idx) {
        var x = M + idx * colW;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = font(600, W * 0.021);
        ctx.fillText(s.label.toUpperCase(), x, yy);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(700, valueSize);
        ctx.fillText(s.value, x, yy + W * 0.035);
      });
    }

    // Fussnote
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = font(500, W * 0.017);
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'right';
    ctx.fillText(FMT.date(e.start) + (e.start ? ' ' + FMT.time(e.start) : ''), W - M, H - M * 0.45);
    ctx.textAlign = 'left';
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function dot(ctx, x, y, r, fill, glow, hollow) {
    ctx.save();
    ctx.shadowBlur = r * 3; ctx.shadowColor = glow;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (hollow) { ctx.lineWidth = r * 0.7; ctx.strokeStyle = fill; ctx.stroke(); }
    else { ctx.fillStyle = fill; ctx.fill(); }
    ctx.restore();
  }
  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 3 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  function toBlob(canvas) { return new Promise(function (res) { canvas.toBlob(res, 'image/png'); }); }

  async function download(canvas) {
    var blob = await toBlob(canvas);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (current ? (current.start || '').slice(0, 10) + '-' + FMT.slug(current.name) : 'poster') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  async function copy(canvas) {
    var blob = await toBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  return { FORMATS: FORMATS, setOptions: setOptions, getOptions: getOptions, load: load, render: render, download: download, copy: copy, current: function () { return current; } };
})();
