/* ============================================================
   传播地图：用本地 GeoJSON 直接画在中国地图上
   不依赖 ECharts / WebGL / CDN，离线可用
   ============================================================ */

const MapView = (function () {
  const BOUNDS = { lon0: 73, lon1: 141, lat0: 17, lat1: 54 };
  const PAD = 10;

  let canvas, ctx, dpr = 1;
  let W = 0, H = 0, boxW = 1, boxH = 1, offX = 0, offY = 0;
  let base = null;
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
  function project(lng, lat) {
    const x = (lng - BOUNDS.lon0) / (BOUNDS.lon1 - BOUNDS.lon0);
    const yTop = mercY(BOUNDS.lat1), yBot = mercY(BOUNDS.lat0);
    const y = (yTop - mercY(lat)) / (yTop - yBot);
    return { x: offX + x * boxW, y: offY + y * boxH };
  }

  function layout() {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 保持经纬度比例（墨卡托）
    const lonDeg = BOUNDS.lon1 - BOUNDS.lon0;
    const latMercDeg = (mercY(BOUNDS.lat1) - mercY(BOUNDS.lat0)) * 180 / Math.PI;
    const aspect = lonDeg / latMercDeg;
    let drawW = W - PAD * 2, drawH = H - PAD * 2;
    if (drawW / drawH > aspect) drawW = drawH * aspect;
    else drawH = drawW / aspect;
    boxW = drawW;
    boxH = drawH;
    offX = (W - drawW) / 2;
    offY = (H - drawH) / 2;
  }

  /* ---------- 省份底图 ---------- */
  function drawBase() {
    base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const g = base.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = '#e4ecec';
    g.fillRect(0, 0, W, H);

    // 经纬网
    g.strokeStyle = 'rgba(120,140,140,0.16)';
    g.lineWidth = 0.6;
    for (let lon = 75; lon <= 140; lon += 5) {
      const a = project(lon, BOUNDS.lat0), b = project(lon, BOUNDS.lat1);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (let lat = 20; lat <= 50; lat += 5) {
      const a = project(BOUNDS.lon0, lat), b = project(BOUNDS.lon1, lat);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    geo.features.forEach(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      g.beginPath();
      polys.forEach(rings => {
        rings.forEach(ring => {
          ring.forEach((pt, i) => {
            const p = project(pt[0], pt[1]);
            if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
          });
          g.closePath();
        });
      });
      g.fillStyle = '#ece2cc';
      g.fill('evenodd');
      g.strokeStyle = 'rgba(150,132,104,0.55)';
      g.lineWidth = 0.7;
      g.stroke();
    });
  }

  /* ---------- 高亮当前省份 ---------- */
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
    ctx.strokeStyle = 'rgba(168,50,42,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ---------- 城市点 ---------- */
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
    const idx = view.index;
    const info = cityPoints[cityId];
    const hasNow = view.events[idx] && view.events[idx].city === cityId;
    if (hasNow) return 'now';
    if (info && info.last < idx) return 'done';
    return 'idle';
  }

  /* ---------- 路线 ---------- */
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
      const a = CITIES[order[i - 1]], b = CITIES[order[i]];
      if (!shown.has(order[i])) continue;
      const p1 = project(a.lng, a.lat), p2 = project(b.lng, b.lat);
      ctx.strokeStyle = 'rgba(168,50,42,0.32)';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    ctx.restore();

    // 十月革命：域外 → 北京
    const pet = CITIES.pet;
    const bj = CITIES.bj;
    if (view.index >= 3) {
      const p1 = offmapPoint(), p2 = project(bj.lng, bj.lat);
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(47,93,124,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      ctx.restore();
    }
  }

  function offmapPoint() {
    return { x: offX + 46, y: offY + 26 };
  }

  /* ---------- 标记 ---------- */
  function markerRadius(state) {
    return state === 'now' ? 7 : state === 'done' ? 4.5 : 3.5;
  }

  function drawMarker(p, state, time) {
    const r = markerRadius(state);
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

  /* ---------- 主绘制 ---------- */
  function draw(time) {
    if (!base) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);

    const ev = view.events[view.index];
    if (ev && CITIES[ev.city] && !CITIES[ev.city].offmap) {
      drawProvince(CITIES[ev.city].province, 'rgba(168,50,42,0.20)');
    }

    drawRoute(time);

    // 域外点
    if (view.index >= 3) {
      const p = offmapPoint();
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
        ctx.fillStyle = 'rgba(90,82,70,0.38)';
        ctx.fillText(info.city.name, p.x, p.y - 11);
      }
    });

    // 当前事件若在域外，给个提示
    const cur = view.events[view.index];
    if (cur && CITIES[cur.city] && CITIES[cur.city].offmap) {
      ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(47,93,124,0.9)';
      ctx.textAlign = 'left';
      ctx.fillText('十月革命的消息经西伯利亚铁路传入中国', offX + 18, offY + 34);
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
    let best = null, bestD = 16;
    Object.keys(cityPoints).forEach(id => {
      const c = cityPoints[id].city;
      const p = project(c.lng, c.lat);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  function bind() {
    canvas.addEventListener('pointermove', e => {
      const p = pointerPos(e);
      const id = pick(p.x, p.y);
      canvas.style.cursor = id ? 'pointer' : 'default';
      if (id !== hoverCity) { hoverCity = id; }
    });
    canvas.addEventListener('pointerleave', () => { hoverCity = null; });
    canvas.addEventListener('click', e => {
      const p = pointerPos(e);
      const id = pick(p.x, p.y);
      if (id && onPick) onPick(id);
    });
  }

  function resize() {
    layout();
    drawBase();
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
      loop(0);
      return true;
    },
    setIndex(i) {
      view.index = i;
      collectCities();
      draw(performance.now());
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    }
  };
})();

window.MapView = MapView;
