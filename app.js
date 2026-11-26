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
    size: 100, pos: 'bl', bg: 'gelap', accent: '#FFC93C', mirror: true, mark: true, auto: true,
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
      $('start').hidden = true; document.body.classList.remove('start-open');
      if (!running) { running = true; requestAnimationFrame(loop); }
    });
  }

  function cameraError(err) {
    var msg = err && err.name === 'NotAllowedError'
      ? 'Izin kamera ditolak. Buka ikon gembok/ⓘ di address bar → Izin → Kamera → Izinkan, lalu muat ulang.'
      : err && err.name === 'NotFoundError' ? 'Kamera tidak ditemukan di perangkat ini.'
      : (err && err.message) || 'Kamera gagal dibuka.';
    $('start').hidden = false; document.body.classList.add('start-open');
    $('startErr').hidden = false; $('startErr').textContent = msg;
  }

  // ---------- Arah HP (portrait / landscape) ----------
  // devRot = putaran fisik HP berlawanan jarum jam: 0 tegak, 90 atas di kiri, 180 terbalik, 270 atas di kanan.
  // Dibaca dari sensor gravitasi, jadi tetap jalan walau rotasi otomatis HP dimatikan.
  var devRot = 0, motionOn = false;
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function screenAngle() {
    var a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle
      : typeof window.orientation === 'number' ? window.orientation : 0;
    return (a + 360) % 360;
  }
  // Berapa derajat (searah jarum jam di layar) tulisan harus diputar agar tegak bagi pengguna
  function stampRot() { return (devRot - screenAngle() + 360) % 360; }
  function onMotion(e) {
    var a = e.accelerationIncludingGravity; if (!a || a.x == null || a.y == null) return;
    var x = a.x, y = a.y;
    if (isIOS) { x = -x; y = -y; }
    if (Math.sqrt(x * x + y * y) < 4.5) return;          // HP hampir rata (di meja) → arah tidak diubah
    var ang = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    var cand = (Math.round(ang / 90) % 4) * 90;
    var diff = Math.abs(((ang - cand + 540) % 360) - 180);
    if (diff < 30 && cand !== devRot) { devRot = cand; applyRot(); }
  }
  function applyRot() {
    var r = stampRot();
    document.documentElement.style.setProperty('--rot', (r === 270 ? -90 : r) + 'deg');
  }
  function enableMotion() {
    if (motionOn || typeof window.DeviceMotionEvent === 'undefined') return;
    var attach = function () { if (!motionOn) { motionOn = true; window.addEventListener('devicemotion', onMotion); } };
    if (isIOS && typeof DeviceMotionEvent.requestPermission === 'function') {      // iPhone: perlu izin lewat sentuhan
      DeviceMotionEvent.requestPermission().then(function (s) { if (s === 'granted') attach(); }).catch(function () {});
    } else attach();
  }
  window.addEventListener('orientationchange', applyRot);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', applyRot);

  // ---------- GPS & alamat ----------
  var loc = null, addr = null, geoAt = null;
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
    var px = fx * 256, py = fy * 256, half = 128;
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
  var font = function (w, s) { return w + ' ' + s + 'px ' + FONT; };

  // Hitung ukuran semua bagian untuk skala u (tanpa menggambar)
  function layoutStamp(g, W, H, d, u) {
    var minD = Math.min(W, H);
    var L = { u: u, margin: Math.round(minD * 0.035), pad: 24 * u,
      timeSize: 92 * u, dSize: 30 * u, lSize: 30 * u, sSize: 24 * u, mSize: 20 * u, rows: [] };
    // Lebar teks dibatasi supaya di foto landscape kotaknya tidak memanjang menutupi seluruh foto
    var maxW = Math.min(W - 2 * L.margin, Math.max(minD * 1.15, W * 0.6)) - 2 * L.pad;
    var addRows = function (text, size, weight, color) {
      g.font = font(weight, size);
      wrap(g, text, maxW).forEach(function (t) { L.rows.push({ text: t, size: size, weight: weight, color: color }); });
    };
    if (S.place) addRows(S.place, L.lSize, '700', '#fff');
    if (d.address) addRows(d.address, L.lSize, '500', '#fff');
    if (d.waiting) addRows(d.waiting, L.sSize, 'italic 500', 'rgba(255,255,255,.7)');
    if (d.coords) addRows(d.coords, L.sSize, '500', 'rgba(255,255,255,.82)');
    if (S.name) addRows(S.name, L.lSize, '700', S.accent);
    if (S.note) addRows(S.note, L.lSize, '500', '#fff');

    g.font = font('700', L.timeSize); L.timeW = g.measureText(d.time).width;
    g.font = font('700', L.dSize); var w1 = g.measureText(d.top).width;
    g.font = font('500', L.dSize); var w2 = g.measureText(d.bottom).width;
    L.barGap = 16 * u; L.barW = 6 * u;
    var headW = L.timeW + L.barGap * 2 + L.barW + Math.max(w1, w2);
    L.headH = L.timeSize * 0.95;

    var bodyH = 0, bodyW = 0;
    L.rows.forEach(function (r) { g.font = font(r.weight, r.size); bodyW = Math.max(bodyW, g.measureText(r.text).width); bodyH += r.size * 1.3; });
    L.gapBody = L.rows.length ? 14 * u : 0;
    var markH = S.mark ? L.mSize * 1.9 : 0;
    L.boxW = Math.max(headW, bodyW, S.mark ? 220 * u : 0) + L.pad * 2;
    L.boxH = L.pad + L.headH + L.gapBody + bodyH + markH + L.pad * 0.8;
    L.hasMap = !!(S.gps && S.map && mapImg && loc);
    L.ms = L.hasMap ? Math.min(210 * u, minD * 0.32) : 0;
    L.mg = L.hasMap ? 10 * u : 0;
    L.totalH = L.boxH + L.ms + L.mg;
    return L;
  }

  function drawStamp(g, W, H, d) {
    var u = Math.min(W, H) / 1080 * (S.size / 100), L;
    // Kecilkan otomatis bila tulisan tidak muat di bingkai foto (semua harus terlihat)
    for (var i = 0; i < 6; i++) {
      L = layoutStamp(g, W, H, d, u);
      var f = Math.min((W - 2 * L.margin) / L.boxW, (H - 2 * L.margin) / L.totalH);
      if (f >= 1) break;
      u *= Math.max(f * 0.97, 0.4);
    }
    var left = S.pos === 'bl' || S.pos === 'tl', bottom = S.pos === 'bl' || S.pos === 'br';
    var bx = left ? L.margin : W - L.margin - L.boxW;
    var by = bottom ? H - L.margin - L.boxH : L.margin + (L.hasMap ? 0 : 0);
    var shadow = S.bg === 'none';

    if (L.hasMap) {
      var ms = L.ms, mx = left ? bx : bx + L.boxW - ms;
      var my = bottom ? by - L.mg - ms : by + L.boxH + L.mg;
      g.save(); rrect(g, mx, my, ms, ms, 14 * u); g.clip();
      g.drawImage(mapImg, mx, my, ms, ms);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(mx, my + ms - 18 * u, ms, 18 * u);
      g.fillStyle = '#fff'; g.font = font('500', 11 * u); g.textBaseline = 'middle'; g.textAlign = 'right';
      g.fillText('© OpenStreetMap', mx + ms - 6 * u, my + ms - 9 * u);
      g.restore();
      g.textAlign = 'left';
      var cx = mx + ms / 2, cy = my + ms / 2, pr = 11 * u;
      g.beginPath(); g.arc(cx, cy - pr * 1.2, pr, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(cx, cy); g.closePath();
      g.fillStyle = '#E53935'; g.fill(); g.lineWidth = 2.5 * u; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(cx, cy - pr * 1.2, pr * 0.38, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.lineWidth = 2 * u; g.strokeStyle = 'rgba(255,255,255,.85)'; rrect(g, mx, my, ms, ms, 14 * u); g.stroke();
    }

    if (S.bg !== 'none') {
      g.fillStyle = S.bg === 'gelap' ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.22)';
      rrect(g, bx, by, L.boxW, L.boxH, 18 * u); g.fill();
    }
    if (shadow) { g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 8 * u; g.shadowOffsetY = 2 * u; }

    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    var x = bx + L.pad, y = by + L.pad, hh = L.headH;
    g.fillStyle = '#fff'; g.font = font('700', L.timeSize);
    g.fillText(d.time, x, y + hh * 0.86);
    var barX = x + L.timeW + L.barGap;
    g.fillStyle = S.accent; rrect(g, barX, y + hh * 0.08, L.barW, hh * 0.84, L.barW / 2); g.fill();
    var tx = barX + L.barW + L.barGap;
    g.fillStyle = '#fff'; g.font = font('700', L.dSize); g.fillText(d.top, tx, y + hh * 0.42);
    g.fillStyle = 'rgba(255,255,255,.88)'; g.font = font('500', L.dSize); g.fillText(d.bottom, tx, y + hh * 0.86);

    y += hh + L.gapBody;
    L.rows.forEach(function (r) {
      g.font = font(r.weight, r.size); g.fillStyle = r.color;
      g.fillText(r.text, x, y + r.size);
      y += r.size * 1.3;
    });
    if (S.mark) {
      var m = L.mSize; y += m * 0.5;
      g.fillStyle = S.accent; g.beginPath(); g.arc(x + m * 0.35, y + m * 0.62, m * 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.font = font('600', m);
      g.fillText('Amajing Timestamp', x + m * 0.95, y + m * 0.95);
    }
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  }

  // Gambar cap waktu di area (0,0,W,H) yang diputar r derajat (searah jarum jam) supaya tegak bagi pengguna
  function drawStampRotated(g, W, H, d, r) {
    var side = r === 90 || r === 270;
    var w = side ? H : W, h = side ? W : H;
    g.save();
    g.translate(W / 2, H / 2); g.rotate(r * Math.PI / 180); g.translate(-w / 2, -h / 2);
    drawStamp(g, w, h, d);
    g.restore();
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
      drawStampRotated(vctx, dw, dh, stampData(new Date(), false), stampRot());
      vctx.restore();
    }
    requestAnimationFrame(loop);
  }

  // ---------- Ambil foto ----------
  var lastBlob = null, lastUrl = '', lastTime = null, lastData = null;
  function capture() {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    enableMotion();
    var now = new Date(), r = stampRot(), side = r === 90 || r === 270;
    // 1) bingkai seperti yang terlihat di layar (selfie = cermin)
    var f = document.createElement('canvas'); f.width = vw; f.height = vh;
    var fg = f.getContext('2d');
    if (facing === 'user') { fg.translate(vw, 0); fg.scale(-1, 1); }
    fg.drawImage(video, 0, 0, vw, vh);
    // 2) putar mengikuti arah HP sehingga foto landscape benar-benar landscape
    var ow = side ? vh : vw, oh = side ? vw : vh;
    var c = document.createElement('canvas'); c.width = ow; c.height = oh;
    var g = c.getContext('2d');
    g.save();
    if (facing === 'user' && !S.mirror) { g.translate(ow, 0); g.scale(-1, 1); }   // selfie tidak dicermin
    g.translate(ow / 2, oh / 2); g.rotate(-r * Math.PI / 180); g.drawImage(f, -vw / 2, -vh / 2);
    g.restore();
    // 3) cap waktu tegak di foto akhir
    lastData = stampData(now, true); lastTime = now;
    lastData.maps = S.gps && S.coords && loc ? 'https://maps.google.com/?q=' + loc.lat.toFixed(6) + ',' + loc.lng.toFixed(6) : '';
    var shotData = lastData, shotTime = now;
    drawStamp(g, ow, oh, lastData);
    $('flash').classList.add('on'); setTimeout(function () { $('flash').classList.remove('on'); }, 60);
    if (navigator.vibrate) navigator.vibrate(30);
    c.toBlob(function (b) {
      if (!b) return camToast('Gagal membuat foto.');
      setLast(b, shotTime, shotData, true);
      idbSet('last', { blob: b, time: shotTime.getTime(), data: shotData });
      if (S.auto) {
        var th = $('btnLast'); th.classList.add('saving');
        savePhoto(true).then(function () { th.classList.remove('saving'); });
      } else showResult(true);
    }, 'image/jpeg', 0.92);
  }
  function showResult(on) { $('result').hidden = !on; toast(''); }
  // Foto terakhir: tampil di tombol kecil kiri tombol foto, tetap ada walau aplikasi ditutup
  function setLast(b, time, data, pop) {
    lastBlob = b; lastTime = time; lastData = data;
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(b);
    $('resultImg').src = lastUrl; $('lastImg').src = lastUrl; $('btnLast').hidden = false;
    if (pop) { var th = $('btnLast'); th.classList.remove('pop'); void th.offsetWidth; th.classList.add('pop'); }
  }
  var camT;
  function camToast(msg) {
    var el = $('camToast'); el.textContent = msg; el.hidden = !msg; clearTimeout(camT);
    if (msg) camT = setTimeout(function () { el.hidden = true; }, 2600);
  }
  function fileName() {
    var d = lastTime || new Date();
    return 'AmajingTimestamp_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
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
    if (x.maps) lines.push('Peta: ' + x.maps);
    return lines.join('\n');
  }

  // ---------- Simpan ke folder "Amajing Timestamp" ----------
  var FOLDER = 'Amajing Timestamp', dirHandle = null;
  var canPickFolder = typeof window.showDirectoryPicker === 'function';
  function idb(mode, fn) {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open('amajing-timestamp', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onerror = function () { rej(rq.error); };
      rq.onsuccess = function () {
        var tx = rq.result.transaction('kv', mode), st = tx.objectStore('kv'), out = fn(st);
        tx.oncomplete = function () { res(out && out.result); }; tx.onerror = function () { rej(tx.error); };
      };
    });
  }
  var idbGet = function (k) { return idb('readonly', function (s) { return s.get(k); }).catch(function () { return null; }); };
  var idbSet = function (k, v) { return idb('readwrite', function (s) { s.put(v, k); }).catch(function () {}); };

  function permitted(h) {
    var o = { mode: 'readwrite' };
    return h.queryPermission(o).then(function (p) {
      return p === 'granted' || h.requestPermission(o).then(function (p2) { return p2 === 'granted'; });
    }).catch(function () { return false; });
  }
  function pickFolder() {
    return window.showDirectoryPicker({ id: 'amajing-timestamp', mode: 'readwrite', startIn: 'pictures' }).then(function (parent) {
      return parent.name === FOLDER ? parent : parent.getDirectoryHandle(FOLDER, { create: true });
    }).then(function (d) { dirHandle = d; idbSet('dir', d); updateFolderUi(); return d; });
  }
  function getFolder() {
    return (dirHandle ? Promise.resolve(dirHandle) : idbGet('dir')).then(function (h) {
      if (!h) return pickFolder();
      return permitted(h).then(function (ok) { if (ok) { dirHandle = h; return h; } return pickFolder(); });
    });
  }
  function updateFolderUi() {
    if (!canPickFolder) {
      $('folderText').textContent = 'Download (browser ini tidak bisa memilih folder)';
      $('btnFolder').hidden = true;
      $('folderHint').textContent = 'Di browser ini foto masuk ke folder Download dengan nama AmajingTimestamp_…jpg. Untuk langsung ke folder Amajing Timestamp, pakai Chrome versi terbaru.';
      return;
    }
    $('folderText').textContent = dirHandle ? '…/' + FOLDER : 'Belum dipilih';
    $('btnFolder').textContent = dirHandle ? 'Ganti' : 'Pilih folder';
  }
  function download(url, name) {
    var a = document.createElement('a'); a.href = url || lastUrl; a.download = name || fileName();
    document.body.appendChild(a); a.click(); a.remove();
  }
  // Antrean simpan: foto cepat beruntun disimpan satu per satu (pemilih folder tidak muncul dobel)
  var saveQueue = Promise.resolve();
  function savePhoto(auto) {
    if (!lastBlob) return Promise.resolve();
    var blob = lastBlob, name = fileName(), url = lastUrl;
    var say = function (m) { if (auto === true) camToast(m); else toast(m); };
    saveQueue = saveQueue.then(function () {
      if (!canPickFolder) { download(url, name); say('✓ Tersimpan di folder Download'); return; }
      return getFolder().then(function (dir) {
        return dir.getFileHandle(name, { create: true });
      }).then(function (fh) { return fh.createWritable(); }).then(function (w) {
        return w.write(blob).then(function () { return w.close(); });
      }).then(function () {
        say('✓ Tersimpan di folder ' + FOLDER);
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return say('Belum tersimpan — pilih folder dulu, atau tekan foto kecil → Simpan.');
        download(url, name); say('Folder tidak bisa dipakai — foto disimpan ke Download.');
      });
    });
    return saveQueue;
  }

  function share() {
    if (!lastBlob) return;
    var file = new File([lastBlob], fileName(), { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: reportText() }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        navigator.share({ files: [file] }).catch(function () {});
      });
    } else {
      savePhoto().then(function () { toast('Browser ini belum bisa langsung kirim. Foto sudah disimpan — kirim dari galeri.'); });
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
  function toast(msg) { var el = $('toast'); el.textContent = msg; clearTimeout(toastT); if (msg) toastT = setTimeout(function () { el.textContent = ''; }, 4500); }

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
    document.querySelector('.gps-only').classList.toggle('off', !S.gps);
    $('levelHint').textContent = LEVEL_HINT[S.level] || '';
  }

  bindText('sName', 'name'); bindText('sPlace', 'place'); bindText('sNote', 'note');
  bindCheck('sDay', 'day'); bindCheck('sSec', 'sec');
  bindCheck('sGps', 'gps', function () { syncGpsUi(); if (S.gps) startGps(); else stopGps(); });
  bindCheck('sCoords', 'coords'); bindCheck('sMap', 'map', maybeMap);
  bindCheck('sMirror', 'mirror'); bindCheck('sMark', 'mark'); bindCheck('sAuto', 'auto');
  idbGet('last').then(function (v) {
    if (v && v.blob && !lastBlob) setLast(v.blob, new Date(v.time), v.data || null, false);
  });
  bindSeg('sLevel', 'level', function () { syncGpsUi(); updateChip(); });
  bindSeg('sPos', 'pos'); bindSeg('sBg', 'bg'); bindSeg('sAccent', 'accent');
  var size = $('sSize'); size.value = S.size; $('sizeVal').textContent = S.size + '%';
  size.addEventListener('input', function () { S.size = +size.value; $('sizeVal').textContent = S.size + '%'; save(); });
  syncGpsUi();
  if (canPickFolder) idbGet('dir').then(function (h) { if (h) dirHandle = h; updateFolderUi(); }); else updateFolderUi();
  $('btnFolder').addEventListener('click', function () {
    pickFolder().then(function () { toast(''); }).catch(function () {});
  });

  function openSheet(on) { $('sheetBg').hidden = !on; }
  $('btnSettings').addEventListener('click', function () { openSheet(true); });
  $('gpsChip').addEventListener('click', function () { openSheet(true); });
  $('btnClose').addEventListener('click', function () { openSheet(false); });
  $('sheetBg').addEventListener('click', function (e) { if (e.target === $('sheetBg')) openSheet(false); });

  // ---------- Tombol utama ----------
  $('btnStart').addEventListener('click', function () {
    $('startErr').hidden = true;
    enableMotion();
    startCamera().catch(cameraError);
    startGps();
  });
  $('btnShutter').addEventListener('click', capture);
  $('btnFlip').addEventListener('click', function () {
    enableMotion();
    facing = facing === 'user' ? 'environment' : 'user';
    startCamera().catch(cameraError);
  });
  $('btnLast').addEventListener('click', function () { showResult(true); });
  $('btnRetake').addEventListener('click', function () { showResult(false); });
  $('btnSave').addEventListener('click', function () { savePhoto(false); });
  $('btnShare').addEventListener('click', share);
  $('btnCopy').addEventListener('click', copyReport);
  document.addEventListener('click', enableMotion, { once: true });
  document.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && $('result').hidden && $('sheetBg').hidden && $('start').hidden && e.target === document.body) { e.preventDefault(); capture(); }
    if (e.key === 'Escape') { openSheet(false); showResult(false); $('helpBg').hidden = true; }
  });

  // Kamera dimatikan saat aplikasi di latar belakang (hemat baterai), hidup lagi saat kembali.
  document.addEventListener('visibilitychange', function () {
    if (!running) return;
    if (document.hidden) { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    else startCamera().catch(cameraError);
  });

  // Mulai otomatis bila izin kamera sudah pernah diberikan
  document.body.classList.add('start-open');
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then(function (p) {
      if (p.state === 'granted') { enableMotion(); startCamera().catch(cameraError); startGps(); }
    }).catch(function () {});
  }
  updateChip(); applyRot();
  if (!isIOS) enableMotion();   // Android: sensor langsung aktif tanpa izin

  // ---------- Pasang sebagai aplikasi ----------
  var installEvt = null;
  var standalone = function () {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  };
  function syncInstall() {
    var show = !standalone();
    $('btnInstall').hidden = !show; $('btnInstallTop').hidden = !show;
    var dismissed = false; try { dismissed = sessionStorage.getItem('ib-x') === '1'; } catch (e) {}
    $('installBar').hidden = !show || dismissed;
  }
  function install() {
    if (installEvt) {
      installEvt.prompt();
      installEvt.userChoice.then(function () { installEvt = null; syncInstall(); });
      return;
    }
    $('helpIos').hidden = !isIOS; $('helpAndroid').hidden = isIOS;
    $('helpBg').hidden = false;
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; syncInstall(); });
  window.addEventListener('appinstalled', function () { installEvt = null; $('installBar').hidden = true; $('btnInstall').hidden = true; $('btnInstallTop').hidden = true; });
  $('btnInstall').addEventListener('click', install);
  $('btnInstallTop').addEventListener('click', install);
  $('btnInstallBar').addEventListener('click', install);
  $('btnInstallX').addEventListener('click', function () {
    $('installBar').hidden = true; try { sessionStorage.setItem('ib-x', '1'); } catch (e) {}
  });
  $('btnHelpClose').addEventListener('click', function () { $('helpBg').hidden = true; });
  $('helpBg').addEventListener('click', function (e) { if (e.target === $('helpBg')) $('helpBg').hidden = true; });
  syncInstall();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
