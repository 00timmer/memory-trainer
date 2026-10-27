// ============================================================
// 首页版式：分组列表（参考 Windows 11 设置 / Outlook / iOS 设置）
// - 小节标题在框外，一个小节只有一个白色面板
// - 面板里每一项是一行：图标块 + 标题/说明 + ›，行与行之间一条细分隔线
// - 统计数字和连续天数合成一条
// 只调整 DOM 位置和 class，不改各入口的点击行为。
// ============================================================
MT2.ICON_TINT = ['#e8f0fe', '#e6f4ea', '#fef3e2', '#fce8e6', '#f3e8fd', '#e0f7fa'];

MT2.tintIcon = function (el, i) {
  el.style.background = MT2.ICON_TINT[i % MT2.ICON_TINT.length];
};

MT2.layoutHome = function () {
  var home = document.getElementById('screen-home');
  if (!home) return;

  // 1) 统计条：今日练习 / 正确率 / 弱项 / 连续天数 —— 一个面板四格
  var bar = home.querySelector('.stats-bar');
  if (bar && !bar.getAttribute('data-ui')) {
    bar.setAttribute('data-ui', '1');
    bar.classList.add('ui-group');
    var sc = document.getElementById('streak-count');
    if (sc) {
      var cell = document.createElement('div');
      cell.className = 'stat-card';
      sc.classList.add('value');
      cell.appendChild(sc);
      var l = document.createElement('div');
      l.className = 'label'; l.textContent = '连续天数 🔥';
      cell.appendChild(l);
      bar.appendChild(cell);
    }
    var sb = document.getElementById('streak-bar');
    if (sb) sb.style.display = 'none';
  }

  // 2) 直接记忆：标题移出框外，入口变成行
  var dm = document.getElementById('mt-dm-entries');
  if (dm && !dm.getAttribute('data-ui')) {
    dm.setAttribute('data-ui', '1');
    var h = dm.querySelector('.mt-fold-h');
    if (h) { h.className = 'ui-sec-h'; h.textContent = '直接记忆'; dm.parentNode.insertBefore(h, dm); }
    dm.classList.add('ui-group');
    Array.prototype.forEach.call(dm.querySelectorAll('.dm-entry'), function (e, i) {
      var t = e.querySelector('.t'), d = e.querySelector('.d');
      var m = t.textContent.match(/^(\S+)\s+(.*)$/);
      var ico = document.createElement('div');
      ico.className = 'ui-ico'; MT2.tintIcon(ico, i);
      ico.textContent = m ? m[1] : '•';
      if (m) t.textContent = m[2];
      var txt = document.createElement('div');
      txt.className = 'ui-txt';
      txt.appendChild(t); if (d) txt.appendChild(d);
      e.insertBefore(ico, e.firstChild);
      e.appendChild(txt);
      e.classList.add('ui-row', 'ui-chev');
    });
  }

  // 3) 原有模式列表：图标放左边，行式
  Array.prototype.forEach.call(home.querySelectorAll('.mode-grid'), function (g) {
    if (g.getAttribute('data-ui')) return;
    g.setAttribute('data-ui', '1');
    g.classList.add('ui-group');
    Array.prototype.forEach.call(g.querySelectorAll('.mode-btn'), function (b, i) {
      b.classList.add('ui-row', 'ui-chev');
      var ico = b.querySelector('.mode-icon');
      if (ico) { ico.classList.add('ui-ico'); MT2.tintIcon(ico, i); b.insertBefore(ico, b.firstChild); }
      var txt = ico ? ico.nextElementSibling : null;
      if (txt) txt.classList.add('ui-txt');
    });
  });
  Array.prototype.forEach.call(home.querySelectorAll('.section-title'), function (t) {
    t.classList.add('ui-sec-h');
    if (!t.textContent.trim()) t.style.display = 'none';
  });
  var fold = document.getElementById('mt-fold-head');
  if (fold) fold.classList.add('ui-sec-h', 'ui-sec-fold');
};
