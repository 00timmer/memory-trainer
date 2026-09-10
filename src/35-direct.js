// ============================================================
// SYSTEM A — 直接记忆
// 呈现一次 → 隐藏 → 自主回忆。不刻意编码。
// 注意：随机序列的容量训练迁移有限（练随机汉字串主要提升随机汉字串本身）。
// 用户 2026-09-08 决定保留它作为日常训练科目；有意义材料与听觉才是主要杠杆。
// ============================================================
var DM = {
  active: false, kind: '', plan: [], idx: 0, trial: null,
  results: [], exposeTimer: null, exposeRAF: null, onDone: null, aborted: false
};

MT2.DM_DEFAULTS = {
  minLen: 3, maxLen: 12,
  randomExposureMs: 3000,      // 日常训练的曝光时长
  msPerChar: 300,              // 有意义材料按字数折算曝光
  blockSize: 5,                // 每 5 试次调一次难度
  upAt: 0.90, downAt: 0.60,
  baselineExposureMs: 3000,    // 基线条件锁死，不可调
  baselineLens: [3, 4, 5, 6, 7],
  baselineReps: 5,
  capacityThreshold: 0.775     // 维持 ~75–80% 正确率的最大长度
};
MT2.dmCfg = function (k) {
  var v = (MT2.db.settings.dm || {})[k];
  return v === undefined ? MT2.DM_DEFAULTS[k] : v;
};

MT2.dmAdaptive = function () {
  var a = MT2.db.direct.adaptive;
  if (!a.random) a.random = { len: 4, block: [] };
  if (!a.meaningful) a.meaningful = { tier: 1, block: [] };
  return a;
};

function dmEl(id) { return document.getElementById(id); }
function dmPanel(name) {
  ['dm-expose', 'dm-recall', 'dm-feedback', 'dm-summary'].forEach(function (p) {
    dmEl(p).style.display = (p === 'dm-' + name ? 'block' : 'none');
  });
}

// ------------------------------------------------------------
// 计划构建
// ------------------------------------------------------------
DM.SECS = { random: 22, meaningful: 62 };

MT2.buildDirectPlan = function (seconds) {
  var a = MT2.dmAdaptive(), plan = [], used = 0;
  // 时间按 6:4 分给随机序列和有意义材料，交错排
  var wantMeaning = Math.max(1, Math.round(seconds * 0.4 / DM.SECS.meaningful));
  var wantRandom = Math.max(2, Math.round(seconds * 0.6 / DM.SECS.random));
  var r = 0, m = 0;
  while (used < seconds && (r < wantRandom || m < wantMeaning)) {
    if (r < wantRandom) { plan.push({ kind: 'random' }); used += DM.SECS.random; r++; }
    if (m < wantMeaning && used < seconds) { plan.push({ kind: 'meaningful' }); used += DM.SECS.meaningful; m++; }
  }
  return plan;
};

MT2.buildBaselinePlan = function () {
  var plan = [];
  MT2.dmCfg('baselineLens').forEach(function (len) {
    for (var i = 0; i < MT2.dmCfg('baselineReps'); i++) {
      plan.push({ kind: 'random', len: len, exposureMs: MT2.dmCfg('baselineExposureMs'), baseline: true });
    }
  });
  return shuffle(plan);
};

// ------------------------------------------------------------
// 启动
// ------------------------------------------------------------
DM.start = function (kind, plan, onDone) {
  DM.active = true; DM.kind = kind; DM.plan = plan; DM.idx = 0;
  DM.results = []; DM.aborted = false; DM.onDone = onDone || null;
  showScreen('direct');
  DM.runTrial();
};

MT2.startDirectTraining = function (minutes) {
  var plan = MT2.buildDirectPlan((minutes || 5) * 60);
  DM.start('training', plan, null);
};

MT2.startBaseline = function () {
  var n = MT2.dmCfg('baselineLens').length * MT2.dmCfg('baselineReps');
  if (!confirm('标准化基线测试：' + n + ' 个试次，曝光固定 ' +
      (MT2.dmCfg('baselineExposureMs') / 1000).toFixed(1) + ' 秒，长度 ' +
      MT2.dmCfg('baselineLens').join('/') + ' 各 ' + MT2.dmCfg('baselineReps') + ' 次。\n\n' +
      '条件锁死不可调，中途退出会作废。大约需要 6–8 分钟。\n\n开始？')) return;
  DM.start('baseline', MT2.buildBaselinePlan(), null);
};

// ------------------------------------------------------------
// 单个试次
// ------------------------------------------------------------
DM.runTrial = function () {
  if (DM.idx >= DM.plan.length) { DM.finish(); return; }
  var spec = DM.plan[DM.idx];
  var a = MT2.dmAdaptive();
  var t;
  if (spec.kind === 'random') {
    var len = spec.len || a.random.len;
    t = {
      kind: 'random', len: len,
      exposureMs: spec.exposureMs || MT2.dmCfg('randomExposureMs'),
      target: MT2.MAT.pickChars(len),
      baseline: !!spec.baseline
    };
  } else {
    var item = MT2.MAT.pickText(spec.tier || a.meaningful.tier);
    t = {
      kind: 'meaningful', tier: item.tier, text: item.text, keys: item.keys,
      exposureMs: Math.round(item.text.length * MT2.dmCfg('msPerChar'))
    };
  }
  DM.trial = t;
  dmEl('dm-progress').textContent = (DM.idx + 1) + ' / ' + DM.plan.length;
  DM.expose();
};

DM.expose = function () {
  var t = DM.trial;
  dmPanel('expose');
  dmEl('dm-phase').textContent = '呈现';
  dmEl('dm-expose-hint').textContent = DM.kind === 'baseline'
    ? '基线测试：只看，不要刻意编码'
    : (t.kind === 'random' ? '看一遍就好，不要刻意编码' : '读一遍，不要刻意编码');
  var mat = dmEl('dm-material');
  if (t.kind === 'random') {
    mat.innerHTML = t.target.map(function (c) { return '<span class="ch">' + c + '</span>'; }).join('');
  } else {
    mat.innerHTML = '<div class="txt">' + t.text + '</div>';
  }
  var fill = dmEl('dm-bar-fill');
  fill.style.width = '100%';
  var st = performance.now(), dur = t.exposureMs;
  cancelAnimationFrame(DM.exposeRAF);
  (function tick() {
    var p = Math.max(0, 1 - (performance.now() - st) / dur);
    fill.style.width = (p * 100) + '%';
    if (p > 0 && DM.active) DM.exposeRAF = requestAnimationFrame(tick);
  })();
  clearTimeout(DM.exposeTimer);
  DM.exposeTimer = setTimeout(function () {
    if (!DM.active) return;
    mat.innerHTML = '';
    DM.recall();
  }, dur);
};

DM.recall = function () {
  var t = DM.trial;
  dmPanel('recall');
  dmEl('dm-phase').textContent = '回忆';
  t.recallStart = performance.now();
  var seqWrap = dmEl('dm-seq-input-wrap'), txt = dmEl('dm-text-input');
  if (t.kind === 'random') {
    seqWrap.style.display = ''; txt.style.display = 'none';
    dmEl('dm-recall-hint').textContent = '按顺序写出刚才那 ' + t.len + ' 个字';
    var inp = dmEl('dm-seq-input');
    inp.value = ''; dmEl('dm-typed').textContent = '';
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
  } else {
    seqWrap.style.display = 'none'; txt.style.display = '';
    dmEl('dm-recall-hint').textContent = '尽量还原原文。想不起原话就写你记得的内容。';
    txt.value = '';
    setTimeout(function () { try { txt.focus(); } catch (e) {} }, 60);
  }
};

DM.parseSeq = function (s) {
  return (s || '').replace(/[\s,，、。;；]/g, '').split('');
};

DM.submit = function (blank) {
  if (!DM.active || !DM.trial || DM.trial.scored) return;
  var t = DM.trial;
  t.recallMs = t.recallStart ? performance.now() - t.recallStart : null;
  if (t.kind === 'random') {
    t.answer = blank ? [] : DM.parseSeq(dmEl('dm-seq-input').value);
    t.score = MT2.MAT.scoreSeq(t.target, t.answer);
  } else {
    t.answer = blank ? '' : dmEl('dm-text-input').value;
    t.score = MT2.MAT.scoreText(t.text, t.answer, t.keys);
    t.gist = null;
  }
  t.scored = true;
  DM.feedback();
};

DM.feedback = function () {
  var t = DM.trial;
  dmPanel('feedback');
  dmEl('dm-phase').textContent = '核对';
  var h = '';
  if (t.kind === 'random') {
    h += '<div class="dm-cmp">';
    for (var i = 0; i < t.len; i++) {
      var got = t.answer[i], want = t.target[i];
      var good = got === want;
      h += '<div class="dm-slot ' + (good ? 'ok' : 'bad') + '">' + want +
           '<span class="sub">' + (good ? '✓' : (got ? got : '—')) + '</span></div>';
    }
    h += '</div>';
    if (t.answer.length > t.len) {
      h += '<div class="mt-note" style="text-align:center">多写了 ' + (t.answer.length - t.len) + ' 个字</div>';
    }
    h += '<div class="dm-scores">' +
         kpi('位置正确', t.score.positions + '/' + t.len) +
         kpi('记住的字', t.score.items + '/' + t.len) +
         kpi('顺序', t.score.items ? Math.round(t.score.positions / t.score.items * 100) + '%' : '—') +
         '</div>';
    if (t.score.items > t.score.positions) {
      h += '<div class="mt-note">字记住了但位置错了 —— 项目记忆比顺序记忆强，这两件事是分开的。</div>';
    }
    dmEl('dm-gist').style.display = 'none';
  } else {
    var marked = t.text;
    t.keys.forEach(function (k) { marked = marked.split(k).join('<mark>' + k + '</mark>'); });
    h += '<div class="mt-note">原文</div><div class="dm-orig">' + marked + '</div>';
    h += '<div class="mt-note">你写的</div><div class="dm-yours">' +
         (t.answer ? t.answer.replace(/</g, '&lt;') : '（空）') + '</div>';
    h += '<div class="dm-scores">' +
         kpi('关键词', Math.round((t.score.keyword || 0) * 100) + '%') +
         kpi('逐字', Math.round(t.score.verbatim * 100) + '%') +
         kpi('顺序', t.score.order === null ? '—' : Math.round(t.score.order * 100) + '%') +
         '</div>';
    dmEl('dm-gist').style.display = '';
    Array.prototype.forEach.call(dmEl('dm-gist').querySelectorAll('button'), function (b) {
      b.classList.remove('on');
    });
    dmEl('dm-next-btn').disabled = true;
    dmEl('dm-next-btn').style.opacity = '.45';
  }
  dmEl('dm-fb-body').innerHTML = h;
  if (t.kind === 'random') {
    dmEl('dm-next-btn').disabled = false;
    dmEl('dm-next-btn').style.opacity = '';
  }
};

DM.setGist = function (v) {
  if (!DM.trial) return;
  DM.trial.gist = v;
  Array.prototype.forEach.call(dmEl('dm-gist').querySelectorAll('button'), function (b, i) {
    b.classList.toggle('on', [1, 0.5, 0][i] === v);
  });
  dmEl('dm-next-btn').disabled = false;
  dmEl('dm-next-btn').style.opacity = '';
};

DM.next = function () {
  var t = DM.trial;
  if (!t || !t.scored) return;
  if (t.kind === 'meaningful' && t.gist === null) return;
  DM.record(t);
  DM.results.push(t);
  DM.idx++;
  DM.trial = null;
  DM.runTrial();
};

// ------------------------------------------------------------
// 记录
// ------------------------------------------------------------
DM.record = function (t) {
  var row = {
    ts: Date.now(), kind: t.kind, modality: 'visual',
    exposureMs: t.exposureMs, recallMs: Math.round(t.recallMs || 0),
    baseline: !!t.baseline, session: DM.kind
  };
  if (t.kind === 'random') {
    row.len = t.len;
    row.scores = { position: t.score.positionAcc, item: t.score.itemAcc, perfect: t.score.perfect ? 1 : 0 };
  } else {
    row.tier = t.tier; row.textRef = t.text.slice(0, 12);
    row.scores = { keyword: t.score.keyword, verbatim: t.score.verbatim,
                   order: t.score.order, gist: t.gist };
    // 延迟保持队列（P4 消费）。不在这里重新呈现原文，否则测的是重学不是保持。
    [['30s', 30e3], ['5min', 300e3], ['24h', 864e5], ['3d', 2592e5]].forEach(function (d) {
      MT2.db.queue.push({ itemId: 'txt:' + t.text, source: 'direct', label: d[0],
                          dueTs: Date.now() + d[1], createdTs: Date.now() });
    });
  }
  MT2.db.direct.trials.push(row);
  if (MT2.db.direct.trials.length > 3000) {
    MT2.db.direct.trials = MT2.db.direct.trials.slice(-3000);
  }
  if (DM.kind === 'training') DM.adapt(t);
  MT2.save();
};

// 块级自适应：每 blockSize 个试次调一次，不因单次运气好坏就动难度
DM.adapt = function (t) {
  var a = MT2.dmAdaptive();
  if (t.kind === 'random') {
    a.random.block.push(t.score.itemAcc);
    if (a.random.block.length >= MT2.dmCfg('blockSize')) {
      var m = a.random.block.reduce(function (x, y) { return x + y; }, 0) / a.random.block.length;
      if (m > MT2.dmCfg('upAt')) a.random.len = Math.min(MT2.dmCfg('maxLen'), a.random.len + 1);
      else if (m < MT2.dmCfg('downAt')) a.random.len = Math.max(MT2.dmCfg('minLen'), a.random.len - 1);
      a.random.block = [];
      a.random.lastAdjust = { ts: Date.now(), mean: m, newLen: a.random.len };
    }
  } else {
    var s = t.score;
    var composite = ((s.keyword === null ? 0 : s.keyword) + s.verbatim + (t.gist === null ? 0 : t.gist)) / 3;
    a.meaningful.block.push(composite);
    if (a.meaningful.block.length >= MT2.dmCfg('blockSize')) {
      var mm = a.meaningful.block.reduce(function (x, y) { return x + y; }, 0) / a.meaningful.block.length;
      if (mm > MT2.dmCfg('upAt')) a.meaningful.tier = Math.min(4, a.meaningful.tier + 1);
      else if (mm < MT2.dmCfg('downAt')) a.meaningful.tier = Math.max(1, a.meaningful.tier - 1);
      a.meaningful.block = [];
    }
  }
};

// ------------------------------------------------------------
// 结束
// ------------------------------------------------------------
DM.finish = function () {
  DM.active = false;
  clearTimeout(DM.exposeTimer); cancelAnimationFrame(DM.exposeRAF);
  dmPanel('summary');
  dmEl('dm-phase').textContent = '完成';
  var h = '', btns = '';
  if (DM.kind === 'baseline') {
    var b = MT2.saveBaseline(DM.results);
    h += '<div class="mt-card"><div class="mt-card-h">标准化基线</div>' +
         '<div style="text-align:center;margin:10px 0"><div class="dm-cap">' + b.capacityText + '</div>' +
         '<div class="mt-note" style="text-align:center">直接记忆容量（维持 ' +
         Math.round(MT2.dmCfg('capacityThreshold') * 100) + '% 正确率的最大长度）</div></div>' +
         MT2.renderCurve(b.byLen) +
         '<div class="mt-note">曝光固定 ' + (b.exposureMs / 1000).toFixed(1) + 's，' +
         b.lens.join('/') + ' 各 ' + b.reps + ' 次。下次重跑必须同样条件才能比。</div>';
    var prev = MT2.db.direct.baselines.slice(-2)[0];
    if (prev && prev.ts !== b.ts) {
      h += '<div class="mt-note">上次（' + new Date(prev.ts).toISOString().slice(0, 10) + '）：' +
           prev.capacityText + (MT2.baselineComparable(prev, b) ? '' : ' —— 条件不同，不可比') + '</div>';
    }
    h += '</div>';
  } else {
    var rand = DM.results.filter(function (t) { return t.kind === 'random'; });
    var mean = DM.results.filter(function (t) { return t.kind === 'meaningful'; });
    h += '<div class="mt-card"><div class="mt-card-h">本轮直接记忆</div>';
    if (rand.length) {
      var pos = rand.reduce(function (a, t) { return a + t.score.positionAcc; }, 0) / rand.length;
      var itm = rand.reduce(function (a, t) { return a + t.score.itemAcc; }, 0) / rand.length;
      h += '<div class="mt-note">随机序列 ' + rand.length + ' 次</div><div class="mt-kpis">' +
           kpi('位置正确', Math.round(pos * 100) + '%') +
           kpi('记住的字', Math.round(itm * 100) + '%') +
           kpi('当前长度', MT2.dmAdaptive().random.len) + '</div>';
    }
    if (mean.length) {
      var kw = mean.reduce(function (a, t) { return a + (t.score.keyword || 0); }, 0) / mean.length;
      var vb = mean.reduce(function (a, t) { return a + t.score.verbatim; }, 0) / mean.length;
      var gs = mean.reduce(function (a, t) { return a + (t.gist || 0); }, 0) / mean.length;
      h += '<div class="mt-note" style="margin-top:10px">有意义材料 ' + mean.length + ' 次</div><div class="mt-kpis">' +
           kpi('大意', Math.round(gs * 100) + '%') +
           kpi('关键词', Math.round(kw * 100) + '%') +
           kpi('逐字', Math.round(vb * 100) + '%') + '</div>';
    }
    h += '<div class="mt-note">随机序列的进步主要停留在随机序列本身，不太会迁移到生词、诗词、歌词。' +
         '判断整体是否变好，看有意义材料和听觉那两项。</div></div>';
  }
  dmEl('dm-sum-body').innerHTML = h;
  if (DM.onDone) {
    btns = '<button class="primary" onclick="DM.continueSession()">继续今日训练 →</button>';
  } else {
    btns = '<button class="primary" onclick="showHome()">返回首页</button>';
    if (DM.kind === 'training') {
      btns = '<button class="primary" onclick="MT2.startDirectTraining(5)">再来 5 分钟</button>' + btns;
    }
  }
  dmEl('dm-sum-btns').innerHTML = btns;
};

DM.continueSession = function () {
  var cb = DM.onDone; DM.onDone = null;
  if (cb) cb();
};

DM.quit = function () {
  if (DM.active && DM.idx > 0 && DM.kind === 'baseline') {
    if (!confirm('基线测试中途退出会作废本次结果。确定退出？')) return;
    DM.aborted = true;
  }
  DM.active = false;
  clearTimeout(DM.exposeTimer); cancelAnimationFrame(DM.exposeRAF);
  var cb = DM.onDone; DM.onDone = null;
  if (cb) { cb(); return; }
  showHome();
};

// ------------------------------------------------------------
// 基线：容量估计
// ------------------------------------------------------------
MT2.computeCapacity = function (byLen) {
  var thr = MT2.dmCfg('capacityThreshold');
  var lens = Object.keys(byLen).map(Number).sort(function (a, b) { return a - b; });
  if (!lens.length) return { value: null, text: '—' };
  var first = lens[0];
  if (byLen[first] < thr) return { value: null, text: '< ' + first, below: true };
  for (var i = 1; i < lens.length; i++) {
    var lo = lens[i - 1], hi = lens[i];
    if (byLen[hi] < thr) {
      var span = byLen[lo] - byLen[hi];
      var frac = span > 0 ? (byLen[lo] - thr) / span : 0;
      var v = lo + frac * (hi - lo);
      return { value: v, text: v.toFixed(1) };
    }
  }
  var top = lens[lens.length - 1];
  return { value: top, text: '≥ ' + top, ceiling: true };
};

MT2.saveBaseline = function (results) {
  var byLen = {}, counts = {};
  results.forEach(function (t) {
    byLen[t.len] = (byLen[t.len] || 0) + t.score.itemAcc;
    counts[t.len] = (counts[t.len] || 0) + 1;
  });
  Object.keys(byLen).forEach(function (L) { byLen[L] = byLen[L] / counts[L]; });
  var cap = MT2.computeCapacity(byLen);
  var b = {
    ts: Date.now(), byLen: byLen, counts: counts,
    capacity: cap.value, capacityText: cap.text,
    exposureMs: MT2.dmCfg('baselineExposureMs'),
    lens: MT2.dmCfg('baselineLens').slice(),
    reps: MT2.dmCfg('baselineReps'),
    threshold: MT2.dmCfg('capacityThreshold'),
    modality: 'visual', material: 'chars'
  };
  MT2.db.direct.baselines.push(b);
  MT2.save();
  return b;
};

// 条件不同的基线不可比 —— 曝光时长或长度集合变了，数字就没有意义
MT2.baselineComparable = function (a, b) {
  return a.exposureMs === b.exposureMs &&
         a.reps === b.reps &&
         a.material === b.material &&
         a.modality === b.modality &&
         a.lens.join(',') === b.lens.join(',');
};

MT2.renderCurve = function (byLen) {
  var lens = Object.keys(byLen).map(Number).sort(function (a, b) { return a - b; });
  var thr = MT2.dmCfg('capacityThreshold');
  return '<div class="dm-curve">' + lens.map(function (L) {
    var v = byLen[L];
    return '<div class="dm-curve-row"><span class="lab">' + L + ' 项</span>' +
           '<span class="track"><span class="fill" style="width:' + (v * 100) + '%;background:' +
           (v >= thr ? '#3ddc84' : '#f0883e') + '"></span></span>' +
           '<span class="val">' + Math.round(v * 100) + '%</span></div>';
  }).join('') + '</div>';
};

// ------------------------------------------------------------
// 聚合（仪表盘用）
// ------------------------------------------------------------
MT2.directSummary = function (days) {
  var cutoff = Date.now() - (days || 100000) * 86400000;
  var tr = MT2.db.direct.trials.filter(function (t) { return t.ts >= cutoff; });
  var rand = tr.filter(function (t) { return t.kind === 'random' && !t.baseline; });
  var mean = tr.filter(function (t) { return t.kind === 'meaningful'; });
  function avg(a, f) { return a.length ? a.reduce(function (x, t) { return x + (f(t) || 0); }, 0) / a.length : null; }
  var byLen = {};
  rand.forEach(function (t) {
    if (!byLen[t.len]) byLen[t.len] = [];
    byLen[t.len].push(t.scores.item);
  });
  Object.keys(byLen).forEach(function (L) {
    byLen[L] = byLen[L].reduce(function (a, b) { return a + b; }, 0) / byLen[L].length;
  });
  var last = MT2.db.direct.baselines.slice(-1)[0] || null;
  return {
    trials: tr.length, randomN: rand.length, meaningfulN: mean.length,
    positionAcc: avg(rand, function (t) { return t.scores.position; }),
    itemAcc: avg(rand, function (t) { return t.scores.item; }),
    byLen: byLen,
    currentLen: MT2.dmAdaptive().random.len,
    currentTier: MT2.dmAdaptive().meaningful.tier,
    gist: avg(mean, function (t) { return t.scores.gist; }),
    keyword: avg(mean, function (t) { return t.scores.keyword; }),
    verbatim: avg(mean, function (t) { return t.scores.verbatim; }),
    order: avg(mean, function (t) { return t.scores.order; }),
    baseline: last
  };
};

// 键盘：Enter 提交，空格继续
document.addEventListener('keydown', function (e) {
  if (!DM.active) return;
  if (document.getElementById('screen-direct').style.display === 'none') return;
  if (dmEl('dm-recall').style.display !== 'none' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); DM.submit();
  } else if (dmEl('dm-feedback').style.display !== 'none' && e.code === 'Space') {
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    e.preventDefault(); DM.next();
  }
}, true);
