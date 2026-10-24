/* Minimaler ZIP-Reader (Central Directory + deflate via DecompressionStream). Globales Objekt: ZIP */
window.ZIP = (function () {
  'use strict';

  async function inflateRaw(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    var buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Liest alle Eintraege eines ZIP-Archivs. Rueckgabe: [{ name, data: Uint8Array }] */
  async function read(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Kein ZIP-Archiv (EOCD fehlt)');
    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    var entries = [];
    var p = cdOffset;
    for (var e = 0; e < count; e++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP: Central Directory beschaedigt');
      var method = view.getUint16(p + 10, true);
      var csize = view.getUint32(p + 20, true);
      var usize = view.getUint32(p + 24, true);
      var nlen = view.getUint16(p + 28, true);
      var xlen = view.getUint16(p + 30, true);
      var clen = view.getUint16(p + 32, true);
      var lho = view.getUint32(p + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (view.getUint32(lho, true) !== 0x04034b50) throw new Error('ZIP: Local Header beschaedigt');
      var lnlen = view.getUint16(lho + 26, true);
      var lxlen = view.getUint16(lho + 28, true);
      var dataStart = lho + 30 + lnlen + lxlen;
      var raw = bytes.subarray(dataStart, dataStart + csize);
      var data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await inflateRaw(raw);
      else throw new Error('ZIP: Kompressionsmethode ' + method + ' nicht unterstuetzt');
      if (usize && data.length !== usize) throw new Error('ZIP: Groesse stimmt nicht fuer ' + name);
      entries.push({ name: name, data: data });
    }
    return entries;
  }

  return { read: read };
})();
