/* Embroidery builder (storefront). Vanilla JS, no dependencies.
   Steps: apron + location, upload, place + size, colors, price, review + submit. */
(function () {
  "use strict";

  var DEFAULT_PRICING = {
    minimum: 50,
    tiers: [
      { min: 50, price: 8.95 },
      { min: 72, price: 7.95 },
      { min: 144, price: 6.95 },
      { min: 300, price: 5.95 }
    ],
    includedStitches: 6000,
    perThousandStitches: 1,
    includedColors: 4,
    perExtraColor: 1,
    setupFee: 35
  };
  var DEFAULT_EST = {
    fillPerSqIn: 1800, satinPerSqIn: 1100, runPerIn: 12, perColor: 60, base: 150,
    satinMaxWidthIn: 0.25, uncertainty: 0.2
  };
  var STEPS = ["Apron & spot", "Upload", "Place & size", "Colors", "Price", "Checkout"];
  var PREVIEW_TYPES = /^image\/(png|jpe?g|svg\+xml|webp|gif)$/i;
  var MAX_FILE = 20 * 1024 * 1024;
  var PROC_MAX = 700;

  function money(n) { return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function round100(n) { return Math.round(n / 100) * 100; }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hexToRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    return "#" + c.map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("").toUpperCase();
  }
  function lum(c) {
    var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function d2(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function merge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    if (over && typeof over === "object") Object.keys(over).forEach(function (k) { out[k] = over[k]; });
    return out;
  }

  /* ---------- logo analysis ---------- */

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Could not read that image.")); };
      img.src = src;
    });
  }

  // Remove a plain background by flood-filling from the edges.
  // Returns null when there is no plain background, else { enclosed: pixels of background color inside the logo }.
  function removeBackground(data, w, h, keepEnclosed) {
    var px = data.data, n = w * h, i, transparent = 0;
    for (i = 0; i < n; i++) if (px[i * 4 + 3] < 250) transparent++;
    if (transparent > n * 0.01) return null; // already has transparency

    var border = [], x, y;
    for (x = 0; x < w; x++) { border.push(x); border.push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { border.push(y * w); border.push(y * w + w - 1); }
    // Background = the median edge color, if most of the edge matches it.
    function med(ch) {
      var v = border.map(function (p) { return px[p * 4 + ch]; }).sort(function (a, b) { return a - b; });
      return v[v.length >> 1];
    }
    var avg = [med(0), med(1), med(2)], TH = 45 * 45;
    var bgEdge = border.filter(function (p) { return d2([px[p * 4], px[p * 4 + 1], px[p * 4 + 2]], avg) <= TH; });
    if (bgEdge.length < border.length * 0.8) return null; // edges are not one plain color

    var seen = new Uint8Array(n), stack = bgEdge;
    while (stack.length) {
      var p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      var o = p * 4;
      if (d2([px[o], px[o + 1], px[o + 2]], avg) > TH) continue;
      px[o + 3] = 0;
      var px_ = p % w, py_ = (p / w) | 0;
      if (px_ > 0) stack.push(p - 1);
      if (px_ < w - 1) stack.push(p + 1);
      if (py_ > 0) stack.push(p - w);
      if (py_ < h - 1) stack.push(p + w);
    }
    // Background-colored areas enclosed by the logo (inside letters, rings). Removed unless kept.
    var enclosed = 0;
    for (i = 0; i < n; i++) {
      var q = i * 4;
      if (px[q + 3] && d2([px[q], px[q + 1], px[q + 2]], avg) <= TH) { enclosed++; if (!keepEnclosed) px[q + 3] = 0; }
    }
    // Soft edges: fade pixels next to the removed background by how close they are to it.
    var MATTE = 120, fade = [];
    for (i = 0; i < n; i++) {
      var a = i * 4; if (!px[a + 3]) continue;
      var xx = i % w, yy = (i / w) | 0, nearBg = false;
      for (var dy = -1; dy <= 1 && !nearBg; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = xx + dx, ny = yy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!px[(ny * w + nx) * 4 + 3]) { nearBg = true; break; }
      }
      if (!nearBg) continue;
      var dd = Math.sqrt(d2([px[a], px[a + 1], px[a + 2]], avg));
      if (dd < MATTE) fade.push([a, Math.round(255 * dd / MATTE)]);
    }
    fade.forEach(function (f) { px[f[0] + 3] = Math.min(px[f[0] + 3], f[1]); });
    return { enclosed: enclosed, bg: avg };
  }

  // Reduce the logo to a handful of flat colors (k-means, then merge near-duplicates).
  function quantize(data, w, h) {
    var px = data.data, n = w * h, i, samples = [], opaque = 0;
    for (i = 0; i < n; i++) if (px[i * 4 + 3] >= 128) opaque++;
    function solid(j) { return j >= 0 && j < n && px[j * 4 + 3] >= 250; }
    var interior = [];
    for (i = 0; i < n; i++) {
      if (px[i * 4 + 3] < 250) continue;
      var xi = i % w;
      if (xi > 0 && xi < w - 1 && solid(i - 1) && solid(i + 1) && solid(i - w) && solid(i + w)) interior.push(i);
    }
    if (interior.length < 200) { interior = []; for (i = 0; i < n; i++) if (px[i * 4 + 3] >= 128) interior.push(i); }
    var step = Math.max(1, Math.floor(interior.length / 20000));
    for (var si = 0; si < interior.length; si += step) {
      var o2 = interior[si] * 4; samples.push([px[o2], px[o2 + 1], px[o2 + 2]]);
    }
    if (!samples.length) return { palette: [], labels: new Uint8Array(n).fill(255), opaque: 0 };

    var K = Math.min(8, samples.length), cents = [samples[0].slice()];
    while (cents.length < K) { // farthest-point init (deterministic)
      var best = 0, bi = 0;
      for (i = 0; i < samples.length; i++) {
        var m = Infinity;
        for (var c = 0; c < cents.length; c++) m = Math.min(m, d2(samples[i], cents[c]));
        if (m > best) { best = m; bi = i; }
      }
      if (best === 0) break;
      cents.push(samples[bi].slice());
    }
    for (var it = 0; it < 12; it++) {
      var sums = cents.map(function () { return [0, 0, 0, 0]; });
      samples.forEach(function (s) {
        var bc = 0, bd = Infinity;
        for (var c2 = 0; c2 < cents.length; c2++) { var dd = d2(s, cents[c2]); if (dd < bd) { bd = dd; bc = c2; } }
        sums[bc][0] += s[0]; sums[bc][1] += s[1]; sums[bc][2] += s[2]; sums[bc][3]++;
      });
      cents = sums.map(function (s, j) { return s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3], s[3]] : [cents[j][0], cents[j][1], cents[j][2], 0]; });
    }
    // merge close colors, drop tiny ones
    var MERGE = 40 * 40, total = samples.length;
    cents.sort(function (a, b) { return b[3] - a[3]; });
    var keep = [];
    cents.forEach(function (c3) {
      if (!c3[3]) return;
      for (var j = 0; j < keep.length; j++) {
        if (d2(c3, keep[j]) < MERGE) {
          var t = keep[j][3] + c3[3];
          keep[j] = [(keep[j][0] * keep[j][3] + c3[0] * c3[3]) / t, (keep[j][1] * keep[j][3] + c3[1] * c3[3]) / t, (keep[j][2] * keep[j][3] + c3[2] * c3[3]) / t, t];
          return;
        }
      }
      keep.push(c3.slice());
    });
    keep = keep.filter(function (c4) { return c4[3] / total >= 0.015; });
    if (!keep.length) keep = [cents[0]];

    var labels = new Uint8Array(n).fill(255), counts = keep.map(function () { return 0; });
    for (i = 0; i < n; i++) {
      if (px[i * 4 + 3] < 128) continue;
      var rgb = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]], bl = 0, bd2 = Infinity;
      for (var q = 0; q < keep.length; q++) { var d3 = d2(rgb, keep[q]); if (d3 < bd2) { bd2 = d3; bl = q; } }
      labels[i] = bl; counts[bl]++;
    }
    var palette = keep.map(function (c5, j) {
      var hex = rgbToHex([c5[0], c5[1], c5[2]]);
      return { detected: hex, hex: hex, pantone: "", count: counts[j] };
    });
    return { palette: palette, labels: labels, opaque: opaque };
  }

  // Chamfer distance (in pixels) from each pixel to the nearest pixel where src is 0.
  function distanceTransform(mask, w, h) {
    var INF = 1e9, d = new Float32Array(w * h), x, y, i, A = 1, B = 1.4142;
    for (i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (!d[i]) continue;
      var v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[i - w] + A);
        if (x > 0) v = Math.min(v, d[i - w - 1] + B);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
      }
      d[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x; if (!d[i]) continue;
      var u = d[i];
      if (x < w - 1) u = Math.min(u, d[i + 1] + A);
      if (y < h - 1) {
        u = Math.min(u, d[i + w] + A);
        if (x < w - 1) u = Math.min(u, d[i + w + 1] + B);
        if (x > 0) u = Math.min(u, d[i + w - 1] + B);
      }
      d[i] = u;
    }
    return d;
  }

  function analyzeLogo(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      loadImage(url).then(function (img) {
        var nw = img.naturalWidth || 800, nh = img.naturalHeight || 800;
        var scale = Math.min(1, PROC_MAX / Math.max(nw, nh));
        if (/svg/i.test(file.type)) scale = PROC_MAX / Math.max(nw, nh); // vectors: render at full working size
        var w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(img, 0, 0, w, h);
        var data = cx.getImageData(0, 0, w, h);
        var thumbKept = cv.toDataURL("image/png");
        // Find a plain background on a copy, so the customer can choose to remove it or keep it.
        var probe = new ImageData(new Uint8ClampedArray(data.data), w, h);
        var bgInfo = removeBackground(probe, w, h, !!opts.keepEnclosed);
        var thumbRemoved = null;
        if (bgInfo) { cx.putImageData(probe, 0, 0); thumbRemoved = cv.toDataURL("image/png"); }
        var keepBg = !!(opts.keepBackground && bgInfo);
        if (bgInfo && !keepBg) data = probe;
        var q = quantize(data, w, h);
        if (!q.opaque) { URL.revokeObjectURL(url); reject(new Error("That image looks empty after removing the background.")); return; }

        // trim to content
        var minX = w, minY = h, maxX = -1, maxY = -1, x, y;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (q.labels[y * w + x] !== 255) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        var tw = maxX - minX + 1, th = maxY - minY + 1;
        var labels = new Uint8Array(tw * th), alpha = new Uint8ClampedArray(tw * th), mask = new Uint8Array(tw * th), edges = 0;
        for (y = 0; y < th; y++) for (x = 0; x < tw; x++) {
          var si = (y + minY) * w + (x + minX), di = y * tw + x;
          labels[di] = q.labels[si];
          alpha[di] = q.labels[si] === 255 ? 0 : data.data[si * 4 + 3];
          mask[di] = q.labels[si] === 255 ? 0 : 1;
        }
        for (y = 0; y < th; y++) for (x = 0; x < tw; x++) {
          var ii = y * tw + x; if (!mask[ii]) continue;
          if (x === 0 || y === 0 || x === tw - 1 || y === th - 1 || !mask[ii - 1] || !mask[ii + 1] || !mask[ii - tw] || !mask[ii + tw]) edges++;
        }
        var dist = distanceTransform(mask, tw, th);
        cx.putImageData(data, 0, 0);
        var thumb = cv.toDataURL("image/png");
        URL.revokeObjectURL(url);
        resolve({
          file: file, w: tw, h: th, labels: labels, alpha: alpha, mask: mask, dist: dist, edges: edges,
          opaque: q.opaque, palette: q.palette, bgDetected: !!bgInfo, bgRemoved: !!bgInfo && !keepBg, bgKept: keepBg,
          bg: bgInfo && bgInfo.bg, enclosed: bgInfo && !keepBg ? bgInfo.enclosed : 0, keepEnclosed: !!opts.keepEnclosed,
          thumb: thumb, thumbKept: thumbKept, thumbRemoved: thumbRemoved,
          naturalW: nw, naturalH: nh, lowRes: !/svg/i.test(file.type) && Math.max(nw, nh) < 500
        });
      }).catch(function (e) { URL.revokeObjectURL(url); reject(e); });
    });
  }

  // Recolor the logo with the current palette and add a faint thread texture.
  function renderLogo(logo, plain) {
    var cv = document.createElement("canvas"); cv.width = logo.w; cv.height = logo.h;
    var cx = cv.getContext("2d"), img = cx.createImageData(logo.w, logo.h), p = img.data;
    var cols = logo.palette.map(function (c) { return hexToRgb(c.hex) || hexToRgb(c.detected); });
    for (var i = 0; i < logo.labels.length; i++) {
      var l = logo.labels[i]; if (l === 255) continue;
      var c = cols[l], o = i * 4;
      p[o] = c[0]; p[o + 1] = c[1]; p[o + 2] = c[2]; p[o + 3] = logo.alpha[i];
    }
    cx.putImageData(img, 0, 0);
    if (plain) return cv; // flat colors only: the artwork file sent with the design
    cx.globalCompositeOperation = "source-atop";
    cx.lineWidth = Math.max(1, logo.w / 300);
    cx.strokeStyle = "rgba(255,255,255,0.10)";
    var gap = Math.max(3, logo.w / 120);
    for (var s = -logo.h; s < logo.w; s += gap) { cx.beginPath(); cx.moveTo(s, 0); cx.lineTo(s + logo.h, logo.h); cx.stroke(); }
    cx.strokeStyle = "rgba(0,0,0,0.10)";
    for (s = -logo.h + gap / 2; s < logo.w; s += gap) { cx.beginPath(); cx.moveTo(s, 0); cx.lineTo(s + logo.h, logo.h); cx.stroke(); }
    return cv;
  }

  /* ---------- estimate + price ---------- */

  function estimateStitches(logo, widthIn, est) {
    var ppi = logo.w / widthIn, ppi2 = ppi * ppi, r = (est.satinMaxWidthIn / 2) * ppi, n = logo.w * logo.h, i;
    var notCore = new Uint8Array(n), hasCore = false;
    for (i = 0; i < n; i++) { var core = logo.mask[i] && logo.dist[i] > r; notCore[i] = core ? 0 : 1; if (core) hasCore = true; }
    var fillPx = 0, satinPx = 0;
    if (hasCore) {
      var toCore = distanceTransform(notCore, logo.w, logo.h);
      for (i = 0; i < n; i++) if (logo.mask[i]) { if (toCore[i] <= r + 1) fillPx++; else satinPx++; }
    } else satinPx = logo.opaque ? countMask(logo.mask) : 0;
    var fillIn = fillPx / ppi2, satinIn = satinPx / ppi2, edgeIn = logo.edges / ppi;
    var colors = logo.palette.length;
    var total = est.base + fillIn * est.fillPerSqIn + satinIn * est.satinPerSqIn + edgeIn * est.runPerIn + colors * est.perColor;
    return { stitches: total, low: total * (1 - est.uncertainty), high: total * (1 + est.uncertainty), fillSqIn: fillIn, satinSqIn: satinIn, outlineIn: edgeIn };
  }
  function countMask(m) { var c = 0; for (var i = 0; i < m.length; i++) c += m[i]; return c; }

  function price(pr, qty, stitches, colors) {
    var tiers = (pr.tiers || []).slice().sort(function (a, b) { return a.min - b.min; });
    var tier = tiers[0] || { min: 0, price: 0 };
    tiers.forEach(function (t) { if (qty >= t.min) tier = t; });
    var extraK = Math.max(0, Math.ceil((stitches - pr.includedStitches) / 1000));
    var extraColors = Math.max(0, colors - pr.includedColors);
    var perApron = tier.price + extraK * pr.perThousandStitches + extraColors * pr.perExtraColor;
    return {
      tier: tier, extraK: extraK, extraColors: extraColors, perApron: perApron,
      embroidery: qty * tier.price, stitchCharge: qty * extraK * pr.perThousandStitches,
      colorCharge: qty * extraColors * pr.perExtraColor, setup: pr.setupFee,
      total: perApron * qty + pr.setupFee, belowMin: qty < pr.minimum
    };
  }

  /* ---------- builder UI ---------- */

  // Locations from a location template: boxes are fractions of the photo, and the template knows
  // how many inches wide the whole photo is, so each box's real width is w × photoWidthIn.
  function templateZones(t) {
    if (!t || typeof t !== "object") return null;
    var pw = parseFloat(t.photoWidthIn), zones = t.zones;
    if (typeof zones === "string") { try { zones = JSON.parse(zones); } catch (e) { zones = null; } }
    if (!(pw > 0) || !Array.isArray(zones) || !zones.length) return null;
    return zones.map(function (z) {
      return { id: z.id, label: z.label, x: +z.x, y: +z.y, w: +z.w, h: +z.h, widthIn: +z.w * pw, maxW: +z.maxW || 0, maxH: +z.maxH || 0, minW: +z.minW || 0 };
    });
  }

  function Builder(cfg) {
    this.cfg = cfg;
    this.pricing = merge(DEFAULT_PRICING, cfg.pricing);
    this.est = merge(DEFAULT_EST, cfg.estimator);
    var vendor = String((cfg.product && cfg.product.vendor) || "");
    this.zones = templateZones(cfg.template) || (Array.isArray(cfg.zones) ? cfg.zones : []).filter(function (z) {
      return !z.daystarOnly || /daystar/i.test(vendor);
    });
    var vs = cfg.variants || [];
    this.variant = vs.filter(function (v) { return v.id === cfg.selectedVariantId; })[0] || vs[0];
    this.zone = this.zones[0];
    this.step = 0;
    this.logo = null;
    this.logoCanvas = null;
    this.place = {};
    this.qty = Math.max(this.pricing.minimum || 1, 72);
    this.contact = { name: "", email: "", phone: "", company: "", notes: "" };
    this.rights = false;
    this.error = "";
    this.drag = null;
    this.images = {};
  }

  Builder.prototype.open = function () {
    var self = this;
    this.prevFocus = document.activeElement;
    this.modal = el("div", { class: "emb-modal", role: "dialog", "aria-modal": "true", "aria-label": "Customize with your logo" });
    this.modal.innerHTML =
      '<div class="emb-dialog">' +
      '<div class="emb-head"><h2>' + esc(this.cfg.product ? this.cfg.product.title : "Customize") + '</h2>' +
      '<button type="button" class="emb-close" aria-label="Close">&times;</button></div>' +
      '<nav class="emb-steps" aria-label="Steps"></nav>' +
      '<div class="emb-body"><div class="emb-stage"><canvas aria-label="Apron preview"></canvas></div><div class="emb-panel" aria-live="polite"></div></div>' +
      '<div class="emb-foot"><button type="button" class="emb-btn" data-back>Back</button><button type="button" class="emb-btn" data-next>Next</button></div>' +
      '</div>';
    document.body.appendChild(this.modal);
    this.bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    this.canvas = this.modal.querySelector("canvas");
    this.panel = this.modal.querySelector(".emb-panel");
    this.nav = this.modal.querySelector(".emb-steps");
    this.modal.querySelector(".emb-close").addEventListener("click", function () { self.close(); });
    this.modal.addEventListener("click", function (e) { if (e.target === self.modal) self.close(); });
    this.onKey = function (e) { if (e.key === "Escape") self.close(); };
    document.addEventListener("keydown", this.onKey);
    this.modal.querySelector("[data-back]").addEventListener("click", function () { self.go(self.step - 1); });
    this.modal.querySelector("[data-next]").addEventListener("click", function () { self.go(self.step + 1); });
    this.onResize = function () { self.draw(); };
    window.addEventListener("resize", this.onResize);
    this.bindPointer();
    this.loadVariantImage().then(function () { self.render(); });
    this.loadConfig();
    this.render();
    this.modal.querySelector(".emb-close").focus();
  };

  Builder.prototype.close = function () {
    if (!this.modal) return;
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.onResize);
    this.modal.remove();
    this.modal = null;
    document.body.style.overflow = this.bodyOverflow || "";
    if (this.prevFocus && this.prevFocus.focus) this.prevFocus.focus();
  };

  // Pricing and estimator constants come from the app server so checkout always matches.
  Builder.prototype.loadConfig = function () {
    var self = this;
    if (!this.cfg.proxyPath) return;
    fetch(this.cfg.proxyPath + "/config", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !self.modal) return;
        if (j.pricing) self.pricing = merge(DEFAULT_PRICING, j.pricing);
        if (j.estimator) { self.est = merge(DEFAULT_EST, j.estimator); self.estKey = null; }
        self.qty = Math.max(self.qty, self.pricing.minimum || 1);
        self.render();
      })
      .catch(function () { /* keep defaults */ });
  };

  Builder.prototype.loadVariantImage = function () {
    var self = this, src = this.variant && this.variant.image;
    if (!src) return Promise.resolve();
    if (this.images[src]) { this.productImg = this.images[src]; return Promise.resolve(); }
    var img = new Image();
    img.crossOrigin = "anonymous"; // Shopify CDN sends CORS headers, so the mockup can be exported
    return new Promise(function (resolve) {
      img.onload = function () { self.images[src] = img; self.productImg = img; resolve(); };
      img.onerror = function () { resolve(); };
      img.src = src;
    });
  };

  Builder.prototype.canGo = function (i) {
    if (i <= 1) return true;
    return !!this.logo;
  };

  Builder.prototype.go = function (i) {
    if (i < 0 || i >= STEPS.length || !this.canGo(i)) return;
    this.step = i;
    this.error = "";
    this.render();
    this.panel.scrollTop = 0;
  };

  /* geometry, in canvas pixels and inches */
  Builder.prototype.layout = function () {
    var img = this.productImg, cv = this.canvas;
    var stage = cv.parentNode, maxW = Math.max(240, stage.clientWidth - 32), maxH = Math.max(320, Math.min(window.innerHeight * 0.72, 900));
    var iw = img ? img.naturalWidth : 1000, ih = img ? img.naturalHeight : 1200;
    var s = Math.min(maxW / iw, maxH / ih);
    return { cssW: Math.round(iw * s), cssH: Math.round(ih * s), iw: iw, ih: ih };
  };
  Builder.prototype.zoneRect = function (z, W, H) {
    return { x: z.x * W, y: z.y * H, w: z.w * W, h: z.h * H };
  };
  Builder.prototype.zoneInches = function (z) {
    var iw = this.productImg ? this.productImg.naturalWidth : 1000, ih = this.productImg ? this.productImg.naturalHeight : 1200;
    var wIn = z.widthIn, hIn = (z.h * ih) / (z.w * iw) * z.widthIn;
    return { w: wIn, h: hIn };
  };
  Builder.prototype.maxLogoWidth = function (z) {
    var a = this.logo.h / this.logo.w, zi = this.zoneInches(z);
    var maxW = Math.min(z.maxW || zi.w, zi.w), maxH = Math.min(z.maxH || zi.h, zi.h);
    return Math.max(0.5, Math.min(maxW, maxH / a));
  };
  Builder.prototype.getPlace = function () {
    var z = this.zone;
    if (!this.logo || !z) return null;
    var p = this.place[z.id], zi = this.zoneInches(z), maxW = this.maxLogoWidth(z);
    if (!p) { var w0 = Math.min(maxW, maxW * 0.8); p = this.place[z.id] = { cx: zi.w / 2, cy: zi.h / 2, w: w0 }; }
    var minW = Math.min(maxW, Math.max(0.5, z.minW || 0));
    p.w = clamp(p.w, minW, maxW);
    var h = p.w * this.logo.h / this.logo.w;
    p.cx = clamp(p.cx, p.w / 2, zi.w - p.w / 2);
    p.cy = clamp(p.cy, h / 2, zi.h - h / 2);
    return { cx: p.cx, cy: p.cy, w: p.w, h: h, maxW: maxW, minW: minW, zi: zi };
  };

  Builder.prototype.draw = function (target) {
    var exporting = !!target;
    var cv = target || this.canvas;
    if (!cv) return;
    var L = this.layout(), dpr = exporting ? 1 : (window.devicePixelRatio || 1);
    var W = exporting ? cv.width : L.cssW, H = exporting ? cv.height : L.cssH;
    if (!exporting) {
      cv.style.width = W + "px"; cv.style.height = H + "px";
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    var cx = cv.getContext("2d");
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    if (this.productImg) cx.drawImage(this.productImg, 0, 0, W, H);
    else { cx.fillStyle = "#3A4049"; cx.fillRect(0, 0, W, H); }

    var self = this;
    if (!exporting) {
      this.zones.forEach(function (z) {
        var r = self.zoneRect(z, W, H), active = z === self.zone;
        cx.save();
        cx.setLineDash([8, 6]);
        cx.lineWidth = active ? 2.5 : 1.5;
        cx.strokeStyle = active ? "#E07A5F" : "rgba(255,255,255,0.55)";
        if (active && !self.logo) { cx.fillStyle = "rgba(224,122,95,0.18)"; cx.fillRect(r.x, r.y, r.w, r.h); }
        cx.strokeRect(r.x, r.y, r.w, r.h);
        cx.restore();
      });
    }

    var pl = this.getPlace();
    if (pl && this.logoCanvas) {
      var r2 = this.zoneRect(this.zone, W, H), ppi = r2.w / pl.zi.w;
      var bw = pl.w * ppi, bh = pl.h * ppi, bx = r2.x + pl.cx * ppi - bw / 2, by = r2.y + pl.cy * ppi - bh / 2;
      cx.save();
      cx.shadowColor = "rgba(0,0,0,0.25)"; cx.shadowBlur = exporting ? 2 : 1.5; cx.shadowOffsetY = 0.5;
      cx.drawImage(this.logoCanvas, bx, by, bw, bh);
      cx.restore();
      this.logoBox = { x: bx, y: by, w: bw, h: bh, ppi: ppi, zone: r2 };
      if (!exporting && this.step === 2) {
        cx.save();
        cx.strokeStyle = "#FFFDF8"; cx.lineWidth = 1; cx.setLineDash([]);
        cx.strokeRect(bx, by, bw, bh);
        [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].forEach(function (c) {
          cx.fillStyle = "#FFFDF8"; cx.strokeStyle = "#E07A5F"; cx.lineWidth = 2;
          cx.fillRect(c[0] - 6, c[1] - 6, 12, 12); cx.strokeRect(c[0] - 6, c[1] - 6, 12, 12);
        });
        cx.restore();
      }
    }
  };

  Builder.prototype.bindPointer = function () {
    var self = this, cv = this.canvas;
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener("pointerdown", function (e) {
      if (!self.logoBox || !self.logo) return;
      if (self.step !== 2) { if (self.step > 1) self.go(2); return; }
      var p = pos(e), b = self.logoBox, pl = self.getPlace();
      var corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
      var onCorner = corners.some(function (c) { return Math.abs(p.x - c[0]) < 14 && Math.abs(p.y - c[1]) < 14; });
      var inside = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      if (!onCorner && !inside) return;
      cv.setPointerCapture(e.pointerId);
      self.drag = { mode: onCorner ? "resize" : "move", start: p, cx: pl.cx, cy: pl.cy, w: pl.w, ppi: b.ppi, center: { x: b.x + b.w / 2, y: b.y + b.h / 2 } };
      e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      var p = pos(e), d = self.drag;
      if (!d) {
        if (self.step === 2 && self.logoBox) {
          var b = self.logoBox;
          cv.style.cursor = (p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) ? "move" : "default";
        }
        return;
      }
      var place = self.place[self.zone.id];
      if (d.mode === "move") {
        place.cx = d.cx + (p.x - d.start.x) / d.ppi;
        place.cy = d.cy + (p.y - d.start.y) / d.ppi;
      } else {
        var aspect = self.logo.h / self.logo.w;
        var halfW = Math.abs(p.x - d.center.x), halfH = Math.abs(p.y - d.center.y) / aspect;
        place.w = (Math.max(halfW, halfH) * 2) / d.ppi;
      }
      self.scheduleUpdate();
    });
    function end() { if (self.drag) { self.drag = null; self.render(); } }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  };

  Builder.prototype.scheduleUpdate = function () {
    var self = this;
    if (this.raf) return;
    this.raf = requestAnimationFrame(function () {
      self.raf = 0;
      self.draw();
      var s = self.panel.querySelector("[data-size]"), r = self.panel.querySelector("[data-range]");
      var pl = self.getPlace();
      if (s && pl) s.textContent = pl.w.toFixed(1) + "″ × " + pl.h.toFixed(1) + "″";
      if (r && pl && document.activeElement !== r) r.value = String(pl.w);
      self.updateEstimateLine();
    });
  };

  Builder.prototype.currentEstimate = function () {
    var pl = this.getPlace();
    if (!pl) return null;
    var key = this.zone.id + ":" + pl.w.toFixed(2) + ":" + this.logo.palette.length;
    if (this.estKey !== key) { this.estKey = key; this.estVal = estimateStitches(this.logo, pl.w, this.est); }
    return this.estVal;
  };

  Builder.prototype.updateEstimateLine = function () {
    var n = this.panel.querySelector("[data-est-line]"), e = this.currentEstimate();
    if (n && e) n.innerHTML = this.estimateSummary(e);
  };

  Builder.prototype.estimateSummary = function (e) {
    var inc = this.pricing.includedStitches;
    if (e.high <= inc) return "About " + fmtInt(round100(e.stitches)) + " stitches: within the " + fmtInt(inc) + " included.";
    if (e.low > inc) {
      var k = Math.ceil((e.stitches - inc) / 1000);
      return "About " + fmtInt(round100(e.stitches)) + " stitches: roughly +" + money(k * this.pricing.perThousandStitches) + " per apron.";
    }
    return "About " + fmtInt(round100(e.stitches)) + " stitches: close to the " + fmtInt(inc) + " included. The proof confirms it.";
  };

  Builder.prototype.render = function () {
    if (!this.modal) return;
    var self = this;
    this.nav.innerHTML = "";
    STEPS.forEach(function (name, i) {
      var b = el("button", { type: "button", class: "emb-step" }, (i + 1) + ". " + esc(name));
      if (i === self.step) b.setAttribute("aria-current", "step");
      if (!self.canGo(i)) b.disabled = true;
      b.addEventListener("click", function () { self.go(i); });
      self.nav.appendChild(b);
    });
    var back = this.modal.querySelector("[data-back]"), next = this.modal.querySelector("[data-next]");
    back.style.visibility = this.step === 0 ? "hidden" : "visible";
    next.style.visibility = this.step >= STEPS.length - 1 ? "hidden" : "visible";
    next.disabled = !this.canGo(this.step + 1);
    next.textContent = this.step === 1 && !this.logo ? "Upload a logo to continue" : "Next";
    next.className = this.canGo(this.step + 1) ? "emb-primary" : "emb-btn";
    next.style.width = "auto";

    this.panel.innerHTML = "";
    [this.stepApron, this.stepUpload, this.stepPlace, this.stepColors, this.stepPrice, this.stepSubmit][this.step].call(this, this.panel);
    if (this.error) this.panel.insertBefore(el("p", { class: "emb-warn", role: "alert" }, esc(this.error)), this.panel.firstChild);
    this.draw();
  };

  Builder.prototype.stepApron = function (p) {
    var self = this, vs = this.cfg.variants || [];
    p.appendChild(el("h3", null, "Choose apron color and location"));
    var distinct = {};
    vs.forEach(function (v) { distinct[v.image] = 1; });
    if (vs.length > 1 && Object.keys(distinct).length < vs.length) {
      // Colors share one embroidery photo: choose by name.
      p.appendChild(el("p", { class: "emb-label" }, "Color"));
      var vc = el("div", { class: "emb-chips" });
      vs.forEach(function (v) {
        var b = el("button", { type: "button", class: "emb-chip", "aria-pressed": String(v === self.variant) }, esc(v.title));
        if (v.available === false) b.disabled = true;
        b.addEventListener("click", function () { self.variant = v; self.loadVariantImage().then(function () { self.render(); }); });
        vc.appendChild(b);
      });
      p.appendChild(vc);
    } else if (vs.length > 1) {
      p.appendChild(el("p", { class: "emb-label" }, "Color: " + esc(this.variant ? this.variant.title : "")));
      var sw = el("div", { class: "emb-swatches" }), seen = {};
      vs.forEach(function (v) {
        if (seen[v.image]) return; seen[v.image] = 1;
        var b = el("button", { type: "button", class: "emb-swatch", "aria-label": v.title, title: v.title, "aria-pressed": String(v === self.variant) });
        b.style.backgroundImage = "url('" + String(v.image).replace(/'/g, "%27") + "')";
        b.addEventListener("click", function () { self.variant = v; self.loadVariantImage().then(function () { self.render(); }); });
        sw.appendChild(b);
      });
      p.appendChild(sw);
    }
    p.appendChild(el("p", { class: "emb-label" }, "Embroidery location"));
    if (!this.zones.length) {
      p.appendChild(el("p", { class: "emb-warn" }, "No embroidery locations are set up for this apron yet."));
      return;
    }
    var chips = el("div", { class: "emb-chips" });
    this.zones.forEach(function (z) {
      var b = el("button", { type: "button", class: "emb-chip", "aria-pressed": String(z === self.zone) }, esc(z.label));
      b.addEventListener("click", function () { self.zone = z; self.render(); });
      chips.appendChild(b);
    });
    p.appendChild(chips);
    var zi = this.zoneInches(this.zone);
    p.appendChild(el("p", { class: "emb-help" }, "Largest logo here: " + Math.min(this.zone.maxW || zi.w, zi.w).toFixed(1) + "″ wide × " + Math.min(this.zone.maxH || zi.h, zi.h).toFixed(1) + "″ tall."));
  };

  Builder.prototype.stepUpload = function (p) {
    var self = this;
    p.appendChild(el("h3", null, "Upload your logo"));
    var drop = el("label", { class: "emb-drop" },
      '<strong>Drop your logo here, or browse</strong><span class="emb-help">PNG, JPG or SVG for the preview · up to 20 MB</span>' +
      '<input type="file" class="emb-sr" accept=".png,.jpg,.jpeg,.svg,.webp,.pdf,.ai,.eps,image/*,application/pdf">');
    var input = drop.querySelector("input");
    input.addEventListener("change", function () { if (input.files[0]) self.handleFile(input.files[0]); });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) self.handleFile(f); });
    p.appendChild(drop);
    if (this.busy) p.appendChild(el("p", { class: "emb-help" }, "Reading your logo…"));
    if (this.logo) {
      var L = this.logo, badges = "";
      if (L.bgRemoved) badges += '<span class="emb-badge">Background removed</span>';
      if (L.bgKept) badges += '<span class="emb-badge">Background kept</span>';
      if (!L.lowRes) badges += '<span class="emb-badge">Resolution OK</span>';
      p.appendChild(el("div", { class: "emb-file" },
        '<img alt="" src="' + L.thumb + '"><div><p><strong>' + esc(L.file.name) + '</strong></p>' +
        '<p class="emb-help">' + L.naturalW + " × " + L.naturalH + " px · " + L.palette.length + " color" + (L.palette.length === 1 ? "" : "s") + " detected</p>" + badges + "</div>"));
      if (L.bgDetected) this.backgroundChoice(p);
      if (L.bgRemoved && (L.enclosed > L.opaque * 0.005 || L.keepEnclosed)) {
        var bgName = L.bg && L.bg[0] > 235 && L.bg[1] > 235 && L.bg[2] > 235 ? "white" : rgbToHex(L.bg);
        var keep = el("label", { class: "emb-check" }, '<input type="checkbox"' + (L.keepEnclosed ? " checked" : "") + '><span>Stitch the ' + esc(bgName) +
          " areas inside my logo. Leave this off if those areas should show the apron fabric.</span>");
        keep.querySelector("input").addEventListener("change", function (e) { self.handleFile(L.file, { keepEnclosed: e.target.checked, keepBackground: L.bgKept, keepPlace: true }); });
        p.appendChild(keep);
      }
      if (L.lowRes) p.appendChild(el("p", { class: "emb-warn" }, "This file is small, so fine details may be hard to judge. A larger file or a vector (SVG, AI, EPS, PDF) works best."));
      if (L.palette.length > 6) p.appendChild(el("p", { class: "emb-warn" }, "This logo has a lot of colors. Embroidery works best with fewer flat colors; you can merge them on the Colors step."));
    }
    p.appendChild(el("p", { class: "emb-help" }, "We keep your original file exactly as uploaded for production."));
  };

  // Remove the plain background (default) or keep it as part of the design.
  Builder.prototype.backgroundChoice = function (p) {
    var self = this, L = this.logo;
    var bgName = L.bg && L.bg[0] > 235 && L.bg[1] > 235 && L.bg[2] > 235 ? "white" : rgbToHex(L.bg);
    var box = el("fieldset", { class: "emb-bgchoice" }, "<legend class='emb-label'>Your logo has a plain " + esc(bgName) + " background</legend>");
    [
      { keep: false, title: "Remove the background", text: "Only the logo is stitched. The apron shows around it.", img: L.thumbRemoved },
      { keep: true, title: "Keep the background", text: "The background is stitched as a solid block. Choose this if it's part of your design.", img: L.thumbKept }
    ].forEach(function (o) {
      var on = o.keep === L.bgKept;
      var lab = el("label", { class: "emb-bgopt" + (on ? " is-on" : "") },
        '<input type="radio" name="emb-bg" class="emb-sr"' + (on ? " checked" : "") + '>' +
        '<span class="emb-bgimg"><img alt="" src="' + o.img + '"></span>' +
        '<span><strong>' + esc(o.title) + '</strong><span class="emb-help">' + esc(o.text) + '</span></span>');
      lab.querySelector("input").addEventListener("change", function () {
        if (o.keep !== L.bgKept) self.handleFile(L.file, { keepBackground: o.keep, keepEnclosed: L.keepEnclosed });
      });
      box.appendChild(lab);
    });
    p.appendChild(box);
    if (L.bgKept) p.appendChild(el("p", { class: "emb-warn" }, "A stitched background is a large filled area, so it adds stitches and counts as a thread color. You'll see the effect on the price step."));
  };

  Builder.prototype.handleFile = function (file, opts) {
    opts = opts || {};
    var self = this;
    this.error = "";
    if (file.size > MAX_FILE) { this.error = "That file is over 20 MB. Please upload a smaller version."; this.render(); return; }
    if (!PREVIEW_TYPES.test(file.type)) {
      this.error = "We can't preview " + (file.name.split(".").pop() || "this").toUpperCase() + " files yet. Please upload a PNG, JPG or SVG version for the preview.";
      this.render(); return;
    }
    this.busy = true; this.render();
    analyzeLogo(file, opts).then(function (logo) {
      self.busy = false;
      var oldPlace = self.place;
      self.logo = logo;
      self.logoCanvas = renderLogo(logo);
      self.place = opts.keepPlace ? oldPlace : {};
      self.estKey = null;
      self.render();
    }).catch(function (e) {
      self.busy = false; self.error = e.message || "We couldn't read that file."; self.render();
    });
  };

  Builder.prototype.stepPlace = function (p) {
    var self = this, pl = this.getPlace();
    p.appendChild(el("h3", null, "Place and size your logo"));
    p.appendChild(el("p", { class: "emb-help" }, "Drag the logo to move it. Drag a corner or use the slider to resize. It always stays inside the dashed area."));
    var chips = el("div", { class: "emb-chips" });
    this.zones.forEach(function (z) {
      var b = el("button", { type: "button", class: "emb-chip", "aria-pressed": String(z === self.zone) }, esc(z.label));
      b.addEventListener("click", function () { self.zone = z; self.render(); });
      chips.appendChild(b);
    });
    p.appendChild(chips);
    p.appendChild(el("p", { class: "emb-label" }, "Logo size"));
    var range = el("input", { type: "range", class: "emb-range", min: String(pl.minW.toFixed(2)), max: String(pl.maxW.toFixed(2)), step: "0.05", value: String(pl.w), "aria-label": "Logo width in inches", "data-range": "" });
    range.addEventListener("input", function () { self.place[self.zone.id].w = parseFloat(range.value); self.scheduleUpdate(); });
    p.appendChild(range);
    p.appendChild(el("p", { class: "emb-size", "data-size": "" }, pl.w.toFixed(1) + "″ × " + pl.h.toFixed(1) + "″"));
    p.appendChild(el("p", { class: "emb-help" }, "Largest for " + esc(this.zone.label.toLowerCase()) + ": " + pl.maxW.toFixed(1) + "″ wide at this logo's shape."));
    var row = el("div", { class: "emb-row" });
    var center = el("button", { type: "button", class: "emb-btn" }, "Center");
    center.addEventListener("click", function () { var q = self.place[self.zone.id]; q.cx = pl.zi.w / 2; q.cy = pl.zi.h / 2; self.render(); });
    var reset = el("button", { type: "button", class: "emb-btn" }, "Reset");
    reset.addEventListener("click", function () { delete self.place[self.zone.id]; self.render(); });
    row.appendChild(center); row.appendChild(reset);
    p.appendChild(row);
    p.appendChild(el("p", { class: "emb-ok", "data-est-line": "" }, this.estimateSummary(this.currentEstimate())));
    this.contrastWarning(p);
  };

  Builder.prototype.stepColors = function (p) {
    var self = this, L = this.logo;
    p.appendChild(el("h3", null, "Thread colors"));
    p.appendChild(el("p", { class: "emb-help" }, "We suggested a hex color for each color in your logo. Edit it, or add a Pantone code for an exact brand match. Almost any color can be matched in thread."));
    L.palette.forEach(function (c, i) {
      var row = el("div", { class: "emb-color-row" });
      var dot = el("span", { class: "emb-dot", "aria-hidden": "true" }); dot.style.background = c.hex;
      var hex = el("input", { class: "emb-input", value: c.hex, "aria-label": "Color " + (i + 1) + " hex", maxlength: "7", spellcheck: "false" });
      var pms = el("input", { class: "emb-input", value: c.pantone, placeholder: "Pantone (optional)", "aria-label": "Color " + (i + 1) + " Pantone", maxlength: "24" });
      hex.addEventListener("input", function () {
        var v = hex.value.trim(); if (v && v[0] !== "#") v = "#" + v;
        var ok = !!hexToRgb(v); hex.setAttribute("aria-invalid", String(!ok));
        if (ok) { c.hex = v.toUpperCase(); dot.style.background = c.hex; self.logoCanvas = renderLogo(L); self.draw(); self.refreshContrast(); }
      });
      pms.addEventListener("input", function () { c.pantone = pms.value.trim(); });
      row.appendChild(dot); row.appendChild(hex); row.appendChild(pms);
      p.appendChild(row);
    });
    if (L.palette.length > 1) {
      p.appendChild(el("p", { class: "emb-help" }, "Two colors that should be one? Give them the same hex and they'll count once."));
    }
    this.contrastWarning(p);
    var n = this.colorCount(), inc = this.pricing.includedColors;
    p.appendChild(el(n > inc ? "p" : "p", { class: n > inc ? "emb-warn" : "emb-ok" },
      n + " color" + (n === 1 ? "" : "s") + " · " + inc + " included in the base price" +
      (n > inc ? " · +" + money((n - inc) * this.pricing.perExtraColor) + " per apron" : "")));
    p.appendChild(el("p", { class: "emb-help" }, "Thread is matched to your hex or Pantone when the design is digitized. Exact matches aren't guaranteed, and screens show color differently."));
  };

  // Distinct colors after the customer's edits (identical hex counts once).
  // Average apron color inside the selected location (null if the photo can't be read).
  Builder.prototype.fabricColor = function () {
    if (!this.productImg || !this.zone) return null;
    var key = this.productImg.src + "|" + this.zone.id;
    if (this.fabricKey === key) return this.fabricVal;
    var z = this.zone, img = this.productImg, cv = document.createElement("canvas");
    cv.width = 40; cv.height = 40;
    var val = null;
    try {
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, z.x * img.naturalWidth, z.y * img.naturalHeight, z.w * img.naturalWidth, z.h * img.naturalHeight, 0, 0, 40, 40);
      var d = cx.getImageData(0, 0, 40, 40).data, t = [0, 0, 0], c = 0;
      for (var i = 0; i < d.length; i += 4) { t[0] += d[i]; t[1] += d[i + 1]; t[2] += d[i + 2]; c++; }
      val = [t[0] / c, t[1] / c, t[2] / c];
    } catch (e) { val = null; }
    this.fabricKey = key; this.fabricVal = val;
    return val;
  };

  // Colors that will be hard to see on this apron.
  Builder.prototype.lowContrast = function () {
    var fab = this.fabricColor(), L = this.logo;
    if (!fab || !L) return [];
    return L.palette.filter(function (c) {
      var rgb = hexToRgb(c.hex);
      return rgb && c.count / L.opaque >= 0.08 && contrast(rgb, fab) < 1.6;
    });
  };
  Builder.prototype.contrastWarning = function (p) {
    var box = el("div", { "data-contrast": "" });
    p.appendChild(box);
    this.refreshContrast(box);
  };
  Builder.prototype.refreshContrast = function (box) {
    box = box || (this.panel && this.panel.querySelector("[data-contrast]"));
    if (!box) return;
    box.innerHTML = "";
    var low = this.lowContrast();
    if (!low.length) return;
    box.appendChild(el("p", { class: "emb-warn" }, (low.length === 1 ? "The color " : "The colors ") + esc(low.map(function (c) { return c.hex; }).join(", ")) +
      (low.length === 1 ? " is" : " are") + " close to the apron color and may be hard to see. Try a lighter or darker thread on the Colors step, or a different apron color."));
  };

  Builder.prototype.colorCount = function () {
    var seen = {};
    this.logo.palette.forEach(function (c) { seen[(c.pantone || c.hex).toUpperCase()] = 1; });
    return Object.keys(seen).length;
  };

  Builder.prototype.apronPrice = function () {
    var v = this.variant;
    return v && typeof v.price === "number" ? v.price / 100 : null;
  };

  Builder.prototype.quote = function () {
    var e = this.currentEstimate(), pr = price(this.pricing, this.qty, e.stitches, this.colorCount());
    var ap = this.apronPrice();
    var aprons = ap == null ? null : ap * this.qty;
    return { estimate: e, price: pr, aprons: aprons, grand: (aprons || 0) + pr.total };
  };

  Builder.prototype.stepPrice = function (p) {
    var self = this, q = this.quote(), e = q.estimate, pr = q.price, inc = this.pricing.includedStitches;
    p.appendChild(el("h3", null, "Estimated price"));
    p.appendChild(el("p", { class: "emb-label" }, "Estimated stitch count"));
    p.appendChild(el("p", { class: "emb-big" }, "≈ " + fmtInt(round100(e.stitches))));
    var pct = clamp(e.stitches / inc, 0, 1.4) / 1.4 * 100;
    p.appendChild(el("div", { class: "emb-meter" + (e.stitches > inc ? " is-over" : "") }, '<span style="width:' + pct.toFixed(1) + '%"></span>'));
    p.appendChild(el("p", { class: "emb-help", "data-est-line": "" }, this.estimateSummary(e)));
    p.appendChild(el("p", { class: "emb-label" }, "Quantity"));
    var qty = el("input", { type: "number", class: "emb-input", min: "1", step: "1", value: String(this.qty), "aria-label": "Quantity", inputmode: "numeric" });
    qty.addEventListener("change", function () { self.qty = Math.max(1, parseInt(qty.value, 10) || 1); self.render(); });
    p.appendChild(qty);
    if (pr.belowMin) p.appendChild(el("p", { class: "emb-warn" }, "Custom embroidery has a " + this.pricing.minimum + "-apron minimum."));
    var rows = [];
    if (q.aprons != null) rows.push([this.qty + " aprons × " + money(this.apronPrice()), money(q.aprons)]);
    rows = rows.concat([
      ["Embroidery " + this.qty + " × " + money(pr.tier.price), money(pr.embroidery)],
      ["Extra stitches" + (pr.extraK ? " (" + pr.extraK + "k × " + money(this.pricing.perThousandStitches) + ")" : ""), money(pr.stitchCharge)],
      ["Extra colors" + (pr.extraColors ? " (" + pr.extraColors + ")" : ""), money(pr.colorCharge)],
      ["Setup, one time", money(pr.setup)]
    ]);
    p.appendChild(el("table", { class: "emb-table" }, "<tbody>" + rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody>"));
    p.appendChild(el("div", { class: "emb-total" }, "<span>Total before tax and shipping</span><span>" + money(q.grand) + "</span>"));
    p.appendChild(el("p", { class: "emb-help" }, "You'll pay this at checkout. Embroidery is " + money(pr.perApron) + " per apron plus the one-time setup fee. You'll get a digital proof to approve before production."));
  };

  Builder.prototype.stepSubmit = function (p) {
    var self = this;
    if (this.done) {
      p.appendChild(el("div", { class: "emb-done" },
        "<h3>Thanks, we have your design</h3><p class='emb-help'>Reference " + esc(this.done) + ". Taking you to checkout…</p>"));
      return;
    }
    var q = this.quote(), pl = this.getPlace();
    p.appendChild(el("h3", null, "Review and check out"));
    var colors = this.logo.palette.map(function (c) { return c.pantone ? c.pantone : c.hex; }).join(", ");
    var spec = [
      ["Apron", (this.cfg.product ? this.cfg.product.title : "") + (this.variant ? " · " + this.variant.title : "")],
      ["Location", this.zone.label], ["Size", pl.w.toFixed(1) + "″ × " + pl.h.toFixed(1) + "″"],
      ["Colors", colors], ["Est. stitches", "≈ " + fmtInt(round100(q.estimate.stitches))],
      ["Quantity", String(this.qty)], ["Embroidery + setup", money(q.price.total)], ["Total before tax and shipping", money(q.grand)]
    ];
    p.appendChild(el("table", { class: "emb-spec" }, "<tbody>" + spec.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody>"));
    var emailLab = el("label", { class: "emb-label" }, "Email (optional)");
    var emailIn = el("input", { class: "emb-input", type: "email", value: this.contact.email, autocomplete: "email", placeholder: "We'll fill it in at checkout" });
    emailIn.addEventListener("input", function () { self.contact.email = emailIn.value; self.updateSubmit(); });
    emailLab.appendChild(emailIn); p.appendChild(emailLab);
    var notes = el("label", { class: "emb-label" }, "Notes for our team");
    var ta = el("textarea", { class: "emb-input", rows: "3" }); ta.value = this.contact.notes;
    ta.addEventListener("input", function () { self.contact.notes = ta.value; });
    notes.appendChild(ta); p.appendChild(notes);
    var chk = el("label", { class: "emb-check" }, '<input type="checkbox"' + (this.rights ? " checked" : "") + '><span>I have the rights to use this logo.</span>');
    chk.querySelector("input").addEventListener("change", function (e) { self.rights = e.target.checked; self.updateSubmit(); });
    p.appendChild(chk);
    if (q.price.belowMin) p.appendChild(el("p", { class: "emb-warn" }, "Custom embroidery has a " + this.pricing.minimum + "-apron minimum. Change the quantity on the Price step."));
    var btn = el("button", { type: "button", class: "emb-primary", "data-submit": "" }, this.submitting ? "Preparing checkout…" : "Continue to checkout");
    btn.addEventListener("click", function () { self.submit(); });
    p.appendChild(btn);
    p.appendChild(el("p", { class: "emb-help" }, "Your design is saved and attached to your order. Custom items can't be returned."));
    this.updateSubmit();
  };

  Builder.prototype.updateSubmit = function () {
    var b = this.panel && this.panel.querySelector("[data-submit]");
    if (!b) return;
    var em = this.contact.email.trim();
    var ok = this.rights && (!em || /.+@.+\..+/.test(em)) && !this.submitting && this.qty >= (this.pricing.minimum || 1);
    b.disabled = !ok;
  };

  Builder.prototype.mockupBlob = function () {
    var L = this.layout(), scale = Math.min(1, 1600 / L.iw);
    var cv = document.createElement("canvas");
    cv.width = Math.round(L.iw * scale); cv.height = Math.round(L.ih * scale);
    this.draw(cv);
    this.draw(); // restore on-screen logoBox
    return new Promise(function (resolve) {
      try { cv.toBlob(function (b) { resolve(b); }, "image/png"); } catch (e) { resolve(null); }
    });
  };

  Builder.prototype.specData = function () {
    var q = this.quote(), pl = this.getPlace(), self = this;
    return {
      product: this.cfg.product, variant: this.variant ? { id: this.variant.id, title: this.variant.title } : null,
      zone: { id: this.zone.id, label: this.zone.label },
      size: { widthIn: +pl.w.toFixed(2), heightIn: +pl.h.toFixed(2) },
      position: { centerXIn: +pl.cx.toFixed(2), centerYIn: +pl.cy.toFixed(2), zoneWidthIn: +pl.zi.w.toFixed(2), zoneHeightIn: +pl.zi.h.toFixed(2) },
      colors: this.logo.palette.map(function (c) { return { detected: c.detected, hex: c.hex, pantone: c.pantone, share: +(c.count / self.logo.opaque).toFixed(3) }; }),
      colorCount: this.colorCount(),
      estimate: { stitches: Math.round(q.estimate.stitches), low: Math.round(q.estimate.low), high: Math.round(q.estimate.high), fillSqIn: +q.estimate.fillSqIn.toFixed(2), satinSqIn: +q.estimate.satinSqIn.toFixed(2), outlineIn: +q.estimate.outlineIn.toFixed(1) },
      quantity: this.qty,
      price: { perApron: q.price.perApron, tierPrice: q.price.tier.price, setupFee: q.price.setup, total: +q.price.total.toFixed(2), belowMinimum: q.price.belowMin },
      logoFile: { name: this.logo.file.name, type: this.logo.file.type, size: this.logo.file.size },
      background: this.logo.bgKept ? "kept" : this.logo.bgRemoved ? "removed" : "none",
      insideAreasStitched: !!(this.logo.bgRemoved && this.logo.keepEnclosed)
    };
  };

  Builder.prototype.submit = function () {
    var self = this;
    if (this.submitting) return;
    this.submitting = true; this.error = ""; this.render();
    this.mockupBlob().then(function (mock) {
      var fd = new FormData();
      fd.append("logo", self.logo.file, self.logo.file.name);
      if (mock) fd.append("mockup", mock, "mockup.png");
      return new Promise(function (resolve) {
        try { renderLogo(self.logo, true).toBlob(function (b) { resolve(b); }, "image/png"); } catch (e) { resolve(null); }
      }).then(function (art) { if (art) fd.append("artwork", art, "artwork.png"); return fd; });
    }).then(function (fd) {
      fd.append("spec", JSON.stringify(self.specData()));
      Object.keys(self.contact).forEach(function (k) { fd.append(k, self.contact[k]); });
      fd.append("rights", self.rights ? "yes" : "no");
      return fetch(self.cfg.proxyPath + "/submit", { method: "POST", body: fd, credentials: "same-origin" });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || !j.ok) throw new Error(j.error || "We couldn't send your design. Please try again.");
        self.done = j.reference || j.id || "received";
        if (j.checkoutUrl) window.location.href = j.checkoutUrl;
      });
    }).catch(function (e) {
      self.error = e.message || "We couldn't send your design. Please try again.";
    }).then(function () {
      self.submitting = false; self.render();
    });
  };

  /* ---------- boot ---------- */

  function boot(root) {
    if (root.__emb) return;
    root.__emb = true;
    var cfgEl = root.querySelector("[data-emb-config]"), cfg;
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) {
      console.error("[embroidery-builder] block settings are not valid JSON", e);
      if (window.Shopify && window.Shopify.designMode) {
        root.appendChild(el("p", { class: "emb-warn" }, "Embroidery builder: one of the JSON settings (locations, pricing or estimator) isn't valid JSON."));
      }
      return;
    }
    var btn = root.querySelector("[data-emb-open]");
    if (btn) btn.addEventListener("click", function () { new Builder(cfg).open(); });
  }
  function bootAll() { Array.prototype.forEach.call(document.querySelectorAll("[data-emb-root]"), boot); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootAll); else bootAll();
  document.addEventListener("shopify:section:load", bootAll);

  window.EmbroideryBuilder = { Builder: Builder, open: function (cfg) { var b = new Builder(cfg); b.open(); return b; }, _estimate: estimateStitches, _price: price };
})();
