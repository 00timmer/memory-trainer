// ============================================================
// SYSTEM C — 提取自动化
// 按 code + direction 分开记录。延迟只包含 cue → 按键承诺。
// ============================================================

MT2.dirOf = function (cardType) {
  if (cardType === 'reverse') return 'rev';
  if (cardType === 'multi') return 'multi';
  return 'fwd';
};

MT2.rec = function (deckId, code, dir) {
  var db = MT2.db.retrieval;
  if (!db[deckId]) db[deckId] = {};
  if (!db[deckId][code]) db[deckId][code] = {};
  if (!db[deckId][code][dir]) {
    db[deckId][code][dir] = {
      trials: [], median: null, p90: null, acc: null,
      status: 0, fastDays: [], lastSeen: null, nextDue: null
    };
  }
  return db[deckId][code][dir];
};

MT2.weak = function (deckId, code, dir) {
  var db = MT2.db.weakness;
  if (!db[deckId]) db[deckId] = {};
  if (!db[deckId][code]) db[deckId][code] = {};
  if (!db[deckId][code][dir]) {
    db[deckId][code][dir] = {
      recall:  { active: false, since: null, clearedDays: [] },
      speed:   { active: false, since: null, clearedDays: [] },
      confuse: { wrongTargets: {} },
      graduated: false
    };
  }
  return db[deckId][code][dir];
};

MT2.EMPTY_WEAK = {
  recall: { active: false, since: null, clearedDays: [] },
  speed:  { active: false, since: null, clearedDays: [] },
  confuse:{ wrongTargets: {} }, graduated: false
};
// 只读访问：渲染/统计时用，不创建空记录
MT2.weakRO = function (deckId, code, dir) {
  var d = MT2.db.weakness[deckId];
  var c = d && d[code];
  return (c && c[dir]) || MT2.EMPTY_WEAK;
};
MT2.recRO = function (deckId, code, dir) {
  var d = MT2.db.retrieval[deckId];
  var c = d && d[code];
  return (c && c[dir]) || null;
};

// 只统计有效试次：排除切后台的试次
function mtValid(trials) { return trials.filter(function (t) { return !t.bg; }); }
// 计入延迟分布的试次：正确 且 非超时 且 非后台
function mtScored(trials) {
  return trials.filter(function (t) { return !t.bg && t.ok && !t.timedOut; });
}
function mtQuantile(arr, q) {
  if (!arr.length) return null;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}
MT2.quantile = mtQuantile;

MT2.recompute = function (r) {
  var valid = mtValid(r.trials);
  var scored = mtScored(r.trials).map(function (t) { return t.ms; });
  r.acc = valid.length ? valid.filter(function (t) { return t.ok; }).length / valid.length : null;
  r.median = mtQuantile(scored, 0.5);
  r.p90 = mtQuantile(scored, 0.9);

  var recent = valid.slice(-MT2.RECENT);
  var recentScored = mtScored(r.trials).slice(-MT2.RECENT).map(function (t) { return t.ms; });
  var recentAcc = recent.length ? recent.filter(function (t) { return t.ok; }).length / recent.length : 0;
  var recentMed = mtQuantile(recentScored, 0.5);
  var target = MT2.cfg('speedTarget');

  var status = 0;
  if (valid.length >= 3) {
    if (recentAcc >= 0.8) status = 1;
    if (status === 1 && recentMed !== null && recentMed < target) status = 2;
    if (status === 2 && r.fastDays.length >= 3) status = 3;
  }
  r.status = status;
  return r;
};

// 记录一次试次，并更新弱项与到期时间
// trial: { ms, ok, vague, calib, timedOut, bg, mode, dir }
MT2.log = function (deckId, code, dir, trial) {
  var r = MT2.rec(deckId, code, dir);
  var t = {
    ts: Date.now(), ms: trial.ms, ok: !!trial.ok, vague: !!trial.vague,
    calib: !!trial.calib, timedOut: !!trial.timedOut, bg: !!trial.bg,
    mode: trial.mode || ''
  };
  if (trial.timedOut) t.verifiedOk = !!trial.verifiedOk;
  r.trials.push(t);
  if (r.trials.length > MT2.MAX_TRIALS) r.trials = r.trials.slice(-MT2.MAX_TRIALS);
  if (r.source === 'migrated') delete r.source;

  var d = today();
  if (!t.bg) {
    r.lastSeen = d;
    // 「隔天仍能快速提取」：达标试次落在不同日期
    if (t.ok && !t.timedOut && t.ms < MT2.cfg('speedTarget')) {
      if (r.fastDays.indexOf(d) === -1) r.fastDays.push(d);
      if (r.fastDays.length > 10) r.fastDays = r.fastDays.slice(-10);
    } else if (!t.ok) {
      r.fastDays = [];   // 答错则重新累积
    }
    MT2.updateWeak(deckId, code, dir, t);
  }
  MT2.recompute(r);
  MT2.scheduleNext(deckId, code, dir);
  MT2.save();
  return r;
};

// 弱项：Recall Weak（想不起/答错） 与 Speed Weak（对但慢） 分开
MT2.updateWeak = function (deckId, code, dir, t) {
  var w = MT2.weak(deckId, code, dir);
  var r = MT2.rec(deckId, code, dir);
  var d = today();
  var target = MT2.cfg('speedTarget');

  if (!t.ok) {
    w.recall.active = true;
    if (!w.recall.since) w.recall.since = d;
    w.recall.clearedDays = [];
    w.graduated = false;
    return;
  }
  // 答对：Recall 毕业需要 3 个不同日期
  if (w.recall.active) {
    if (w.recall.clearedDays.indexOf(d) === -1) w.recall.clearedDays.push(d);
    if (w.recall.clearedDays.length >= 3) {
      w.recall.active = false; w.recall.since = null;
      w.recall.clearedDays = []; w.graduated = true;   // 毕业后仍保留低频抽查
    }
  }
  // Speed Weak：最近 5 次成功里 ≥3 次慢
  var succ = mtScored(r.trials).slice(-MT2.RECENT);
  if (succ.length >= 3) {
    var slow = succ.filter(function (x) { return x.ms >= target; }).length;
    var fast = succ.filter(function (x) { return x.ms < target; });
    if (slow >= 3) {
      if (!w.speed.active) { w.speed.active = true; w.speed.since = d; w.speed.clearedDays = []; }
    } else if (w.speed.active && fast.length >= 3) {
      var days = {};
      fast.forEach(function (x) { days[new Date(x.ts).toISOString().slice(0, 10)] = 1; });
      if (Object.keys(days).length >= 2) {
        w.speed.active = false; w.speed.since = null; w.graduated = true;
      }
    }
  }
};

// 混淆：记录实际误答对象（校准试次才知道用户选了什么）
MT2.logConfusion = function (deckId, code, dir, chosenCode) {
  if (!chosenCode || chosenCode === code) return;
  var w = MT2.weak(deckId, code, dir);
  w.confuse.wrongTargets[chosenCode] = (w.confuse.wrongTargets[chosenCode] || 0) + 1;
};

// 到期复习：status 越高间隔越长；弱项立刻/次日回来
MT2.scheduleNext = function (deckId, code, dir) {
  var r = MT2.rec(deckId, code, dir);
  var w = MT2.weak(deckId, code, dir);
  var days;
  if (w.recall.active) days = 0;
  else if (w.speed.active) days = 1;
  else days = [1, 1, 3, 7][r.status] || 1;
  var n = new Date(); n.setDate(n.getDate() + days);
  r.nextDue = n.toISOString().slice(0, 10);
};

MT2.isDue = function (deckId, code, dir) {
  var r = MT2.recRO(deckId, code, dir);
  if (!r || !r.nextDue) return true;              // 从未测过 → 算到期
  return r.nextDue <= today();
};

// ------------------------------------------------------------
// 聚合查询（供仪表盘与「今日训练」使用）
// ------------------------------------------------------------
MT2.deckSummary = function (deckId, codes, dir) {
  dir = dir || 'fwd';
  var db = MT2.db.retrieval[deckId] || {};
  var meds = [], allScored = [], nOk = 0, nAll = 0;
  var byStatus = [0, 0, 0, 0], nAuto = 0, slowItems = [], wrongItems = [], dueItems = [];
  codes.forEach(function (c) {
    var r = (db[c] || {})[dir];
    if (!r) { byStatus[0]++; dueItems.push(c); return; }
    byStatus[r.status]++;
    if (r.median !== null) { meds.push(r.median); if (r.median < 0.8) nAuto++; }
    mtScored(r.trials).forEach(function (t) { allScored.push(t.ms); });
    mtValid(r.trials).forEach(function (t) { nAll++; if (t.ok) nOk++; });
    var w = MT2.weakRO(deckId, c, dir);
    if (w.speed.active) slowItems.push(c);
    if (w.recall.active) wrongItems.push(c);
    if (MT2.isDue(deckId, c, dir)) dueItems.push(c);
  });
  return {
    n: codes.length,
    median: mtQuantile(allScored, 0.5),
    p90: mtQuantile(allScored, 0.9),
    acc: nAll ? nOk / nAll : null,
    trials: nAll,
    byStatus: byStatus,
    autoPct: codes.length ? nAuto / codes.length : 0,
    slowItems: slowItems, wrongItems: wrongItems, dueItems: dueItems
  };
};

// 自评 vs 校准正确率对比 —— 检测自评放水
MT2.calibrationCheck = function (deckId, codes, dir) {
  dir = dir || 'fwd';
  var db = MT2.db.retrieval[deckId] || {};
  var sOk = 0, sN = 0, cOk = 0, cN = 0;
  codes.forEach(function (c) {
    var r = (db[c] || {})[dir]; if (!r) return;
    mtValid(r.trials).forEach(function (t) {
      if (t.calib) { cN++; if (t.ok) cOk++; }
      else { sN++; if (t.ok) sOk++; }
    });
  });
  if (cN < 15 || sN < 15) return { enough: false, cN: cN, sN: sN };
  return { enough: true, cN: cN, sN: sN, selfAcc: sOk / sN, calibAcc: cOk / cN,
           gap: (sOk / sN) - (cOk / cN) };
};
