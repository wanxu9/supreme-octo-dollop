/* ============================================================
   页面逻辑：时间轴、事件卡、地图联动、人物与出处
   ============================================================ */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const events = EVENTS;
  const N = events.length;
  let index = 0;
  let playing = false;
  let playTimer = null;

  const stageOf = ev => STAGES[ev.stage];
  const cityOf = ev => CITIES[ev.city] || { name: '' };

  /* ---------------- 渲染：事件卡 ---------------- */
  function renderCard(ev) {
    const card = $('card');
    card.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'card-top';
    const stage = document.createElement('span');
    stage.className = 'chip';
    stage.style.setProperty('--chip', stageOf(ev).color);
    stage.textContent = stageOf(ev).name + ' · ' + stageOf(ev).sub;
    const date = document.createElement('span');
    date.className = 'card-date';
    date.textContent = ev.date;
    top.append(stage, date);

    const h = document.createElement('h2');
    h.className = 'card-title';
    h.textContent = ev.title;

    const meta = document.createElement('p');
    meta.className = 'card-meta';
    meta.textContent = ev.place + (ev.people.length ? ' · ' + ev.people.join('、') : '');

    const desc = document.createElement('p');
    desc.className = 'card-desc';
    desc.textContent = ev.desc;

    const mean = document.createElement('p');
    mean.className = 'card-mean';
    const b = document.createElement('b');
    b.textContent = '意义';
    mean.append(b, document.createTextNode(ev.meaning));

    card.append(top, h, meta, desc, mean);

    if (ev.source) {
      const a = document.createElement('a');
      a.className = 'card-source';
      a.href = ev.source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '出处：' + ev.source.label;
      card.append(a);
    }
  }

  /* ---------------- 渲染：时间轴 ---------------- */
  function buildRail() {
    const inner = $('railInner');
    inner.innerHTML = '';
    const stat = document.createElement('div');
    stat.className = 'rail-stats';
    inner.append(stat);

    events.forEach((ev, i) => {
      const btn = document.createElement('button');
      btn.className = 'node';
      btn.style.left = (i / (N - 1)) * 100 + '%';
      btn.dataset.i = i;
      btn.setAttribute('aria-label', ev.date + ' ' + ev.title);
      btn.title = ev.date + ' · ' + ev.title;

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--node', stageOf(ev).color);

      const lab = document.createElement('span');
      lab.className = 'node-year';
      const prev = events[i - 1];
      lab.textContent = (!prev || prev.year !== ev.year) ? ev.year : '';

      btn.append(dot, lab);
      btn.addEventListener('click', () => setIndex(i, true));
      inner.append(btn);
    });

    const fill = document.createElement('div');
    fill.className = 'rail-fill';
    fill.id = 'railFill';
    inner.append(fill);
  }

  function updateRail() {
    const pct = N > 1 ? (index / (N - 1)) * 100 : 0;
    $('railFill').style.width = pct + '%';
    document.querySelectorAll('.node').forEach(n => {
      const i = Number(n.dataset.i);
      n.classList.toggle('active', i === index);
      n.classList.toggle('done', i < index);
    });
    const active = document.querySelector('.node.active');
    if (active && active.scrollIntoView) {
      const rail = $('rail');
      const r = active.getBoundingClientRect();
      const c = rail.getBoundingClientRect();
      if (r.left < c.left + 40 || r.right > c.right - 40) {
        if (rail.scrollTo) rail.scrollTo({ left: rail.scrollLeft + (r.left - c.left) - c.width / 2, behavior: 'smooth' });
      }
    }
  }

  /* ---------------- 渲染：事件清单 ---------------- */
  function buildList() {
    const wrap = $('list');
    wrap.innerHTML = '';
    STAGES.forEach((st, si) => {
      const sec = document.createElement('section');
      sec.className = 'list-stage';
      const head = document.createElement('div');
      head.className = 'list-head';
      head.innerHTML = '<span class="list-dot" style="background:' + st.color + '"></span>' +
        '<h3>' + st.name + '</h3><span class="list-sub">' + st.from + '—' + st.to + ' · ' + st.sub + '</span>';
      sec.append(head);

      const ol = document.createElement('ol');
      ol.className = 'list-items';
      events.forEach((ev, i) => {
        if (ev.stage !== si) return;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'list-item';
        btn.dataset.i = i;
        btn.innerHTML = '<span class="li-date">' + ev.date + '</span>' +
          '<span class="li-title">' + ev.title + '</span>' +
          '<span class="li-place">' + cityOf(ev).name + '</span>';
        btn.addEventListener('click', () => {
          setIndex(i, true);
          const board = document.getElementById('board');
          if (board && board.scrollIntoView) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        li.append(btn);
        ol.append(li);
      });
      sec.append(ol);
      wrap.append(sec);
    });
  }

  function updateListActive() {
    document.querySelectorAll('.list-item').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.i) === index);
    });
  }

  /* ---------------- 渲染：阶段切换 ---------------- */
  function buildStages() {
    const wrap = $('stageChips');
    STAGES.forEach((st, si) => {
      const b = document.createElement('button');
      b.className = 'stage-chip';
      b.style.setProperty('--stage', st.color);
      const dot = document.createElement('i');
      const name = document.createElement('span');
      name.textContent = st.name;
      const small = document.createElement('small');
      small.textContent = st.from + '—' + st.to + ' · ' + st.sub;
      b.append(dot, name, small);
      b.addEventListener('click', () => {
        const i = events.findIndex(e => e.stage === si);
        if (i >= 0) {
          setIndex(i, true);
          const board = document.getElementById('board');
          if (board && board.scrollIntoView) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      wrap.append(b);
    });
  }

  /* ---------------- 渲染：人物与出处 ---------------- */
  function buildPeople() {
    const wrap = $('peopleList');
    PEOPLE.forEach(p => {
      const card = document.createElement('article');
      card.className = 'person';
      const name = document.createElement('h3');
      name.textContent = p.name;
      if (p.years) {
        const y = document.createElement('span');
        y.className = 'person-years';
        y.textContent = p.years;
        name.append(y);
      }
      const role = document.createElement('p');
      role.className = 'person-role';
      role.textContent = p.role;
      const note = document.createElement('p');
      note.className = 'person-note';
      note.textContent = p.note;
      card.append(name, role, note);
      wrap.append(card);
    });
  }

  function buildSources() {
    const wrap = $('sourceList');
    SOURCES.forEach((s, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = s.label;
      const num = document.createElement('span');
      num.className = 'src-num';
      num.textContent = String(i + 1).padStart(2, '0');
      li.append(num, a);
      wrap.append(li);
    });
  }

  /* ---------------- 状态切换 ---------------- */
  function setIndex(i, fromUser) {
    index = Math.max(0, Math.min(N - 1, i));
    const ev = events[index];
    renderCard(ev);
    $('progress').textContent = '第 ' + (index + 1) + ' / ' + N + ' 个节点';
    $('stageTag').textContent = stageOf(ev).name;
    $('stageTag').style.setProperty('--chip', stageOf(ev).color);
    $('yearBig').textContent = ev.year;
    updateRail();
    updateListActive();
    if (typeof MapView !== 'undefined') MapView.setIndex(index);
    try {
      history.replaceState(null, '', '#' + ev.id);
    } catch (e) { /* file:// 下可能不支持 */ }
    if (fromUser && playing) stopPlay();
  }

  function stopPlay() {
    playing = false;
    if (playTimer) clearTimeout(playTimer);
    playTimer = null;
    $('playBtn').classList.remove('playing');
    $('playBtn').textContent = '自动播放';
  }

  function togglePlay() {
    if (playing) { stopPlay(); return; }
    playing = true;
    $('playBtn').classList.add('playing');
    $('playBtn').textContent = '暂停';
    const step = () => {
      if (!playing) return;
      if (index >= N - 1) { stopPlay(); return; }
      setIndex(index + 1);
      playTimer = setTimeout(step, 4200);
    };
    playTimer = setTimeout(step, 1200);
  }

  /* ---------------- 时间轴拖动 ---------------- */
  function bindRail() {
    const rail = $('rail');
    const inner = $('railInner');
    let dragging = false;

    const pick = clientX => {
      const r = inner.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      return Math.round(ratio * (N - 1));
    };

    inner.addEventListener('pointerdown', e => {
      if (e.target.closest('.node')) return;
      dragging = true;
      inner.setPointerCapture(e.pointerId);
      setIndex(pick(e.clientX), true);
    });
    inner.addEventListener('pointermove', e => {
      if (dragging) setIndex(pick(e.clientX), true);
    });
    inner.addEventListener('pointerup', () => { dragging = false; });
    inner.addEventListener('pointercancel', () => { dragging = false; });
    rail.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { setIndex(index + 1, true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { setIndex(index - 1, true); e.preventDefault(); }
      if (e.key === 'Home') { setIndex(0, true); e.preventDefault(); }
      if (e.key === 'End') { setIndex(N - 1, true); e.preventDefault(); }
    });
  }

  /* ---------------- 键盘 ---------------- */
  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { setIndex(index + 1, true); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { setIndex(index - 1, true); e.preventDefault(); }
      else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    });
  }

  /* ---------------- 地图点击 ---------------- */
  function pickCity(cityId) {
    let best = index, bestD = 1e9;
    events.forEach((ev, i) => {
      if (ev.city !== cityId) return;
      const d = Math.abs(i - index);
      if (d < bestD) { bestD = d; best = i; }
    });
    setIndex(best, true);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    buildRail();
    buildList();
    buildPeople();
    buildSources();
    buildStages();
    bindRail();
    bindKeys();

    $('prevBtn').addEventListener('click', () => setIndex(index - 1, true));
    $('nextBtn').addEventListener('click', () => setIndex(index + 1, true));
    $('playBtn').addEventListener('click', togglePlay);

    let start = 0;
    if (location.hash) {
      const found = events.findIndex(e => '#' + e.id === location.hash);
      if (found >= 0) start = found;
    } else if (events.length) {
      start = 0;
    }
    setIndex(start);
    if (!$('playBtn').classList.contains('playing')) {
      // 让首屏就停在第一个节点，避免自动播放打扰
    }

    const mapOk = typeof MapView !== 'undefined' && MapView.init($('map'), { events, onPick: pickCity });
    if (!mapOk) {
      $('map').parentElement.classList.add('map-failed');
    }
    if (typeof MapView !== 'undefined') MapView.setIndex(index);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
