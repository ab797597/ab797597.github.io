/* global window, document, fetch, AbortController */
/**
 * 站点小部件：
 *   1. 访客定位（页脚）：IP 定位城市 + Open-Meteo 天气
 *   2. 历史上的今天（首页卡片）：读取站点内置的 data/history/MM.json
 *
 * 定位与天气为浏览器端请求（失败时隐藏）；历史数据不依赖第三方接口。
 */
(function () {
  'use strict';

  var TIMEOUT = 8000;

  function fetchJSON(url, timeout) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeout || TIMEOUT) : null;

    return fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function readCache(key, storage) {
    try {
      return JSON.parse((storage || window.localStorage).getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  function writeCache(key, value, storage) {
    try {
      (storage || window.localStorage).setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 隐私模式或超出配额时忽略缓存 */
    }
  }

  /* ------------------------------------------------------------------
   * 访客定位 + 天气
   * ------------------------------------------------------------------ */

  var locationEl = document.getElementById('site-location');
  var locationTextEl = locationEl && locationEl.querySelector('.site-location__text');

  // WMO weather code -> 中文描述
  var WEATHER_TEXT = {
    0: '晴', 1: '少云', 2: '多云', 3: '阴',
    45: '雾', 48: '雾凇',
    51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
    56: '冻毛毛雨', 57: '冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    66: '冻雨', 67: '冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
    80: '阵雨', 81: '阵雨', 82: '强阵雨',
    85: '阵雪', 86: '阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷阵雨伴冰雹'
  };

  function renderLocation(info, weather) {
    if (!locationEl || !locationTextEl) return;

    var parts = [];
    if (info.city) parts.push(info.city);
    else if (info.region) parts.push(info.region);
    else if (info.country) parts.push(info.country);
    if (!parts.length) return;

    if (weather && typeof weather.temperature_2m === 'number') {
      var desc = WEATHER_TEXT[weather.weather_code] || '';
      parts.push((desc ? desc + ' ' : '') + Math.round(weather.temperature_2m) + '°C');
    }

    locationTextEl.textContent = parts.join(' · ');
    var tip = [info.region, info.country].filter(Boolean).join('，');
    if (tip) locationEl.title = tip;
    locationEl.hidden = false;
  }

  function fetchWeather(info) {
    if (!info.latitude || !info.longitude) return Promise.resolve(null);
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(info.latitude) +
      '&longitude=' + encodeURIComponent(info.longitude) +
      '&current=temperature_2m,weather_code&timezone=auto';
    return fetchJSON(url).then(function (data) {
      return data && data.current;
    }).catch(function () {
      return null;
    });
  }

  // 国内接口：返回中文省市名（myip.ipip.net，支持 CORS）
  function queryIpip() {
    return fetchJSON('https://myip.ipip.net/json').then(function (data) {
      var location = data && data.ret === 'ok' && data.data && data.data.location;
      if (!location || !location.length) throw new Error('ipip failed');
      return {
        city: location[2] || location[1] || '',
        region: location[1] || '',
        country: location[0] || ''
      };
    });
  }

  function queryIpwho() {
    return fetchJSON('https://ipwho.is/').then(function (data) {
      if (!data || data.success === false) throw new Error('ipwho failed');
      return {
        city: data.city,
        region: data.region,
        country: data.country,
        latitude: data.latitude,
        longitude: data.longitude
      };
    });
  }

  function queryIpinfo() {
    return fetchJSON('https://ipinfo.io/json').then(function (data) {
      var loc = String(data.loc || '').split(',');
      return {
        city: data.city,
        region: data.region,
        country: data.country,
        latitude: loc[0],
        longitude: loc[1]
      };
    });
  }

  function initLocation() {
    if (!locationEl) return;

    var cacheMinutes = parseInt(locationEl.getAttribute('data-cache-minutes'), 10) || 30;
    var withWeather = locationEl.getAttribute('data-weather') !== 'false';
    var cached = readCache('site-location-v1');

    if (cached && cached.info && Date.now() - cached.ts < cacheMinutes * 60000) {
      renderLocation(cached.info, cached.weather);
      return;
    }

    Promise.all([
      queryIpip().catch(function () { return null; }),
      queryIpwho().catch(queryIpinfo).catch(function () { return null; })
    ])
      .then(function (list) {
        var cn = list[0];
        var ip = list[1];
        if (!cn && !ip) throw new Error('locate failed');
        return {
          city: (cn && cn.city) || (ip && ip.city),
          region: (cn && cn.region) || (ip && ip.region),
          country: (cn && cn.country) || (ip && ip.country),
          latitude: ip && ip.latitude,
          longitude: ip && ip.longitude
        };
      })
      .then(function (info) {
        if (!withWeather) return { info: info, weather: null };
        return fetchWeather(info).then(function (weather) {
          return { info: info, weather: weather };
        });
      })
      .then(function (result) {
        writeCache('site-location-v1', {
          ts: Date.now(),
          info: result.info,
          weather: result.weather
        });
        renderLocation(result.info, result.weather);
      })
      .catch(function () {
        /* 定位失败时保持隐藏 */
      });
  }

  /* ------------------------------------------------------------------
   * 历史上的今天
   * ------------------------------------------------------------------ */

  function stripHTML(html) {
    var text = String(html || '');
    if (window.DOMParser) {
      var doc = new window.DOMParser().parseFromString(text, 'text/html');
      text = doc.body ? doc.body.textContent : text;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function renderHistory(box, items, dateLabel) {
    var list = box.querySelector('.history-today__list');
    if (!list || !items.length) return;

    var dateEl = box.querySelector('.history-today__date');
    if (dateEl) dateEl.textContent = dateLabel;

    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'history-today__item';

      var year = document.createElement('span');
      year.className = 'history-today__year';
      year.textContent = item.year ? item.year + ' 年' : '';

      var text = document.createElement('span');
      text.className = 'history-today__text';
      text.textContent = item.title;

      li.appendChild(year);
      li.appendChild(text);
      fragment.appendChild(li);
    });

    list.appendChild(fragment);
    box.hidden = false;
  }

  function initHistory() {
    var box = document.getElementById('history-today');
    if (!box) return;

    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var dateKey = month + day;
    var dateLabel = (now.getMonth() + 1) + '月' + now.getDate() + '日';
    var max = parseInt(box.getAttribute('data-max'), 10) || 5;

    function use(items) {
      var list = (items || [])
        .map(function (item) {
          return {
            year: item && (item.y || item.year),
            title: item && (item.t || stripHTML(item.title))
          };
        })
        .filter(function (item) { return item.title; })
        .slice(0, max);
      renderHistory(box, list, dateLabel);
    }

    var cacheKey = 'history-today-v1';
    var cached = readCache(cacheKey, window.sessionStorage);
    if (cached && cached.day === dateKey && Date.now() - cached.ts < 12 * 3600000) {
      use(cached.items);
      return;
    }

    var base = box.getAttribute('data-src') || '/data/history/';
    if (base.charAt(base.length - 1) !== '/') base += '/';

    fetchJSON(base + month + '.json')
      .then(function (data) {
        var items = data && data[dateKey];
        if (!items || !items.length) throw new Error('no history data');
        writeCache(cacheKey, { ts: Date.now(), day: dateKey, items: items }, window.sessionStorage);
        use(items);
      })
      .catch(function () {
        /* 数据缺失时保持隐藏 */
      });
  }

  initLocation();
  initHistory();
})();
