// ============================================================
// 「今日训练」编排器 —— 打开就能练，不需要选任何东西
// P2 阶段只编排 System C；A/B 模块（P3/P5）接入后在此追加时段。
// ============================================================
MT2.SESSION_PRESETS = {
  '5m':  { label: '5 分钟速练',   minutes: 5 },
  '15m': { label: '15 分钟标准', minutes: 15 },
  '20m': { label: '20 分钟完整', minutes: 20 }
};

// 每题预算：按该牌组的实测中位延迟 + 核对/翻页开销估算
MT2.estimateSecsPerItem = function (deckId, codes) {
  var s = MT2.deckSummary(deckId, codes, 'fwd');
  var med = s.median || 2.0;
  return Math.max(3.5, med + 3.0);
};

// 抽题优先级：到期 > 错项 > 慢项 > 混淆对 > 已掌握项低频抽查
MT2.buildTodayDeck = function (deckId, codes, budgetItems) {
  var picked = [], seen = {};
  function add(list, type) {
    shuffle(list).forEach(function (c) {
      if (picked.length >= budgetItems) return;
      var k = type + ':' + c;
      if (seen[k]) return; seen[k] = 1;
      picked.push({ type: type, codes: [c] });
    });
  }
  var s = MT2.deckSummary(deckId, codes, 'fwd');

  // 1. 错项（Recall Weak）— 每个出现两次
  var wrong = s.wrongItems.slice();
  add(wrong, 'forward');
  wrong.forEach(function (c) {
    if (picked.length < budgetItems) picked.push({ type: 'forward', codes: [c] });
  });

  // 2. 慢项（Speed Weak）
  add(s.slowItems, 'forward');

  // 3. 到期项
  add(s.dueItems, 'forward');

  // 4. 混淆对
  var cf = getConfusable().filter(function (p) {
    return codes.indexOf(p[0]) !== -1 && codes.indexOf(p[1]) !== -1;
  });
  shuffle(cf).forEach(function (p) {
    if (picked.length + 2 > budgetItems) return;
    picked.push({ type: 'forward', codes: [p[0]] });
    picked.push({ type: 'forward', codes: [p[1]] });
  });

  // 5. 反向抽查（反向单独记账，需要独立样本）
  var revS = MT2.deckSummary(deckId, codes, 'rev');
  var revNeed = revS.dueItems.length ? revS.dueItems : codes;
  shuffle(revNeed).slice(0, Math.max(2, Math.round(budgetItems * 0.15))).forEach(function (c) {
    if (picked.length < budgetItems) picked.push({ type: 'reverse', codes: [c] });
  });

  // 6. 已掌握项低频抽查（毕业不等于永不再考）
  var mastered = codes.filter(function (c) {
    var r = MT2.recRO(deckId, c, 'fwd'); return !!r && r.status >= 2;
  });
  add(mastered, 'forward');

  // 仍不够就用随机项补齐
  while (picked.length < budgetItems && codes.length) {
    picked.push({ type: 'forward', codes: [codes[Math.floor(Math.random() * codes.length)]] });
  }
  return shuffle(picked.slice(0, budgetItems));
};

MT2.startToday = function (preset) {
  preset = preset || MT2.cfg('sessionLen');
  var p = MT2.SESSION_PRESETS[preset] || MT2.SESSION_PRESETS['15m'];
  MT2.setCfg('sessionLen', preset);
  var codes = getFilteredCodes();
  if (!codes.length) { alert('当前范围内没有编码'); return; }
  var per = MT2.estimateSecsPerItem(currentDeckId, codes);
  var budget = Math.max(8, Math.round(p.minutes * 60 / per));
  var d = MT2.buildTodayDeck(currentDeckId, codes, budget);
  if (!d.length) { alert('没有可练的内容'); return; }
  currentMode = 'today'; lastMode = 'today';
  deck = d;
  lastDeck = deck.map(function (c) { return { type: c.type, codes: c.codes.slice() }; });
  deckIndex = 0; sessionCorrect = 0; sessionWrong = 0; sessionVague = 0;
  sessionTimes = []; sessionMissed = []; mtSessionTrials = [];
  sessionStartTime = Date.now();
  showScreen('training'); showCurrentCard();
};

// 首页「今日训练」的一句话说明
MT2.todayPlan = function () {
  var codes = getFilteredCodes();
  if (!codes.length) return '当前范围内没有编码';
  var s = MT2.deckSummary(currentDeckId, codes, 'fwd');
  var bits = [];
  if (s.wrongItems.length) bits.push('错项 ' + s.wrongItems.length);
  if (s.slowItems.length) bits.push('慢项 ' + s.slowItems.length);
  if (s.dueItems.length) bits.push('到期 ' + s.dueItems.length);
  var p = MT2.SESSION_PRESETS[MT2.cfg('sessionLen')] || MT2.SESSION_PRESETS['15m'];
  return p.label + (bits.length ? ' · 优先练 ' + bits.join(' / ') : ' · 全部已掌握，随机抽查');
};

// ------------------------------------------------------------
// 弱项模式改用新的两类弱项
// ------------------------------------------------------------
var _mtOrigBuildDeck = buildDeck;
buildDeck = function (mode) {
  if (mode === 'weak') {
    var codes = getFilteredCodes();
    var s = MT2.deckSummary(currentDeckId, codes, 'fwd');
    var wk = s.wrongItems.concat(s.slowItems);
    wk = wk.filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (!wk.length) return [];
    var count = getModeCount(mode);
    var target = count > 0 ? count : wk.length * 2;
    var out = [];
    while (out.length < target) out = out.concat(shuffle(wk));
    return out.slice(0, target).map(function (c) { return { type: 'forward', codes: [c] }; });
  }
  return _mtOrigBuildDeck(mode);
};

var _mtOrigStartMode = startMode;
startMode = function (mode) {
  if (mode === 'weak') {
    var codes = getFilteredCodes();
    var s = MT2.deckSummary(currentDeckId, codes, 'fwd');
    if (!s.wrongItems.length && !s.slowItems.length) { alert('当前没有错项或慢项'); return; }
  }
  mtSessionTrials = [];
  _mtOrigStartMode(mode);
};

// 「今日弱项」：改为今天新增的错项 + 慢项
function startTodayWeakReview() {
  var codes = getFilteredCodes(), t = today(), list = [];
  codes.forEach(function (c) {
    var w = MT2.weakRO(currentDeckId, c, 'fwd');
    if ((w.recall.active && w.recall.since === t) || (w.speed.active && w.speed.since === t)) list.push(c);
  });
  if (!list.length) { alert('今天还没有新增弱项'); return; }
  currentMode = 'weak'; lastMode = 'weak';
  deck = shuffle(list.concat(list).map(function (c) { return { type: 'forward', codes: [c] }; }));
  lastDeck = deck.map(function (c) { return { type: c.type, codes: c.codes.slice() }; });
  deckIndex = 0; sessionCorrect = 0; sessionWrong = 0; sessionVague = 0;
  sessionTimes = []; sessionMissed = []; mtSessionTrials = [];
  sessionStartTime = Date.now();
  showScreen('training'); showCurrentCard();
}

function getTodayWeakCount() {
  var codes = getFilteredCodes(), t = today(), n = 0;
  codes.forEach(function (c) {
    var w = MT2.weakRO(currentDeckId, c, 'fwd');
    if ((w.recall.active && w.recall.since === t) || (w.speed.active && w.speed.since === t)) n++;
  });
  return n;
}
