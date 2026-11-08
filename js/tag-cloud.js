/* global window, document */
/**
 * 标签页（/tags）交互：搜索过滤 + 按名称/热度排序
 *
 * 由 layout/tags.ejs 仅在标签页引入，逻辑与旧版内联脚本保持一致。
 */
(function () {
  'use strict';

  var wrap = document.querySelector('.tag-cloud-wrap');
  if (!wrap) return;

  var allItems = Array.prototype.slice.call(wrap.querySelectorAll('.tag-cloud-item'));
  var input = document.querySelector('.tag-cloud-input');
  var sortBtns = document.querySelectorAll('.tag-sort-btn');
  var empty = document.querySelector('.tag-cloud-empty');

  if (input) {
    var timer;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var self = this;
      timer = setTimeout(function () {
        var q = self.value.trim().toLowerCase();
        var visible = 0;
        allItems.forEach(function (el) {
          var match = !q || el.getAttribute('data-name').indexOf(q) !== -1;
          el.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        if (empty) empty.style.display = visible ? 'none' : '';
      }, 120);
    });
  }

  Array.prototype.forEach.call(sortBtns, function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(sortBtns, function (b) {
        b.classList.remove('is-active');
      });
      btn.classList.add('is-active');

      var mode = btn.getAttribute('data-sort');
      allItems.sort(function (a, b) {
        if (mode === 'count') {
          var diff = (+b.getAttribute('data-count')) - (+a.getAttribute('data-count'));
          if (diff !== 0) return diff;
        }
        return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'), 'zh-CN');
      });
      allItems.forEach(function (el) { wrap.appendChild(el); });
    });
  });
})();
