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
  if (!a.audioSeq) a.audioSeq = { len: 4, block: [] };
  if (!a.audioText) a.audioText = { tier: 0, block: [] };
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
DM.SECS = { random: 22, meaningful: 62, audioSeq: 26, audioText: 66 };

MT2.buildDirectPlan = function (seconds, modality) {
  modality = modality || 'visual';
  var plan = [], used = 0;
  var seqKind = modality === 'audio' ? 'audioSeq' : 'random';
  var txtKind = modality === 'audio' ? 'audioText' : 'meaningful';
  // 时间按 6:4 分给序列和文本材料，交错排
  var wantTxt = Math.max(1, Math.round(seconds * 0.4 / DM.SECS[txtKind]));
  var wantSeq = Math.max(2, Math.round(seconds * 0.6 / DM.SECS[seqKind]));
  var r = 0, m = 0;
  while (used < seconds && (r < wantSeq || m < wantTxt)) {
    if (r < wantSeq) { plan.push({ kind: seqKind, modality: modality }); used += DM.SECS[seqKind]; r++; }
    if (m < wantTxt && used < seconds) { plan.push({ kind: txtKind, modality: modality }); used += DM.SECS[txtKind]; m++; }
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
  // 到期的保持测试插在最前面，而且一次不超过 8 项，免得整轮都在补测
  DM.retentionBudget = (kind === 'baseline') ? 0 : Math.min(8, MT2.dueRetention().length);
  showScreen('direct');
  DM.runTrial();
};

MT2.startDirectTraining = function (minutes) {
  DM.start('training', MT2.buildDirectPlan((minutes || 5) * 60, 'visual'), null);
};

MT2.startAudioTraining = function (minutes) {
  if (!MT2.tts.supported()) {
    alert('听觉训练需要系统语音支持。\n\n' + MT2.tts.reason());
    return;
  }
  DM.start('training', MT2.buildDirectPlan((minutes || 5) * 60, 'audio'), null);
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
  // 到期的延迟保持测试优先。绝不在测试前重新呈现原文，否则测的是重学不是保持。
  while (DM.retentionBudget > 0) {
    var due = MT2.takeRetention();
    if (!due) break;
    var mat = MT2.MAT.findByText(due.itemId.replace(/^txt:/, ''));
    if (!mat) {
      // 材料已不在库里（比如换过词库）：丢弃这条，但不算用掉一次补测机会
      MT2.resolveRetention(due, null, 0);
      continue;
    }
    DM.retentionBudget--;
    {
      {
        DM.trial = {
          kind: 'delayed', entry: due, text: mat.text, keys: mat.keys, tier: mat.tier,
          cue: mat.text.slice(0, 3),
          actualDelayMs: Date.now() - due.createdTs,
          modality: due.modality || 'visual'
        };
        dmEl('dm-progress').textContent = '保持测试';
        DM.recall();
        return;
      }
    }
  }
  if (DM.idx >= DM.plan.length) { DM.finish(); return; }
  var spec = DM.plan[DM.idx];
  var a = MT2.dmAdaptive();
  var mod = spec.modality || 'visual';
  var t;
  if (spec.kind === 'random' || spec.kind === 'audioSeq') {
    var isAudio = spec.kind === 'audioSeq';
    var len = spec.len || (isAudio ? a.audioSeq.len : a.random.len);
    t = {
      kind: spec.kind, modality: mod, len: len,
      exposureMs: spec.exposureMs || MT2.dmCfg('randomExposureMs'),
      target: isAudio ? MT2.MAT.pickDigits(len) : MT2.MAT.pickChars(len),
      baseline: !!spec.baseline
    };
  } else {
    var tier = spec.tier !== undefined ? spec.tier
             : (spec.kind === 'audioText' ? a.audioText.tier : a.meaningful.tier);
    var item = MT2.MAT.pickText(tier);
    t = {
      kind: spec.kind, modality: mod, tier: item.tier, text: item.text, keys: item.keys,
      exposureMs: Math.round(item.text.length * MT2.dmCfg('msPerChar'))
    };
  }
  DM.trial = t;
  dmEl('dm-progress').textContent = (DM.idx + 1) + ' / ' + DM.plan.length;
  DM.expose();
};

DM.isSeq = function (t) { return t.kind === 'random' || t.kind === 'audioSeq'; };
DM.isText = function (t) { return t.kind === 'meaningful' || t.kind === 'audioText' || t.kind === 'delayed'; };

DM.expose = function () {
  var t = DM.trial;
  dmPanel('expose');
  dmEl('dm-phase').textContent = '呈现';
  var mat = dmEl('dm-material');
  var fill = dmEl('dm-bar-fill');

  if (t.modality === 'audio') {
    dmEl('dm-expose-hint').textContent = '只播一遍，不能重放。听完再回忆。';
    mat.innerHTML = '<div class="dm-audio"><div class="dm-audio-icon">🔊</div>' +
                    '<div class="dm-audio-label">播放中…</div></div>';
    fill.style.width = '100%';
    fill.classList.add('indeterminate');
    var payload = DM.isSeq(t) ? MT2.MAT.speakableSeq(t.target) : t.text;
    t.rate = MT2.cfg('audioRate') || 1;
    MT2.tts.speak(payload, { rate: t.rate }).then(function (ms) {
      if (!DM.active || DM.trial !== t) return;
      t.exposureMs = Math.round(ms);
      fill.classList.remove('indeterminate');
      mat.innerHTML = '';
      DM.recall();
    }).catch(function (e) {
      if (!DM.active || DM.trial !== t) return;
      fill.classList.remove('indeterminate');
      t.voided = true; t.voidReason = e.message;
      mat.innerHTML = '<div class="mt-warn">语音播放失败（' + e.message + '），本次作废。</div>';
      dmEl('dm-phase').textContent = '作废';
      setTimeout(function () {
        if (!DM.active) return;
        DM.idx++; DM.trial = null; DM.runTrial();
      }, 1600);
    });
    return;
  }

  dmEl('dm-expose-hint').textContent = DM.kind === 'baseline'
    ? '基线测试：只看，不要刻意编码'
    : (DM.isSeq(t) ? '看一遍就好，不要刻意编码' : '读一遍，不要刻意编码');
  if (DM.isSeq(t)) {
    mat.innerHTML = t.target.map(function (c) { return '<span class="ch">' + c + '</span>'; }).join('');
  } else {
    mat.innerHTML = '<div class="txt">' + t.text + '</div>';
  }
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
  if (DM.isSeq(t)) {
    seqWrap.style.display = ''; txt.style.display = 'none';
    dmEl('dm-recall-hint').textContent = t.kind === 'audioSeq'
      ? '按顺序写出刚才听到的 ' + t.len + ' 个数字'
      : '按顺序写出刚才那 ' + t.len + ' 个字';
    var inp = dmEl('dm-seq-input');
    inp.value = ''; dmEl('dm-typed').textContent = '';
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
  } else {
    seqWrap.style.display = 'none'; txt.style.display = '';
    if (t.kind === 'delayed') {
      dmEl('dm-recall-hint').innerHTML = '<b>保持测试</b> · ' + MT2.delayLabel(t.actualDelayMs) +
        '前的那一条，开头是「' + t.cue + '…」<br>写出你还记得的内容。原文不会再给你看。';
    } else {
      dmEl('dm-recall-hint').textContent = '尽量还原原文。想不起原话就写你记得的内容。';
    }
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
  if (DM.isSeq(t)) {
    t.answer = blank ? [] : DM.parseSeq(dmEl('dm-seq-input').value);
    t.score = MT2.MAT.scoreSeq(t.target, t.answer);
  } else if (t.kind === 'delayed') {
    t.answer = blank ? '' : dmEl('dm-text-input').value;
    // 线索里已经给了开头几个字，把这部分从逐字分的计算里剔掉
    t.score = MT2.MAT.scoreText(t.text.slice(t.cue.length), t.answer,
                                t.keys.filter(function (k) { return t.text.indexOf(k) >= t.cue.length; }));
    t.gist = null;
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
  if (DM.isSeq(t)) {
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
    if (t.kind === 'delayed') {
      h += '<div class="mt-note">' + MT2.delayLabel(t.actualDelayMs) + '前学的（实际间隔 ' +
           MT2.fmtDelay(t.actualDelayMs) + '）</div>';
    }
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
  if (DM.isSeq(t)) {
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
  if (DM.isText(t) && t.gist === null) return;
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
  if (t.voided) return;
  if (t.kind === 'delayed') {
    MT2.resolveRetention(t.entry, {
      keyword: t.score.keyword, verbatim: t.score.verbatim,
      order: t.score.order, gist: t.gist
    }, t.actualDelayMs);
    return;
  }
  var row = {
    ts: Date.now(), kind: t.kind, modality: t.modality || 'visual',
    exposureMs: t.exposureMs, recallMs: Math.round(t.recallMs || 0),
    baseline: !!t.baseline, session: DM.kind
  };
  if (t.rate) row.rate = t.rate;
  if (DM.isSeq(t)) {
    row.len = t.len;
    row.scores = { position: t.score.positionAcc, item: t.score.itemAcc, perfect: t.score.perfect ? 1 : 0 };
  } else {
    row.tier = t.tier; row.textRef = t.text.slice(0, 12);
    row.scores = { keyword: t.score.keyword, verbatim: t.score.verbatim,
                   order: t.score.order, gist: t.gist };
    // 延迟保持队列。测试时不重新呈现原文，否则测的是重学不是保持。
    MT2.enqueueRetention('txt:' + t.text, t.modality || 'visual');
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
  var lane = t.kind === 'random' ? a.random
           : t.kind === 'audioSeq' ? a.audioSeq
           : t.kind === 'audioText' ? a.audioText
           : a.meaningful;
  var val;
  if (DM.isSeq(t)) {
    val = t.score.itemAcc;
  } else {
    var sc = t.score;
    val = ((sc.keyword === null ? 0 : sc.keyword) + sc.verbatim + (t.gist === null ? 0 : t.gist)) / 3;
  }
  lane.block.push(val);
  if (lane.block.length < MT2.dmCfg('blockSize')) return;
  var m = lane.block.reduce(function (x, y) { return x + y; }, 0) / lane.block.length;
  if (DM.isSeq(t)) {
    if (m > MT2.dmCfg('upAt')) lane.len = Math.min(MT2.dmCfg('maxLen'), lane.len + 1);
    else if (m < MT2.dmCfg('downAt')) lane.len = Math.max(MT2.dmCfg('minLen'), lane.len - 1);
  } else {
    var floorTier = t.kind === 'audioText' ? 0 : 1;
    if (m > MT2.dmCfg('upAt')) lane.tier = Math.min(4, lane.tier + 1);
    else if (m < MT2.dmCfg('downAt')) lane.tier = Math.max(floorTier, lane.tier - 1);
  }
  lane.block = [];
  lane.lastAdjust = { ts: Date.now(), mean: m };
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
    var rand = DM.results.filter(function (t) { return DM.isSeq(t) && !t.voided; });
    var mean = DM.results.filter(function (t) { return (t.kind === 'meaningful' || t.kind === 'audioText') && !t.voided; });
    var del = DM.results.filter(function (t) { return t.kind === 'delayed'; });
    var voided = DM.results.filter(function (t) { return t.voided; });
    var isAudio = DM.results.length && DM.results[0].modality === 'audio';
    h += '<div class="mt-card"><div class="mt-card-h">本轮' + (isAudio ? '听觉' : '视觉') + '直接记忆</div>';
    if (rand.length) {
      var pos = rand.reduce(function (a, t) { return a + t.score.positionAcc; }, 0) / rand.length;
      var itm = rand.reduce(function (a, t) { return a + t.score.itemAcc; }, 0) / rand.length;
      var lane = isAudio ? MT2.dmAdaptive().audioSeq : MT2.dmAdaptive().random;
      h += '<div class="mt-note">' + (isAudio ? '数字串' : '随机序列') + ' ' + rand.length + ' 次</div><div class="mt-kpis">' +
           kpi('位置正确', Math.round(pos * 100) + '%') +
           kpi(isAudio ? '记住的数字' : '记住的字', Math.round(itm * 100) + '%') +
           kpi('当前长度', lane.len) + '</div>';
    }
    if (mean.length) {
      var kw = mean.reduce(function (a, t) { return a + (t.score.keyword || 0); }, 0) / mean.length;
      var vb = mean.reduce(function (a, t) { return a + t.score.verbatim; }, 0) / mean.length;
      var gs = mean.reduce(function (a, t) { return a + (t.gist || 0); }, 0) / mean.length;
      h += '<div class="mt-note" style="margin-top:10px">' + (isAudio ? '语音材料 ' : '有意义材料 ') + mean.length + ' 次</div><div class="mt-kpis">' +
           kpi('大意', Math.round(gs * 100) + '%') +
           kpi('关键词', Math.round(kw * 100) + '%') +
           kpi('逐字', Math.round(vb * 100) + '%') + '</div>';
    }
    if (del.length) {
      var dk = del.reduce(function (a, t) { return a + (t.score.keyword || 0); }, 0) / del.length;
      var dg = del.reduce(function (a, t) { return a + (t.gist || 0); }, 0) / del.length;
      h += '<div class="mt-note" style="margin-top:10px">延迟保持测试 ' + del.length + ' 次（' +
           del.map(function (t) { return MT2.delayLabel(t.actualDelayMs); }).join('、') + '）</div>' +
           '<div class="mt-kpis">' + kpi('大意', Math.round(dg * 100) + '%') +
           kpi('关键词', Math.round(dk * 100) + '%') + '</div>';
    }
    if (voided.length) {
      h += '<div class="mt-note">' + voided.length + ' 个试次因语音播放失败作废，不计入。</div>';
    }
    var st = MT2.retentionStatus();
    if (st.dueItems) h += '<div class="mt-note">还有 ' + st.dueItems + ' 项保持测试到期未测，下次训练会先补上。</div>';
    h += '<div class="mt-note">' + (isAudio
      ? '听一遍能留下多少，比随机序列容量更接近你实际在意的场景。'
      : '随机序列的进步主要停留在随机序列本身，不太会迁移到生词、诗词、歌词。判断整体是否变好，看有意义材料和听觉那两项。') +
      '</div></div>';
  }
  dmEl('dm-sum-body').innerHTML = h;
  if (DM.onDone) {
    btns = '<button class="primary" onclick="DM.continueSession()">继续今日训练 →</button>';
  } else {
    btns = '<button class="primary" onclick="showHome()">返回首页</button>';
    if (DM.kind === 'training') {
      var again = (DM.results.length && DM.results[0].modality === 'audio')
        ? 'MT2.startAudioTraining(5)' : 'MT2.startDirectTraining(5)';
      btns = '<button class="primary" onclick="' + again + '">再来 5 分钟</button>' + btns;
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
MT2.directSummary = function (days, modality) {
  var cutoff = Date.now() - (days || 100000) * 86400000;
  var mod = modality || 'visual';
  var tr = MT2.db.direct.trials.filter(function (t) {
    return t.ts >= cutoff && (t.modality || 'visual') === mod;
  });
  var seqKind = mod === 'audio' ? 'audioSeq' : 'random';
  var txtKind = mod === 'audio' ? 'audioText' : 'meaningful';
  var rand = tr.filter(function (t) { return t.kind === seqKind && !t.baseline; });
  var mean = tr.filter(function (t) { return t.kind === txtKind; });
  function avg(a, f) { return a.length ? a.reduce(function (x, t) { return x + (f(t) || 0); }, 0) / a.length : null; }
  var byLen = {};
  rand.forEach(function (t) {
    if (!byLen[t.len]) byLen[t.len] = [];
    byLen[t.len].push(t.scores.item);
  });
  Object.keys(byLen).forEach(function (L) {
    byLen[L] = byLen[L].reduce(function (a, b) { return a + b; }, 0) / byLen[L].length;
  });
  var a = MT2.dmAdaptive();
  var lane = mod === 'audio' ? a.audioSeq : a.random;
  var tlane = mod === 'audio' ? a.audioText : a.meaningful;
  var last = MT2.db.direct.baselines.filter(function (b) {
    return (b.modality || 'visual') === mod;
  }).slice(-1)[0] || null;
  return {
    modality: mod,
    trials: tr.length, randomN: rand.length, meaningfulN: mean.length,
    positionAcc: avg(rand, function (t) { return t.scores.position; }),
    itemAcc: avg(rand, function (t) { return t.scores.item; }),
    byLen: byLen,
    currentLen: lane.len,
    currentTier: tlane.tier,
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
