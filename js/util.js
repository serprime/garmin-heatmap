/* Formatierung & Labels. Globales Objekt: FMT */
window.FMT = (function () {
  'use strict';
  var TYPE_LABELS = {
    cycling: 'Radfahren', road_biking: 'Rennrad', mountain_biking: 'Mountainbike', gravel_cycling: 'Gravel', cyclocross: 'Cyclocross',
    indoor_cycling: 'Indoor Cycling', virtual_ride: 'Virtual Ride', e_bike_fitness: 'E-Bike', bmx: 'BMX',
    running: 'Laufen', trail_running: 'Trailrunning', treadmill_running: 'Laufband', track_running: 'Bahnlauf', street_running: 'Strassenlauf',
    walking: 'Gehen', hiking: 'Wandern', casual_walking: 'Spaziergang',
    lap_swimming: 'Schwimmen', open_water_swimming: 'Freiwasser', strength_training: 'Krafttraining', yoga: 'Yoga', indoor_rowing: 'Rudern (indoor)',
    rowing: 'Rudern', resort_skiing: 'Ski', backcountry_skiing: 'Skitour', cross_country_classic_skiing: 'Langlauf', inline_skating: 'Inline-Skating',
    multi_sport: 'Multisport', other: 'Sonstiges'
  };
  var GROUP_LABELS = { cycling: 'Rad', running: 'Laufen', walking: 'Gehen/Wandern', swimming: 'Schwimmen', winter: 'Winter', other: 'Sonstiges' };
  var nf0 = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function km(m, digits) { if (m == null) return '–'; return (digits === 0 ? nf0 : nf1).format(m / 1000) + ' km'; }
  function meters(m) { if (m == null) return '–'; return nf0.format(m) + ' m'; }
  function dur(s) {
    if (s == null) return '–';
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
  }
  function durShort(s) {
    if (s == null) return '–';
    var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h > 0 ? h + ' h ' + pad(m) + ' min' : m + ' min';
  }
  function speed(mps) { if (!mps) return '–'; return nf1.format(mps * 3.6) + ' km/h'; }
  function pace(mps) {
    if (!mps) return '–';
    var spk = 1000 / mps;
    return Math.floor(spk / 60) + ':' + pad(Math.round(spk % 60)) + ' /km';
  }
  function date(str) {
    if (!str) return '–';
    var d = str.slice(0, 10).split('-');
    return d[2] + '.' + d[1] + '.' + d[0];
  }
  function time(str) { return str ? str.slice(11, 16) : ''; }
  function int(n) { return n == null ? '–' : nf0.format(n); }
  function typeLabel(key) {
    if (!key) return 'Aktivität';
    if (TYPE_LABELS[key]) return TYPE_LABELS[key];
    return key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function groupLabel(g) { return GROUP_LABELS[g] || g; }
  function slug(s) { return (s || 'aktivitaet').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  return { km: km, meters: meters, dur: dur, durShort: durShort, speed: speed, pace: pace, date: date, time: time, int: int, typeLabel: typeLabel, groupLabel: groupLabel, slug: slug, esc: esc };
})();
