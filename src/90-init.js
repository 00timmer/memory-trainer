// ============================================================
// 接线：新屏幕路由 / 首页改版 / 初始化
// ============================================================
MT2.SCREENS = ['home','training','summary','browse','stats','seq-memorize','seq-recall','mt-dash','mt-map'];

showScreen = function (name) {
  currentScreen = name;
  MT2.SCREENS.forEach(function (s) {
    var e = document.getElementById('screen-' + s);
    if (e) e.style.display = (s === name ? 'block' : 'none');
  });
  document.getElementById('deck-tabs').style.display = (name === 'home' ? '' : 'none');
};

var _mtOrigHandleBack = handleBack;
handleBack = function () {
  var modal = document.querySelector('.modal-overlay.show');
  if (modal) { modal.classList.remove('show'); return true; }
  if (currentScreen === 'mt-map') { MT2.showDash(); return true; }
  if (currentScreen === 'mt-dash') { showHome(); return true; }
  return _mtOrigHandleBack();
};

// 训练记录入口改到新仪表盘
function showStatsPage() { MT2.showDash(); }

MT2.pickImport = function (mode) {
  var inp = document.getElementById('mt-import-file');
  inp.setAttribute('data-mode', mode || 'merge');
  inp.click();
};

// ------------------------------------------------------------
// 首页：「今日训练」置顶，原有模式收进折叠区
// ------------------------------------------------------------
MT2.injectHome = function () {
  var modes = document.getElementById('home-modes');
  if (!modes || document.getElementById('mt-today-card')) return;

  var card = document.createElement('div');
  card.id = 'mt-today-card';
  card.className = 'mt-today';
  card.innerHTML =
    '<div class="t">▶ 今日训练</div>' +
    '<div class="d" id="mt-today-desc"></div>' +
    '<div class="mt-today-lens" id="mt-today-lens">' +
      Object.keys(MT2.SESSION_PRESETS).map(function (k) {
        return '<button data-len="' + k + '">' + MT2.SESSION_PRESETS[k].label + '</button>';
      }).join('') +
    '</div>';
  modes.insertBefore(card, modes.firstChild);

  card.querySelector('.t').onclick = function () { MT2.startToday(); };
  document.getElementById('mt-today-desc').onclick = function () { MT2.startToday(); };
  Array.prototype.forEach.call(card.querySelectorAll('#mt-today-lens button'), function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      MT2.startToday(b.getAttribute('data-len'));
    };
  });

  // 原有模式折叠
  var firstTitle = modes.querySelector('.section-title');
  if (firstTitle) {
    firstTitle.textContent = '';
    var head = document.createElement('div');
    head.className = 'mt-fold-h';
    head.id = 'mt-fold-head';
    head.textContent = '▸ 自定义训练（9 种模式）';
    firstTitle.parentNode.insertBefore(head, firstTitle);
    var grid = modes.querySelector('.mode-grid');
    grid.style.display = 'none';
    head.onclick = function () {
      var open = grid.style.display !== 'none';
      grid.style.display = open ? 'none' : '';
      head.textContent = (open ? '▸' : '▾') + ' 自定义训练（9 种模式）';
    };
  }
};

var _mtOrigUpdateHomeUI = updateHomeUI;
updateHomeUI = function () {
  _mtOrigUpdateHomeUI();
  MT2.injectHome();
  var d = document.getElementById('mt-today-desc');
  if (d) d.textContent = MT2.todayPlan();
  var lens = document.getElementById('mt-today-lens');
  if (lens) {
    var cur = MT2.cfg('sessionLen');
    Array.prototype.forEach.call(lens.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-len') === cur);
    });
  }
  // 弱项计数改用新的两类弱项
  var codes = getFilteredCodes();
  var s = MT2.deckSummary(currentDeckId, codes, 'fwd');
  var wc = document.getElementById('home-weak-count');
  if (wc) wc.textContent = s.wrongItems.length + s.slowItems.length;
};

// 结束页：补充本轮的新口径指标
var _mtOrigFinishSession = finishSession;
finishSession = function () {
  _mtOrigFinishSession();
  var box = document.getElementById('sum-weak-review');
  if (!box) return;
  var valid = mtSessionTrials.filter(function (t) { return !t.bg; });
  if (!valid.length) return;
  var scored = valid.filter(function (t) { return t.ok && !t.timedOut; }).map(function (t) { return t.ms; });
  var med = MT2.quantile(scored, 0.5), p90 = MT2.quantile(scored, 0.9);
  var calib = valid.filter(function (t) { return t.calib; });
  var extra = document.getElementById('mt-session-latency');
  if (!extra) {
    extra = document.createElement('div');
    extra.id = 'mt-session-latency';
    extra.className = 'mt-card';
    box.parentNode.insertBefore(extra, box);
  }
  extra.innerHTML = '<div class="mt-card-h">本轮提取延迟 <span class="mt-sub">只含 cue → 按键，不含核对时间</span></div>' +
    '<div class="mt-kpis">' +
      '<div class="mt-kpi"><div class="v">' + (med === null ? '—' : med.toFixed(2) + 's') + '</div><div class="l">中位</div></div>' +
      '<div class="mt-kpi"><div class="v">' + (p90 === null ? '—' : p90.toFixed(2) + 's') + '</div><div class="l">P90</div></div>' +
      '<div class="mt-kpi"><div class="v">' + Math.round(valid.filter(function (t) { return t.ok; }).length / valid.length * 100) + '%</div><div class="l">正确率</div></div>' +
      '<div class="mt-kpi"><div class="v">' + calib.length + '</div><div class="l">校准试次</div></div>' +
    '</div>' +
    (valid.length < mtSessionTrials.length
      ? '<div class="mt-note">' + (mtSessionTrials.length - valid.length) + ' 个试次因切到后台被作废。</div>' : '');
};

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
(function () {
  MT2.migrate();
  var inp = document.getElementById('mt-import-file');
  if (inp) {
    inp.addEventListener('change', function () {
      if (this.files && this.files[0]) {
        MT2.importData(this.files[0], this.getAttribute('data-mode') || 'merge');
      }
      this.value = ''; this.setAttribute('data-mode', 'merge');
    });
  }
  var cs = document.getElementById('mt-set-calib');
  if (cs) cs.value = String(MT2.cfg('calibRate'));
  var ss = document.getElementById('mt-set-speed');
  if (ss) ss.value = String(MT2.cfg('speedTarget'));
  showHome();
})();
