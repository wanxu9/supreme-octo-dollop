/* ============================================================
   传播地图：本地 GeoJSON + Canvas 绘制
   支持拖动平移、滚轮/双指缩放、点击城市跳转
   ============================================================ */

const MapView = (function () {
  const BOUNDS = { lon0: 73, lon1: 141, lat0: 17, lat1: 54 };
  const PAD = 10;
  const MIN_ZOOM = 1, MAX_ZOOM = 4.5;

  let canvas, ctx, dpr = 1;
  let W = 0, H = 0;
  let base = null;                       // 底图（省份）离屏画布
  const BASE = { w: 0, h: 0, ox: 0, oy: 0 };
  let zoom = 1, panX = 0, panY = 0;

  let geo = null;
  let cityPoints = {};
  let view = { index: 0, events: [] };
  let onPick = null;
  let hoverCity = null;
  let raf = null, t0 = 0;
  let reduced = false;

  /* ---------- 投影 ---------- */
  function mercY(lat) {
    const r = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + r / 2));
  }
  // 底图坐标（0..BASE.w / 0..BASE.h）
  function basePoint(lng, lat) {
    const x = (lng - BOUNDS.lon0) / (BOUNDS.lon1 - BOUNDS.lon0);
    const y = (mercY(BOUNDS.lat1) - mercY(lat)) / (mercY(BOUNDS.lat1) - mercY(BOUNDS.lat0));
    return { x: x * BASE.w, y: y * BASE.h };
  }
  // 屏幕坐标
  function project(lng, lat) {
    const p = basePoint(lng, lat);
    return { x: panX + p.x * zoom, y: panY + p.y * zoom };
  }

  /* ---------- 尺寸 ---------- */
  function layout() {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const lonDeg = BOUNDS.lon1 - BOUNDS.lon0;
    const latMercDeg = (mercY(BOUNDS.lat1) - mercY(BOUNDS.lat0)) * 180 / Math.PI;
    const aspect = lonDeg / latMercDeg;
    let drawW = W - PAD * 2, drawH = H - PAD * 2;
    if (drawW / drawH > aspect) drawW = drawH * aspect;
    else drawH = drawW / aspect;

    BASE.w = drawW; BASE.h = drawH;
    BASE.ox = (W - drawW) / 2;
    BASE.oy = (H - drawH) / 2;
    if (zoom <= 1.001) { zoom = 1; panX = BASE.ox; panY = BASE.oy; }
    clampPan();
  }

  function clampPan() {
    const cw = BASE.w * zoom, ch = BASE.h * zoom;
    if (cw <= W) panX = (W - cw) / 2;
    else panX = Math.min(0, Math.max(W - cw, panX));
    if (ch <= H) panY = (H - ch) / 2;
    else panY = Math.min(0, Math.max(H - ch, panY));
  }

  /* ---------- 底图 ---------- */
  function drawBase() {
    base = document.createElement('canvas');
    base.width = Math.max(1, Math.round(BASE.w * dpr));
    base.height = Math.max(1, Math.round(BASE.h * dpr));
    const g = base.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, BASE.w, BASE.h);

    geo.features.forEach(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      g.beginPath();
      polys.forEach(rings => {
        rings.forEach(ring => {
          ring.forEach((pt, i) => {
            const p = basePoint(pt[0], pt[1]);
            if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
          });
          g.closePath();
        });
      });
      g.fillStyle = '#ece2cc';
      g.fill('evenodd');
      g.strokeStyle = 'rgba(150,132,104,0.6)';
      g.lineWidth = 0.7;
      g.stroke();
    });
  }

  /* ---------- 高亮省份 ---------- */
  function drawProvince(name, color) {
    if (!name) return;
    const f = geo.features.find(x => x.properties.name === name);
    if (!f) return;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    ctx.beginPath();
    polys.forEach(rings => {
      rings.forEach(ring => {
        ring.forEach((pt, i) => {
          const p = project(pt[0], pt[1]);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
      });
    });
    ctx.fillStyle = color;
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(168,50,42,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ---------- 城市与路线 ---------- */
  function collectCities() {
    cityPoints = {};
    view.events.forEach((ev, i) => {
      const c = CITIES[ev.city];
      if (!c || c.offmap) return;
      if (!cityPoints[ev.city]) cityPoints[ev.city] = { city: c, first: i, last: i };
      else cityPoints[ev.city].last = i;
    });
  }

  function cityState(cityId) {
    const info = cityPoints[cityId];
    const hasNow = view.events[view.index] && view.events[view.index].city === cityId;
    if (hasNow) return 'now';
    if (info && info.last < view.index) return 'done';
    return 'idle';
  }

  function routeCities() {
    const order = [];
    let last = null;
    view.events.forEach(ev => {
      const c = CITIES[ev.city];
      if (!c || c.offmap) return;
      if (ev.city !== last) { order.push(ev.city); last = ev.city; }
    });
    return order;
  }

  function drawRoute(time) {
    const order = routeCities();
    const shown = new Set();
    view.events.slice(0, view.index + 1).forEach(ev => shown.add(ev.city));
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = reduced ? 0 : -time * 0.02;
    for (let i = 1; i < order.length; i++) {
      if (!shown.has(order[i])) continue;
      const a = CITIES[order[i - 1]], b = CITIES[order[i]];
      const p1 = project(a.lng, a.lat), p2 = project(b.lng, b.lat);
      ctx.strokeStyle = 'rgba(168,50,42,0.32)';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    ctx.restore();
  }

  function offmapPoint() {
    return { x: panX + 46, y: panY + 26 };
  }

  function drawMarker(p, state, time) {
    const r = state === 'now' ? 7 : state === 'done' ? 4.5 : 3.5;
    if (state === 'now' && !reduced) {
      const pulse = (Math.sin(time / 420) + 1) / 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4 + pulse * 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(168,50,42,' + (0.18 - pulse * 0.06) + ')';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = state === 'now' ? '#a8322a' : state === 'done' ? '#b98a2f' : '#8d8577';
    ctx.fill();
    if (state === 'now') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fdf6ea';
      ctx.stroke();
    }
  }

  function drawLabel(p, text, state, dy) {
    ctx.font = (state === 'now' ? '600 13px' : '12px') + ' "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = p.y + (dy || -14);
    const w = ctx.measureText(text).width;
    if (state === 'now') {
      ctx.fillStyle = 'rgba(168,50,42,0.10)';
      ctx.fillRect(p.x - w / 2 - 5, y - 10, w + 10, 19);
    }
    ctx.fillStyle = state === 'now' ? 'rgba(168,50,42,0.95)' : 'rgba(60,54,46,0.66)';
    ctx.fillText(text, p.x, y - 1);
  }

  /* ---------- 绘制 ---------- */
  function draw(time) {
    if (!base) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e4ecec';
    ctx.fillRect(0, 0, W, H);

    // 经纬网
    ctx.strokeStyle = 'rgba(120,140,140,0.14)';
    ctx.lineWidth = 0.6;
    for (let lon = 75; lon <= 140; lon += 5) {
      const a = project(lon, BOUNDS.lat0), b = project(lon, BOUNDS.lat1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let lat = 20; lat <= 50; lat += 5) {
      const a = project(BOUNDS.lon0, lat), b = project(BOUNDS.lon1, lat);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    if (base.width > 1) {
      ctx.drawImage(base, panX, panY, BASE.w * zoom, BASE.h * zoom);
    }

    const ev = view.events[view.index];
    if (ev && CITIES[ev.city] && !CITIES[ev.city].offmap) {
      drawProvince(CITIES[ev.city].province, 'rgba(168,50,42,0.20)');
    }

    drawRoute(time);

    if (view.index >= 3) {
      const p = offmapPoint();
      const bj = project(CITIES.bj.lng, CITIES.bj.lat);
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(47,93,124,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(bj.x, bj.y); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#2f5d7c'; ctx.fill();
      ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(47,93,124,0.85)';
      ctx.fillText('彼得格勒（域外）', p.x + 9, p.y + 1);
    }

    Object.keys(cityPoints).forEach(id => {
      const info = cityPoints[id];
      const st = cityState(id);
      const p = project(info.city.lng, info.city.lat);
      drawMarker(p, st, time);
      if (st !== 'idle' || hoverCity === id) drawLabel(p, info.city.name, st, -13);
      else {
        ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(90,82,70,0.38)';
        ctx.fillText(info.city.name, p.x, p.y - 11);
      }
    });

    const cur = view.events[view.index];
    if (cur && CITIES[cur.city] && CITIES[cur.city].offmap) {
      ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(47,93,124,0.9)';
      ctx.textAlign = 'left';
      ctx.fillText('十月革命的消息经西伯利亚铁路传入中国', panX + 18, panY + 40);
    }
  }

  function loop(ts) {
    if (!t0) t0 = ts;
    if (!document.hidden) draw(ts - t0);
    raf = requestAnimationFrame(loop);
  }

  /* ---------- 交互 ---------- */
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pick(x, y) {
    let best = null, bestD = 18;
    Object.keys(cityPoints).forEach(id => {
      const c = cityPoints[id].city;
      const p = project(c.lng, c.lat);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  function setZoom(nz, cx, cy) {
    nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nz));
    if (Math.abs(nz - zoom) < 0.001) return;
    const f = nz / zoom;
    panX = cx - (cx - panX) * f;
    panY = cy - (cy - panY) * f;
    zoom = nz;
    clampPan();
  }

  function bind() {
    const pointers = new Map();
    let drag = null;
    let pinch = null;

    canvas.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, pointerPos(e));
      if (pointers.size === 1) {
        const p = pointerPos(e);
        drag = { x: p.x, y: p.y, px: panX, py: panY, moved: false };
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      } else if (pointers.size === 2) {
        const list = [...pointers.values()];
        pinch = { d: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y), zoom: zoom };
        drag = null;
      }
    });

    canvas.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pointerPos(e));
      const p = pointerPos(e);

      if (pointers.size === 2 && pinch) {
        const list = [...pointers.values()];
        const d = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
        const mid = { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 };
        if (pinch.d > 10) setZoom(pinch.zoom * (d / pinch.d), mid.x, mid.y);
        return;
      }
      if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        panX = drag.px + dx;
        panY = drag.py + dy;
        clampPan();
        canvas.style.cursor = 'grabbing';
        return;
      }
      const id = pick(p.x, p.y);
      canvas.style.cursor = id ? 'pointer' : 'grab';
      hoverCity = id;
    });

    function endPointer(e) {
      if (drag && !drag.moved) {
        const p = pointerPos(e);
        const id = pick(p.x, p.y);
        if (id && onPick) onPick(id);
      }
      drag = null;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      canvas.style.cursor = 'grab';
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', e => { drag = null; pointers.delete(e.pointerId); pinch = null; });
    canvas.addEventListener('pointerleave', () => { hoverCity = null; });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = pointerPos(e);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(zoom * factor, p.x, p.y);
    }, { passive: false });
  }

  function resize() {
    const oldZoom = zoom, oldPanX = panX, oldPanY = panY;
    layout();
    drawBase();
    if (oldZoom > 1) { zoom = oldZoom; panX = oldPanX; panY = oldPanY; clampPan(); }
    draw(0);
  }

  return {
    init(container, opts) {
      canvas = container;
      ctx = canvas.getContext('2d');
      geo = window.CHINA_GEO;
      if (!geo) return false;
      onPick = opts && opts.onPick;
      view.events = opts.events;
      reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      layout();
      drawBase();
      collectCities();
      bind();
      window.addEventListener('resize', resize);
      canvas.style.cursor = 'grab';
      loop(0);
      return true;
    },
    setIndex(i) {
      view.index = i;
      collectCities();
      draw(performance.now());
    },
    reset() {
      zoom = 1;
      panX = BASE.ox;
      panY = BASE.oy;
      clampPan();
      draw(performance.now());
    },
    focus() {
      const ev = view.events[view.index];
      if (!ev) return;
      const c = CITIES[ev.city];
      if (!c || c.offmap) { this.reset(); return; }
      const nz = Math.max(zoom, 1.9);
      const bp = basePoint(c.lng, c.lat);
      zoom = nz;
      panX = W / 2 - bp.x * nz;
      panY = H / 2 - bp.y * nz;
      clampPan();
      draw(performance.now());
    },
    get zoomLevel() { return zoom; }
  };
})();

window.MapView = MapView;
