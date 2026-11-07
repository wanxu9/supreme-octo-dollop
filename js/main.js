(function () {
  'use strict';

  const mapEl = document.getElementById('map');
  const chart = echarts.init(mapEl);

  const ACTIVE_COLOR = '#f5c518';
  const IDLE_COLOR = '#6a6a6a';

  let chinaGeoLoaded = false;
  let regionOptions = [];

  function cityById(id) {
    return CITIES.find(c => c.id === id);
  }

  function terrainColor(name) {
    if (TERRAIN_HIGH.some(k => name.indexOf(k) !== -1)) return '#c9c2b0'; // 高原 / 雪山（浅灰白）
    if (TERRAIN_MOUNTAIN.some(k => name.indexOf(k) !== -1)) return '#a08a68'; // 山地（棕褐）
    return '#4a7048';                                                     // 平原 / 低地（绿）
  }

  function scatterData(year) {
    const eventsOfYear = EVENTS[year] || {};
    return CITIES.map(city => {
      const active = !!(eventsOfYear[city.id] && eventsOfYear[city.id].length);
      return {
        value: [city.lng, city.lat, active ? 8 : 5],
        itemStyle: { color: active ? ACTIVE_COLOR : IDLE_COLOR }
      };
    });
  }

  function riverData() {
    return RIVERS.map(r => ({
      coords: r.coords.map(p => [p[0], p[1], 3.3])
    }));
  }

  function renderMap(year) {
    if (!chinaGeoLoaded) return;
    chart.setOption({
      tooltip: {
        formatter: function (params) {
          if (params.seriesType === 'scatter3D') {
            const city = CITIES[params.dataIndex];
            return city ? city.name : '';
          }
          return '';
        }
      },
      geo3D: {
        map: 'china',
        roam: true,
        regionHeight: 3,
        shading: 'lambert',
        light: {
          main: { intensity: 1.4, alpha: 45, beta: 20 },
          ambient: { intensity: 0.75 }
        },
        itemStyle: {
          areaColor: '#4a7048',
          borderWidth: 1,
          borderColor: '#0d1a24'
        },
        emphasis: { itemStyle: { areaColor: '#c9a83a' } },
        label: { show: false },
        regions: regionOptions,
        viewControl: {
          alpha: 65,
          beta: 0,
          distance: 50,
          minAlpha: 10,
          maxAlpha: 85,
          panMouseButton: 'left',
          rotateMouseButton: 'right'
        }
      },
      series: [
        {
          type: 'scatter3D',
          coordinateSystem: 'geo3D',
          symbolSize: 16,
          data: scatterData(year),
          itemStyle: { opacity: 1 },
          animationDuration: 600,
          animationEasing: 'cubicOut',
          animationDurationUpdate: 700,
          animationEasingUpdate: 'cubicInOut'
        },
        {
          type: 'lines3D',
          coordinateSystem: 'geo3D',
          data: riverData(),
          lineStyle: { color: '#3f7fb8', width: 2, opacity: 0.85 }
        }
      ]
    });
  }

  // 使用本地打包的中国省级地图数据（不再依赖外部接口）
  Promise.resolve().then(() => {
    const china = window.CHINA_GEO;
    if (!china || !china.features) throw new Error('china geo data missing');
    echarts.registerMap('china', china);
    regionOptions = china.features.map(f => ({
      name: f.properties.name,
      itemStyle: { areaColor: terrainColor(f.properties.name) }
    }));
    chinaGeoLoaded = true;
    renderMap(currentYear);
  }).catch(err => {
    console.error(err);
    mapEl.innerHTML = '<div class="map-error">地图数据加载失败，请检查网络后刷新重试</div>';
  });

  // ------- 时间轴 -------
  let currentYear = YEARS[0];

  const yearsEl = document.getElementById('timelineYears');
  const fillEl = document.getElementById('timelineFill');
  const thumbEl = document.getElementById('timelineThumb');
  const trackEl = document.getElementById('timelineTrack');
  const infoYearEl = document.getElementById('infoYear');
  const infoEventsEl = document.getElementById('infoEvents');

  YEARS.forEach(year => {
    const node = document.createElement('div');
    node.className = 'year-node';
    node.dataset.year = year;
    node.textContent = year;
    node.addEventListener('click', () => setYear(year));
    yearsEl.appendChild(node);
  });

  function setYear(year) {
    currentYear = year;
    updateTimelineUI();
    updateInfoPanel();
    pulseMap();
    renderMap(year);
  }

  function updateTimelineUI() {
    const idx = YEARS.indexOf(currentYear);
    const pct = (idx / (YEARS.length - 1)) * 100;
    fillEl.style.width = pct + '%';
    thumbEl.style.left = pct + '%';
    document.querySelectorAll('.year-node').forEach(node => {
      node.classList.toggle('active', Number(node.dataset.year) === currentYear);
    });
  }

  function updateInfoPanel() {
    const eventsOfYear = EVENTS[currentYear] || {};
    infoYearEl.textContent = currentYear;
    const rows = [];
    Object.keys(eventsOfYear).forEach(cityId => {
      const city = cityById(cityId);
      (eventsOfYear[cityId] || []).forEach(text => {
        rows.push({ city: city ? city.name : cityId, text: text });
      });
    });
    if (rows.length === 0) {
      infoEventsEl.innerHTML = '<li class="empty">该年份暂无事件记录（内容待补充）</li>';
    } else {
      infoEventsEl.innerHTML = rows.map(r =>
        '<li><span class="event-city">' + r.city + '</span><span class="event-text">' + r.text + '</span></li>'
      ).join('');
    }
  }

  let mapFadeTimer = null;
  function pulseMap() {
    mapEl.classList.add('transitioning');
    clearTimeout(mapFadeTimer);
    mapFadeTimer = setTimeout(() => mapEl.classList.remove('transitioning'), 350);
  }

  function yearFromX(clientX) {
    const rect = trackEl.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, ratio));
    const idx = Math.round(clamped * (YEARS.length - 1));
    return YEARS[idx];
  }

  let dragging = false;
  thumbEl.addEventListener('pointerdown', e => {
    dragging = true;
    thumbEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  trackEl.addEventListener('pointerdown', e => {
    dragging = true;
    setYear(yearFromX(e.clientX));
  });
  window.addEventListener('pointermove', e => {
    if (dragging) setYear(yearFromX(e.clientX));
  });
  window.addEventListener('pointerup', () => { dragging = false; });

  // ------- 地图交互 -------
  chart.on('click', params => {
    if (params.seriesType === 'scatter3D' && params.dataIndex != null) {
      const city = CITIES[params.dataIndex];
      if (city) showCityDetail(city);
    }
  });

  function showCityDetail(city) {
    const events = (EVENTS[currentYear] || {})[city.id] || [];
    infoYearEl.textContent = currentYear + ' · ' + city.name;
    if (events.length === 0) {
      infoEventsEl.innerHTML = '<li class="empty">' + city.name + ' 在该年份暂无事件（内容待补充）</li>';
    } else {
      infoEventsEl.innerHTML = events.map(t =>
        '<li><span class="event-city">' + city.name + '</span><span class="event-text">' + t + '</span></li>'
      ).join('');
    }
  }

  // ------- 人物面板 -------
  const peopleListEl = document.getElementById('peopleList');
  const peoplePanel = document.getElementById('peoplePanel');
  const panelToggle = document.getElementById('panelToggle');

  PEOPLE.forEach(p => {
    const li = document.createElement('li');
    li.className = 'person';
    li.textContent = p.name;
    peopleListEl.appendChild(li);
  });

  panelToggle.addEventListener('click', () => {
    peoplePanel.classList.toggle('hidden');
    panelToggle.classList.toggle('active');
  });

  // ------- 响应式 -------
  window.addEventListener('resize', () => chart.resize());

  // ------- 初始化 -------
  updateTimelineUI();
  updateInfoPanel();
})();
