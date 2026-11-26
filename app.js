/* Amajing Timestamp — kamera selfie dengan cap waktu + lokasi.
   Semua diproses di HP; foto tidak diunggah ke server mana pun. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var video = $('video'), view = $('view'), vctx = view.getContext('2d');

  // ---------- Pengaturan ----------
  var DEFAULTS = {
    name: '', place: '', note: '', day: true, sec: false,
    gps: true, level: 'spesifik', coords: true, map: true,
    size: 100, pos: 'bl', bg: 'gelap', accent: '#FFC93C', mirror: true, mark: true,
  };
  var KEY = 'amajing-timestamp-settings';
  var S = load();
  function load() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    var s = {}; for (var k in DEFAULTS) s[k] = (k in o) ? o[k] : DEFAULTS[k];
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  var LEVEL_HINT = {
    lengkap: 'Contoh: Jl. Ijen No. 25, Kel. Oro-oro Dowo, Kec. Klojen, Kota Malang, Jawa Timur 65119',
    spesifik: 'Contoh: Jl. Ijen, Kel. Oro-oro Dowo, Kec. Klojen, Kota Malang',
    umum: 'Contoh: Kec. Klojen, Kota Malang',
    kota: 'Contoh: Kota Malang',
  };

  // ---------- Kamera ----------
  var facing = 'user', stream = null, running = false;

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Browser ini tidak mendukung kamera. Coba buka dengan Chrome terbaru.'));
    }
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
    }).then(function (s) {
      stream = s; video.srcObject = s;
      return video.play();
    }).then(function () {
      $('start').hidden = true;
      if (!running) { running = true; requestAnimationFrame(loop); }
    });
  }

  function cameraError(err) {
    var msg = err && err.name === 'NotAllowedError'
      ? 'Izin kamera ditolak. Buka ikon gembok/ⓘ di address bar → Izin → Kamera → Izinkan, lalu muat ulang.'
      : err && err.name === 'NotFoundError' ? 'Kamera tidak ditemukan di perangkat ini.'
      : (err && err.message) || 'Kamera gagal dibuka.';
    $('start').hidden = false; $('startErr').hidden = false; $('startErr').textContent = msg;
  }

  // ---------- GPS & alamat ----------
  var loc = null;        // {lat, lng, acc}
  var addr = null;       // {poi, jalan, kel, kec, kota, prov, pos}
  var geoAt = null;      // titik terakhir yang sudah dicari alamatnya
  var geoBusy = false, geoLastTry = 0, watchId = null, gpsErr = '';

  function startGps() {
    if (!S.gps || watchId !== null) return updateChip();
    if (!navigator.geolocation) { gpsErr = 'GPS tidak didukung'; return updateChip(); }
    gpsErr = '';
    watchId = navigator.geolocation.watchPosition(function (p) {
      loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      gpsErr = ''; maybeGeocode(); maybeMap(); updateChip();
    }, function (e) {
      gpsErr = e.code === 1 ? 'Izin lokasi ditolak' : 'GPS belum dapat sinyal';
      updateChip();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    updateChip();
  }
  function stopGps() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; updateChip();
  }

  function distM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function maybeGeocode() {
    if (!loc || geoBusy) return;
    if (geoAt && distM(geoAt, loc) < 35) return;
    if (Date.now() - geoLastTry < 4000) return;
    geoBusy = true; geoLastTry = Date.now();
    var at = { lat: loc.lat, lng: loc.lng };
    nominatim(at).catch(function () { return bigdatacloud(at); }).then(function (a) {
      addr = a; geoAt = at;
    }).catch(function () { /* offline: koordinat saja */ }).then(function () {
      geoBusy = false; updateChip();
    });
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function prefixed(word, name) {
    if (!name) return '';
    return /^(kota|kabupaten|kab\.)\s/i.test(name) ? name : word + ' ' + name;
  }
  function nominatim(p) {
    return fetchJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=id&lat=' +
      p.lat.toFixed(6) + '&lon=' + p.lng.toFixed(6)).then(function (j) {
      var a = j && j.address; if (!a) throw new Error('kosong');
      var road = a.road || a.pedestrian || a.footway || a.path || a.residential || '';
      var kota = a.city ? prefixed('Kota', a.city) : a.town ? a.town : (a.county || a.regency) ? prefixed('Kabupaten', a.county || a.regency) : (a.municipality || '');
      return {
        poi: j.name && j.name !== road ? j.name : '',
        jalan: road ? road + (a.house_number ? ' No. ' + a.house_number : '') : '',
        kel: a.village || a.suburb || a.neighbourhood || a.quarter || a.hamlet || '',
        kec: a.city_district || a.district || a.subdistrict || (a.city || a.town ? a.municipality : '') || '',
        kota: kota, prov: a.state || '', pos: a.postcode || '',
      };
    });
  }
  function bigdatacloud(p) {
    return fetchJson('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=id&latitude=' +
      p.lat + '&longitude=' + p.lng).then(function (j) {
      var adm = (j.localityInfo && j.localityInfo.administrative) || [];
      var lvl = function (n) { for (var i = 0; i < adm.length; i++) if (adm[i].adminLevel === n) return adm[i].name; return ''; };
      return { poi: '', jalan: '', kel: lvl(7) || j.locality || '', kec: lvl(6) || '', kota: lvl(5) || j.city || '',
        prov: j.principalSubdivision || '', pos: j.postcode || '' };
    });
  }

  function addressText(a, level) {
    if (!a) return '';
    var kel = a.kel ? (/^(kel|desa)/i.test(a.kel) ? a.kel : 'Kel. ' + a.kel) : '';
    var kec = a.kec ? (/^kec/i.test(a.kec) ? a.kec : 'Kec. ' + a.kec) : '';
    var parts;
    if (level === 'lengkap') parts = [a.poi, a.jalan, kel, kec, a.kota, [a.prov, a.pos].filter(Boolean).join(' ')];
    else if (level === 'spesifik') parts = [a.jalan || a.poi, kel, kec, a.kota];
    else if (level === 'umum') parts = [kec, a.kota];
    else parts = [a.kota || a.prov];
    var seen = {}, out = [];
    parts.forEach(function (x) { if (x && !seen[x.toLowerCase()]) { seen[x.toLowerCase()] = 1; out.push(x); } });
    return out.join(', ');
  }

  function updateChip() {
    var dot = $('gpsDot'), t = $('gpsText');
    if (!S.gps) { dot.className = 'dot'; t.textContent = 'Lokasi tidak ditampilkan'; return; }
    if (gpsErr && !loc) { dot.className = 'dot bad'; t.textContent = gpsErr; return; }
    if (!loc) { dot.className = 'dot wait'; t.textContent = 'Mencari lokasi…'; return; }
    dot.className = loc.acc <= 50 ? 'dot ok' : 'dot wait';
    var txt = addressText(addr, S.level === 'kota' ? 'kota' : 'umum');
    t.textContent = '±' + Math.round(loc.acc) + ' m' + (txt ? ' · ' + txt : geoBusy ? ' · mencari alamat…' : '');
  }

  // ---------- Peta mini (ubin OpenStreetMap) ----------
  var MAPZ = 17, mapImg = null, mapAt = null, mapBusy = false, tileCache = {};
  function tileImg(x, y) {
    var k = MAPZ + '/' + x + '/' + y;
    if (!tileCache[k]) tileCache[k] = new Promise(function (res, rej) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); }; im.onerror = function () { delete tileCache[k]; rej(new Error('tile')); };
      im.src = 'https://tile.openstreetmap.org/' + k + '.png';
    });
    return tileCache[k];
  }
  function maybeMap() {
    if (!S.gps || !S.map || !loc || mapBusy) return;
    if (mapAt && distM(mapAt, loc) < 15) return;
    mapBusy = true;
    var at = { lat: loc.lat, lng: loc.lng }, n = Math.pow(2, MAPZ);
    var fx = (at.lng + 180) / 360 * n;
    var r = at.lat * Math.PI / 180;
    var fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    var px = fx * 256, py = fy * 256, half = 128;   // area 256×256 piksel ubin di sekitar titik
    var x0 = Math.floor((px - half) / 256), y0 = Math.floor((py - half) / 256);
    var jobs = [];
    for (var dx = 0; dx < 2; dx++) for (var dy = 0; dy < 2; dy++) {
      (function (tx, ty) {
        jobs.push(tileImg(tx, ty).then(function (im) { return { im: im, tx: tx, ty: ty }; }));
      })(x0 + dx, y0 + dy);
    }
    Promise.all(jobs).then(function (tiles) {
      var c = document.createElement('canvas'); c.width = c.height = 256;
      var g = c.getContext('2d');
      tiles.forEach(function (t) { g.drawImage(t.im, t.tx * 256 - (px - half), t.ty * 256 - (py - half)); });
      g.getImageData(0, 0, 1, 1); // memastikan kanvas tidak "tercemar" (CORS)
      mapImg = c; mapAt = at;
    }).catch(function () { /* tanpa peta */ }).then(function () { mapBusy = false; });
  }

  // ---------- Menggambar cap waktu ----------
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  function tzLabel(d) {
    var off = -d.getTimezoneOffset() / 60;
    return off === 7 ? 'WIB' : off === 8 ? 'WITA' : off === 9 ? 'WIT' : 'GMT' + (off >= 0 ? '+' : '') + off;
  }
  function stampData(d, forPhoto) {
    var day = d.toLocaleDateString('id-ID', { weekday: 'long' });
    var date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    var out = {
      time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (S.sec ? ':' + pad2(d.getSeconds()) : ''),
      top: S.day ? day : date, bottom: (S.day ? date + ' · ' : '') + tzLabel(d),
      address: '', coords: '', waiting: '',
    };
    if (S.gps) {
      if (loc) {
        out.address = addressText(addr, S.level);
        if (S.coords || !out.address) out.coords = loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) + '  ±' + Math.round(loc.acc) + ' m';
        if (!out.address && !forPhoto) out.waiting = 'Mencari alamat…';
      } else if (!forPhoto) out.waiting = gpsErr || 'Mencari lokasi GPS…';
    }
    return out;
  }

  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function wrap(g, text, maxW) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  function drawStamp(g, W, H, d) {
    var u = Math.min(W, H) / 1080 * (S.size / 100);
    var margin = Math.round(Math.min(W, H) * 0.035), pad = 24 * u, maxW = Math.min(W * 0.94, W - 2 * margin) - 2 * pad;
    var timeSize = 92 * u, dSize = 30 * u, lSize = 30 * u, sSize = 24 * u, mSize = 20 * u;
    var shadow = S.bg === 'none';

    // Susun baris info
    var rows = []; // {text, size, weight, color}
    var addRows = function (text, size, weight, color) {
      g.font = weight + ' ' + size + 'px ' + FONT;
      wrap(g, text, maxW).forEach(function (t) { rows.push({ text: t, size: size, weight: weight, color: color }); });
    };
    if (S.place) addRows(S.place, lSize, '700', '#fff');
    if (d.address) addRows(d.address, lSize, '500', '#fff');
    if (d.waiting) addRows(d.waiting, sSize, 'italic 500', 'rgba(255,255,255,.7)');
    if (d.coords) addRows(d.coords, sSize, '500', 'rgba(255,255,255,.82)');
    if (S.name) addRows(S.name, lSize, '700', S.accent);
    if (S.note) addRows(S.note, lSize, '500', '#fff');

    // Ukuran blok jam
    g.font = '700 ' + timeSize + 'px ' + FONT;
    var timeW = g.measureText(d.time).width;
    g.font = '700 ' + dSize + 'px ' + FONT; var w1 = g.measureText(d.top).width;
    g.font = '500 ' + dSize + 'px ' + FONT; var w2 = g.measureText(d.bottom).width;
    var barGap = 16 * u, barW = 6 * u;
    var headW = timeW + barGap * 2 + barW + Math.max(w1, w2), headH = timeSize * 0.95;

    var lineGap = 1.3, bodyH = 0, bodyW = 0;
    rows.forEach(function (r) { g.font = r.weight + ' ' + r.size + 'px ' + FONT; bodyW = Math.max(bodyW, g.measureText(r.text).width); bodyH += r.size * lineGap; });
    var markH = S.mark ? mSize * 1.9 : 0;
    var innerW = Math.max(headW, bodyW, S.mark ? 220 * u : 0);
    var boxW = innerW + pad * 2, boxH = pad + headH + (rows.length ? 14 * u + bodyH : 0) + markH + pad * 0.8;

    var left = S.pos === 'bl' || S.pos === 'tl', bottom = S.pos === 'bl' || S.pos === 'br';
    var bx = left ? margin : W - margin - boxW;
    var by = bottom ? H - margin - boxH : margin;

    // Peta mini di atas/bawah kotak
    if (S.gps && S.map && mapImg && loc) {
      var ms = Math.min(210 * u, Math.min(W, H) * 0.32), mg = 10 * u;
      var mx = left ? bx : bx + boxW - ms;
      var my = bottom ? by - mg - ms : by + boxH + mg;
      g.save(); rrect(g, mx, my, ms, ms, 14 * u); g.clip();
      g.drawImage(mapImg, mx, my, ms, ms);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(mx, my + ms - 18 * u, ms, 18 * u);
      g.fillStyle = '#fff'; g.font = '500 ' + 11 * u + 'px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'right';
      g.fillText('© OpenStreetMap', mx + ms - 6 * u, my + ms - 9 * u);
      g.restore();
      g.textAlign = 'left';
      // pin
      var cx = mx + ms / 2, cy = my + ms / 2, pr = 11 * u;
      g.beginPath(); g.arc(cx, cy - pr * 1.2, pr, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(cx, cy); g.closePath();
      g.fillStyle = '#E53935'; g.fill(); g.lineWidth = 2.5 * u; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(cx, cy - pr * 1.2, pr * 0.38, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.lineWidth = 2 * u; g.strokeStyle = 'rgba(255,255,255,.85)'; rrect(g, mx, my, ms, ms, 14 * u); g.stroke();
    }

    // Kotak latar
    if (S.bg !== 'none') {
      g.fillStyle = S.bg === 'gelap' ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.22)';
      rrect(g, bx, by, boxW, boxH, 18 * u); g.fill();
    }
    if (shadow) { g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 8 * u; g.shadowOffsetY = 2 * u; }

    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    var x = bx + pad, y = by + pad;
    g.fillStyle = '#fff'; g.font = '700 ' + timeSize + 'px ' + FONT;
    g.fillText(d.time, x, y + headH * 0.86);
    var barX = x + timeW + barGap;
    g.fillStyle = S.accent; rrect(g, barX, y + headH * 0.08, barW, headH * 0.84, barW / 2); g.fill();
    var tx = barX + barW + barGap;
    g.fillStyle = '#fff'; g.font = '700 ' + dSize + 'px ' + FONT; g.fillText(d.top, tx, y + headH * 0.42);
    g.fillStyle = 'rgba(255,255,255,.88)'; g.font = '500 ' + dSize + 'px ' + FONT; g.fillText(d.bottom, tx, y + headH * 0.86);

    y += headH + (rows.length ? 14 * u : 0);
    rows.forEach(function (r) {
      g.font = r.weight + ' ' + r.size + 'px ' + FONT; g.fillStyle = r.color;
      g.fillText(r.text, x, y + r.size * 1.0);
      y += r.size * lineGap;
    });
    if (S.mark) {
      y += mSize * 0.5;
      g.fillStyle = S.accent; g.beginPath(); g.arc(x + mSize * 0.35, y + mSize * 0.62, mSize * 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '600 ' + mSize + 'px ' + FONT;
      g.fillText('Amajing Timestamp', x + mSize * 0.95, y + mSize * 0.95);
    }
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  }

  // ---------- Pratinjau ----------
  function loop() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.round(view.clientWidth * dpr), ch = Math.round(view.clientHeight * dpr);
    if (view.width !== cw || view.height !== ch) { view.width = cw; view.height = ch; }
    vctx.fillStyle = '#000'; vctx.fillRect(0, 0, cw, ch);
    var vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      var sc = Math.min(cw / vw, ch / vh), dw = vw * sc, dh = vh * sc, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      vctx.save();
      if (facing === 'user') { vctx.translate(dx + dw, dy); vctx.scale(-1, 1); vctx.drawImage(video, 0, 0, dw, dh); }
      else vctx.drawImage(video, dx, dy, dw, dh);
      vctx.restore();
      vctx.save(); vctx.translate(dx, dy); vctx.beginPath(); vctx.rect(0, 0, dw, dh); vctx.clip();
      drawStamp(vctx, dw, dh, stampData(new Date(), false));
      vctx.restore();
    }
    requestAnimationFrame(loop);
  }

  // ---------- Ambil foto ----------
  var lastBlob = null, lastUrl = '', lastTime = null, lastData = null;
  function capture() {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    var now = new Date();
    var c = document.createElement('canvas'); c.width = vw; c.height = vh;
    var g = c.getContext('2d');
    if (facing === 'user' && S.mirror) { g.translate(vw, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0, vw, vh);
    g.setTransform(1, 0, 0, 1, 0, 0);
    lastData = stampData(now, true); lastTime = now;
    drawStamp(g, vw, vh, lastData);
    $('flash').classList.add('on'); setTimeout(function () { $('flash').classList.remove('on'); }, 60);
    if (navigator.vibrate) navigator.vibrate(30);
    c.toBlob(function (b) {
      if (!b) return toast('Gagal membuat foto.');
      lastBlob = b;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(b);
      $('resultImg').src = lastUrl; $('lastImg').src = lastUrl; $('btnLast').hidden = false;
      showResult(true);
    }, 'image/jpeg', 0.92);
  }
  function showResult(on) { $('result').hidden = !on; toast(''); }
  function fileName() {
    var d = lastTime || new Date();
    return 'Timestamp_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.jpg';
  }
  function reportText() {
    var d = lastTime || new Date(), x = lastData || stampData(d, true);
    var lines = [S.note ? '📍 ' + S.note : '📍 Laporan kunjungan'];
    if (S.name) lines.push('Nama: ' + S.name);
    lines.push('Waktu: ' + d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
      ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' ' + tzLabel(d));
    if (S.place) lines.push('Tempat: ' + S.place);
    if (x.address) lines.push('Lokasi: ' + x.address);
    if (S.gps && S.coords && loc) lines.push('Peta: https://maps.google.com/?q=' + loc.lat.toFixed(6) + ',' + loc.lng.toFixed(6));
    return lines.join('\n');
  }
  function download() {
    var a = document.createElement('a'); a.href = lastUrl; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    toast('Foto disimpan ke folder Download.');
  }
  function share() {
    if (!lastBlob) return;
    var file = new File([lastBlob], fileName(), { type: 'image/jpeg' });
    var data = { files: [file], text: reportText() };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share(data).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        navigator.share({ files: [file] }).catch(function () {});
      });
    } else {
      download();
      toast('Browser ini belum bisa langsung kirim. Foto sudah disimpan — kirim dari galeri.');
    }
  }
  function copyReport() {
    var t = reportText();
    var done = function () { toast('Teks laporan disalin. Tempel di chat grup.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Gagal menyalin.'); }
      ta.remove();
    }
  }
  var toastT;
  function toast(msg) { var el = $('toast'); el.textContent = msg; clearTimeout(toastT); if (msg) toastT = setTimeout(function () { el.textContent = ''; }, 4000); }

  // ---------- Panel pengaturan ----------
  function bindText(id, key) {
    var el = $(id); el.value = S[key];
    el.addEventListener('input', function () { S[key] = el.value.trim(); save(); });
  }
  function bindCheck(id, key, after) {
    var el = $(id); el.checked = !!S[key];
    el.addEventListener('change', function () { S[key] = el.checked; save(); if (after) after(); });
  }
  function bindSeg(id, key, after) {
    var box = $(id);
    var paint = function () { [].forEach.call(box.children, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === S[key]); b.setAttribute('aria-checked', b.getAttribute('data-v') === S[key]); b.setAttribute('role', 'radio'); }); };
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S[key] = b.getAttribute('data-v'); save(); paint(); if (after) after();
    });
    paint();
  }
  function syncGpsUi() {
    $('sGps').closest('.sheet-body').querySelector('.gps-only').classList.toggle('off', !S.gps);
    $('levelHint').textContent = LEVEL_HINT[S.level] || '';
  }

  bindText('sName', 'name'); bindText('sPlace', 'place'); bindText('sNote', 'note');
  bindCheck('sDay', 'day'); bindCheck('sSec', 'sec');
  bindCheck('sGps', 'gps', function () { syncGpsUi(); if (S.gps) startGps(); else stopGps(); });
  bindCheck('sCoords', 'coords'); bindCheck('sMap', 'map', maybeMap);
  bindCheck('sMirror', 'mirror'); bindCheck('sMark', 'mark');
  bindSeg('sLevel', 'level', function () { syncGpsUi(); updateChip(); });
  bindSeg('sPos', 'pos'); bindSeg('sBg', 'bg'); bindSeg('sAccent', 'accent');
  var size = $('sSize'); size.value = S.size; $('sizeVal').textContent = S.size + '%';
  size.addEventListener('input', function () { S.size = +size.value; $('sizeVal').textContent = S.size + '%'; save(); });
  syncGpsUi();

  function openSheet(on) { $('sheetBg').hidden = !on; }
  $('btnSettings').addEventListener('click', function () { openSheet(true); });
  $('gpsChip').addEventListener('click', function () { openSheet(true); });
  $('btnClose').addEventListener('click', function () { openSheet(false); });
  $('sheetBg').addEventListener('click', function (e) { if (e.target === $('sheetBg')) openSheet(false); });

  // ---------- Tombol utama ----------
  $('btnStart').addEventListener('click', function () {
    $('startErr').hidden = true;
    startCamera().catch(cameraError);
    startGps();
  });
  $('btnShutter').addEventListener('click', capture);
  $('btnFlip').addEventListener('click', function () {
    facing = facing === 'user' ? 'environment' : 'user';
    startCamera().catch(cameraError);
  });
  $('btnLast').addEventListener('click', function () { showResult(true); });
  $('btnRetake').addEventListener('click', function () { showResult(false); });
  $('btnSave').addEventListener('click', download);
  $('btnShare').addEventListener('click', share);
  $('btnCopy').addEventListener('click', copyReport);
  document.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && $('result').hidden && $('sheetBg').hidden && $('start').hidden && e.target === document.body) { e.preventDefault(); capture(); }
    if (e.key === 'Escape') { openSheet(false); showResult(false); }
  });

  // Kamera dimatikan saat aplikasi di latar belakang (hemat baterai), hidup lagi saat kembali.
  document.addEventListener('visibilitychange', function () {
    if (!running) return;
    if (document.hidden) { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    else startCamera().catch(cameraError);
  });

  // Mulai otomatis bila izin kamera sudah pernah diberikan
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then(function (p) {
      if (p.state === 'granted') { startCamera().catch(cameraError); startGps(); }
    }).catch(function () {});
  }
  updateChip();

  // ---------- Pasang sebagai aplikasi ----------
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
  $('btnInstall').addEventListener('click', function () {
    if (!installEvt) return; installEvt.prompt();
    installEvt.userChoice.then(function () { installEvt = null; $('btnInstall').hidden = true; });
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
