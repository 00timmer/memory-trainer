// ============================================================
// 三维度仪表盘 + 自动化地图
// 不给合成总分：三种能力改善速度不同，必须分开看。
// ============================================================
MT2.WINDOWS = [
  { key: '7',  label: '7 天',  days: 7 },
  { key: '30', label: '30 天', days: 30 },
  { key: '90', label: '90 天', days: 90 },
  { key: 'all', label: '全部', days: 100000 }
];

MT2.windowStats = function (deckId, codes, dir, days) {
  var cutoff = Date.now() - days * 86400000;
  var db = MT2.db.retrieval[deckId] || {};
  var scored = [], nOk = 0, nAll = 0, sOk = 0, sN = 0, cOk = 0, cN = 0;
  codes.forEach(function (c) {
    var r = (db[c] || {})[dir]; if (!r) return;
    r.trials.forEach(function (t) {
      if (t.bg || t.ts < cutoff) return;
      nAll++; if (t.ok) nOk++;
      if (t.ok && !t.timedOut) scored.push(t.ms);
      if (t.calib) { cN++; if (t.ok) cOk++; } else { sN++; if (t.ok) sOk++; }
    });
  });
  return {
    trials: nAll,
    median: MT2.quantile(scored, 0.5),
    p90: MT2.quantile(scored, 0.9),
    acc: nAll ? nOk / nAll : null,
    selfAcc: sN >= 15 ? sOk / sN : null,
    calibAcc: cN >= 15 ? cOk / cN : null,
    calibN: cN, selfN: sN
  };
};

function fmtS(v) { return v === null || v === undefined ? '—' : v.toFixed(2) + 's'; }
function fmtP(v) { return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }

MT2.renderDashboard = function () {
  var codes = getFilteredCodes();
  var deckId = currentDeckId;
  var el = document.getElementById('mt-dash-body');
  var h = '';

  // ---- 提取自动化 ----
  var s = MT2.deckSummary(deckId, codes, 'fwd');
  var rs = MT2.deckSummary(deckId, codes, 'rev');
  h += '<div class="mt-card"><div class="mt-card-h">提取自动化 <span class="mt-sub">已知的东西，取得多快</span></div>';
  if (!s.trials) {
    h += '<div class="mt-empty">还没有新口径的数据。练一轮「今日训练」后这里就有了。<br>' +
         '<span class="mt-note">旧版本的用时数据口径不同（含翻牌等待与评分时间），不与这里同图。</span></div>';
  } else {
    h += '<div class="mt-kpis">' +
      kpi('中位延迟', fmtS(s.median)) +
      kpi('P90', fmtS(s.p90)) +
      kpi('正确率', fmtP(s.acc)) +
      kpi('自动化占比', fmtP(s.autoPct)) +
      '</div>';
    h += '<div class="mt-kpis">' +
      kpi('错项', s.wrongItems.length, s.wrongItems.length ? '#f0574a' : '') +
      kpi('慢项', s.slowItems.length, s.slowItems.length ? '#f0883e' : '') +
      kpi('到期待练', s.dueItems.length) +
      kpi('反向中位', fmtS(rs.median)) +
      '</div>';
    h += '<div class="mt-statusbar">' + MT2.STATUS_LABEL.map(function (l, i) {
      var pct = codes.length ? s.byStatus[i] / codes.length * 100 : 0;
      var cols = ['#3a3f4b', '#e8c547', '#8bd450', '#3ddc84'];
      return '<div class="mt-statusseg" style="width:' + pct + '%;background:' + cols[i] + '" title="' + l + ' ' + s.byStatus[i] + '"></div>';
    }).join('') + '</div>';
    h += '<div class="mt-legend">' + MT2.STATUS_LABEL.map(function (l, i) {
      var cols = ['#3a3f4b', '#e8c547', '#8bd450', '#3ddc84'];
      return '<span><i style="background:' + cols[i] + '"></i>' + l + ' ' + s.byStatus[i] + '</span>';
    }).join('') + '</div>';

    // 自评放水检测
    var cc = MT2.calibrationCheck(deckId, codes, 'fwd');
    if (cc.enough) {
      if (cc.gap > 0.08) {
        h += '<div class="mt-warn">⚠️ 自评正确率 ' + fmtP(cc.selfAcc) + '，校准试次实测 ' + fmtP(cc.calibAcc) +
             '，相差 ' + Math.round(cc.gap * 100) + '%。说明「按键后再看答案判对」时在放水，延迟数据偏乐观。</div>';
      } else {
        h += '<div class="mt-good">✓ 自评 ' + fmtP(cc.selfAcc) + ' vs 校准实测 ' + fmtP(cc.calibAcc) + '，自评可信。</div>';
      }
    } else {
      h += '<div class="mt-note">校准试次样本还不够（自评 ' + cc.sN + ' / 校准 ' + cc.cN + '，各需 15 次）</div>';
    }

    // 趋势
    h += '<div class="mt-trend"><table><tr><th>窗口</th><th>试次</th><th>中位</th><th>P90</th><th>正确率</th></tr>';
    MT2.WINDOWS.forEach(function (w) {
      var ws = MT2.windowStats(deckId, codes, 'fwd', w.days);
      h += '<tr><td>' + w.label + '</td><td>' + ws.trials + '</td><td>' + fmtS(ws.median) +
           '</td><td>' + fmtS(ws.p90) + '</td><td>' + fmtP(ws.acc) + '</td></tr>';
    });
    h += '</table></div>';
    h += '<button class="mt-btn" onclick="MT2.showMap()">打开自动化地图 →</button>';
  }
  h += '</div>';

  // ---- 直接记忆 ----
  h += MT2.renderDirectCard('visual');
  h += MT2.renderDirectCard('audio');
  h += MT2.renderRetentionCard();

  // ---- 编码效率（P5）----
  h += '<div class="mt-card mt-pending"><div class="mt-card-h">编码效率 <span class="mt-sub">需要用方法时，建立稳定记忆有多快</span></div>' +
       '<div class="mt-empty">P5 阶段实现。将包含：编码耗时、24h/7d 保持、Effective Encoding Speed（编码耗时 ÷ 24h 保持率）、' +
       '3 组编码方法对照（样本 &lt;30 不给结论）。</div></div>';

  // ---- 旧口径历史 ----
  var old = getStats().slice(-7).reverse();
  if (old.length) {
    h += '<div class="mt-card"><div class="mt-card-h">历史记录 <span class="mt-sub">旧口径，仅供参考</span></div><div class="mt-oldstats">';
    h += old.map(function (d) {
      var acc = d.total > 0 ? Math.round(d.correct / d.total * 100) : 0;
      var avg = d.total > 0 ? (d.totalTime / d.total).toFixed(1) : '-';
      return '<div class="stats-row"><span>' + d.date + '</span><span>' + d.total + '题 | ' + acc + '% | 均' + avg + 's</span></div>';
    }).join('');
    h += '</div><div class="mt-note">2026-09-08 之前的用时包含翻牌等待与评分操作时间，不能与上面的延迟直接比较。</div></div>';
  }

  el.innerHTML = h;
};

function kpi(label, val, color) {
  return '<div class="mt-kpi"><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + val + '</div><div class="l">' + label + '</div></div>';
}

// ------------------------------------------------------------
// 自动化地图
// ------------------------------------------------------------
MT2.showMap = function () { showScreen('mt-map'); MT2.renderMap(); };

MT2.renderMap = function () {
  var codes = getFilteredCodes(), deckId = currentDeckId;
  var el = document.getElementById('mt-map-body');
  var h = '<div class="mt-maplegend">';
  MT2.TIERS.forEach(function (t) { h += '<span><i style="background:' + t.color + '"></i>' + t.label + '</span>'; });
  h += '<span><i style="background:#3a3f4b"></i>未测</span></div><div class="mt-grid">';
  codes.forEach(function (c) {
    var r = MT2.recRO(deckId, c, 'fwd');
    var tier = (r && r.median !== null) ? MT2.tierOf(r.median) : null;
    var bg = tier ? tier.color : '#3a3f4b';
    var w = MT2.weakRO(deckId, c, 'fwd');
    var mark = w.recall.active ? '✗' : w.speed.active ? '🐢' : '';
    h += '<div class="mt-cell" style="background:' + bg + '" onclick="MT2.mapDetail(\'' +
         String(c).replace(/'/g, "\\'") + '\')"><span class="c">' + formatCode(c) + '</span>' +
         '<span class="m">' + mark + '</span></div>';
  });
  h += '</div><div id="mt-map-detail" class="mt-detail"></div>';
  el.innerHTML = h;
};

MT2.mapDetail = function (code) {
  var deckId = currentDeckId;
  var box = document.getElementById('mt-map-detail');
  var h = '<h3>' + formatCode(code) + ' — ' + getName(code) + '</h3>';
  ['fwd', 'rev', 'multi'].forEach(function (dir) {
    var r = MT2.recRO(deckId, code, dir);
    if (!r) return;
    var valid = r.trials.filter(function (t) { return !t.bg; });
    if (!valid.length && r.status === 0) return;
    var tier = r.median !== null ? MT2.tierOf(r.median) : null;
    h += '<div class="mt-detrow"><b>' + MT2.DIR_LABEL[dir] + '</b> · ' +
         '中位 ' + fmtS(r.median) + ' · P90 ' + fmtS(r.p90) + ' · 正确率 ' + fmtP(r.acc) +
         ' · ' + valid.length + ' 次<br>' +
         '状态：' + MT2.STATUS_LABEL[r.status] + (tier ? ' · <span style="color:' + tier.color + '">' + tier.label + '</span>' : '') +
         (r.nextDue ? ' · 下次到期 ' + r.nextDue : '') + '</div>';
    var w = MT2.weakRO(deckId, code, dir);
    var tags = [];
    if (w.recall.active) tags.push('<span class="mt-tag bad">错项 ' + w.recall.clearedDays.length + '/3</span>');
    if (w.speed.active) tags.push('<span class="mt-tag slow">慢项</span>');
    var conf = Object.keys(w.confuse.wrongTargets);
    if (conf.length) {
      tags.push('<span class="mt-tag">易误答成：' + conf.map(function (k) {
        return getName(k) + '×' + w.confuse.wrongTargets[k];
      }).join('、') + '</span>');
    }
    if (tags.length) h += '<div class="mt-tags">' + tags.join('') + '</div>';
    var recent = valid.slice(-10).map(function (t) {
      var col = !t.ok ? '#f0574a' : (MT2.tierOf(t.ms) || {}).color;
      return '<i style="background:' + col + '" title="' + t.ms.toFixed(2) + 's' + (t.calib ? ' 校准' : '') + '"></i>';
    }).join('');
    if (recent) h += '<div class="mt-spark">最近：' + recent + '</div>';
  });
  if (h.indexOf('mt-detrow') === -1) h += '<div class="mt-note">这个编码还没有新口径的试次。</div>';
  box.innerHTML = h;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

MT2.renderDirectCard = function (mod) {
  var isA = mod === 'audio';
  var dm = MT2.directSummary(null, mod);
  var h = '<div class="mt-card"><div class="mt-card-h">' +
    (isA ? '听觉直接记忆 <span class="mt-sub">听一遍，能留下多少</span>'
         : '视觉直接记忆 <span class="mt-sub">看一遍，能留下多少</span>') + '</div>';

  if (isA && !MT2.tts.supported()) {
    h += '<div class="mt-warn">语音不可用：' + MT2.tts.reason() + '</div>';
    if (dm.trials) h += '<div class="mt-note">已有 ' + dm.trials + ' 次历史记录。</div>';
    return h + '<button class="mt-btn" onclick="MT2.ttsTest()">检测语音</button></div>';
  }
  if (!dm.trials) {
    h += '<div class="mt-empty">还没有数据。首页' + (isA ? '「听觉记忆」' : '「直接记忆」') + '练一轮' +
         (isA ? '。' : '，或先跑一次标准化基线。') + '</div>';
    return h + '</div>';
  }
  h += '<div class="mt-kpis">' +
    kpi(isA ? '数字串正确' : '视觉容量', isA ? fmtP(dm.itemAcc) : (dm.baseline ? dm.baseline.capacityText : '—')) +
    kpi(isA ? '位置正确' : '记住的字', fmtP(isA ? dm.positionAcc : dm.itemAcc)) +
    kpi('当前长度', dm.currentLen) +
    kpi('试次', dm.trials) + '</div>';
  if (dm.meaningfulN) {
    h += '<div class="mt-note">' + (isA ? '语音材料' : '有意义材料') + '（' + dm.meaningfulN +
         ' 次，当前难度 T' + dm.currentTier + '）</div><div class="mt-kpis">' +
      kpi('大意', fmtP(dm.gist)) + kpi('关键词', fmtP(dm.keyword)) +
      kpi('逐字', fmtP(dm.verbatim)) + kpi('顺序', fmtP(dm.order)) + '</div>';
  }
  if (Object.keys(dm.byLen).length) {
    h += '<div class="mt-note">各长度正确率（自适应，不是基线）</div>' + MT2.renderCurve(dm.byLen);
  }
  if (!isA) {
    if (dm.baseline) {
      h += '<div class="mt-note">最近一次基线 ' + new Date(dm.baseline.ts).toISOString().slice(0, 10) +
           '（曝光 ' + (dm.baseline.exposureMs / 1000).toFixed(1) + 's）</div>' + MT2.renderCurve(dm.baseline.byLen);
      var bl = MT2.db.direct.baselines.filter(function (b) { return (b.modality || 'visual') === 'visual'; });
      if (bl.length >= 2) {
        var prev = bl[bl.length - 2], cur = bl[bl.length - 1];
        h += MT2.baselineComparable(prev, cur)
          ? '<div class="mt-note">上次 ' + prev.capacityText + ' → 这次 ' + cur.capacityText + '</div>'
          : '<div class="mt-warn">上一次基线的条件和这次不同，两个容量数字不可比。</div>';
      } else {
        h += '<div class="mt-note">只有一次基线，还没有对照。建议 7 / 30 / 90 天后同条件重跑。</div>';
      }
    } else {
      h += '<div class="mt-warn">还没跑过标准化基线。日常训练的长度是自适应的，不能当基线用 —— ' +
           '要看容量有没有变，需要固定条件重跑同一套测试。</div>';
    }
    h += '<div class="mt-note">随机序列的进步主要停留在随机序列本身，不太会迁移到生词、诗词、歌词。' +
         '判断整体记忆是否变好，看有意义材料和听觉那几项。</div>';
    h += '<button class="mt-btn" onclick="MT2.startBaseline()">跑一次标准化基线</button>';
  } else {
    var rates = {};
    MT2.db.direct.trials.forEach(function (t) { if (t.rate) rates[t.rate] = 1; });
    if (Object.keys(rates).length > 1) {
      h += '<div class="mt-warn">历史数据里出现过不同的语速（' + Object.keys(rates).join('、') +
           '），不同语速的成绩不能直接比。</div>';
    }
  }
  return h + '</div>';
};

MT2.renderRetentionCard = function () {
  var st = MT2.retentionStatus();
  var curve = MT2.retentionCurve();
  var order = MT2.RETENTION_BUCKETS.filter(function (b) { return curve[b.key]; });
  var h = '<div class="mt-card"><div class="mt-card-h">保持曲线 ' +
          '<span class="mt-sub">学完之后还剩多少</span></div>';
  if (!order.length) {
    h += '<div class="mt-empty">还没有保持数据。练过有意义材料之后，30 秒 / 5 分钟 / 24 小时 / 3 天 / 7 天' +
         '会自动排进队列，下次训练时优先补测。</div>';
  } else {
    h += '<div class="mt-retention">' + order.map(function (b) {
      var c = curve[b.key];
      return '<div class="mt-retention-row"><span class="lab">' + b.label + '</span>' +
        '<span class="track"><span class="fill" style="width:' + (c.keyword * 100) + '%"></span></span>' +
        '<span class="val">' + Math.round(c.keyword * 100) + '% · n=' + c.n + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="mt-note">显示的是关键词命中率，按<b>真实经过时间</b>分桶，不是按预定档位 —— ' +
         '标称 24 小时但实际隔了 4 天的，会记到 3 天那一桶。</div>';
  }
  h += '<div class="mt-kpis">' + kpi('已测', st.tested) +
       kpi('到期待测', st.dueItems, st.dueItems ? '#f0883e' : '') +
       kpi('排队中', st.pending) + '</div>';
  if (st.dueItems) {
    h += '<div class="mt-note">到期的会在下次训练开头优先补测（一轮最多 8 项）。' +
         '测试前不会再给你看原文。</div>';
  }
  return h + '</div>';
};

MT2.showDash = function () { showScreen('mt-dash'); MT2.renderDashboard(); };
