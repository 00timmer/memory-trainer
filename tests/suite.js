// ============================================================
// Memory Trainer 自测套件
// 用法：./run-tests.sh （构建 → headless Chrome 跑一遍 → 非零退出码表示失败）
// 这个文件不会被 build.sh 打进 index.html，只在测试时注入。
// ============================================================
(function () {
  var results = [], group = '';

  function G(name) { group = name; }
  function T(name, fn) {
    try { fn(); results.push({ ok: true, g: group, n: name }); }
    catch (e) {
      results.push({ ok: false, g: group, n: name, e: e.message,
                     at: (e.stack || '').split('\n')[1] || '' });
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
  function eq(a, b, msg) {
    if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
  }
  function near(a, b, tol, msg) {
    if (a === null || Math.abs(a - b) > tol)
      throw new Error((msg || '') + ' 期望 ≈' + b + '（±' + tol + '），实际 ' + a);
  }

  var _today = today;
  function fakeToday(d) { today = d ? function () { return d; } : _today; }

  function reset() {
    fakeToday(null);
    localStorage.clear();
    MT2.db.retrieval = {}; MT2.db.weakness = {}; MT2.db.settings = {};
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    MT2.db.encoding = { items: [], tta: [] };
    MT2.db.queue = []; MT2.db.used = {};
    currentDeckId = 'numbers'; currentPhase = 1;
    deck = []; deckIndex = 0; revealed = false; judgeReady = false;
    mtSessionTrials = []; sessionTimes = []; sessionMissed = [];
    sessionCorrect = 0; sessionWrong = 0; sessionVague = 0;
  }

  // 直接摆一副牌进训练屏，绕过随机抽题
  function stage(cards, opts) {
    opts = opts || {};
    reset();
    MT2.setCfg('calibRate', opts.calibRate === undefined ? 0 : opts.calibRate);
    currentMode = opts.mode || 'random';
    deck = cards; deckIndex = 0;
    showScreen('training');
    showCurrentCard();
  }
  // 模拟「想了 sec 秒之后按键」
  function commitAfter(sec) { mtT0 = performance.now() - sec * 1000; mtCommit(); }
  function busy(ms) { var t = performance.now(); while (performance.now() - t < ms) {} }

  // ==========================================================
  G('P0 存储与迁移');

  T('新数据写新 key，旧 key 不被改写', function () {
    reset();
    localStorage.setItem('mt_card_mastery', JSON.stringify({ numbers: { '11': { level: 3 } } }));
    var before = localStorage.getItem('mt_card_mastery');
    MT2.log('numbers', '11', 'fwd', { ms: 1.0, ok: true });
    eq(localStorage.getItem('mt_card_mastery'), before, '旧 mastery 表被改动了');
    assert(localStorage.getItem('mt_retrieval'), '新 key 没写入');
  });

  T('迁移：旧 level 3 只到「能正确提取」，不到「能快速提取」', function () {
    reset();
    allCardMastery = { numbers: { '11': { level: 3, lastReview: '2026-09-01' } } };
    MT2.migrate();
    var r = MT2.rec('numbers', '11', 'fwd');
    eq(r.status, 1, '旧计时不可信，不能声称快');
    eq(r.source, 'migrated');
    eq(r.trials.length, 0);
  });

  T('迁移：旧弱项进错项，不进慢项', function () {
    reset();
    allCardMastery = {}; allWeak = { numbers: { '42': { addedDate: '2026-09-01' } } };
    MT2.migrate();
    var w = MT2.weakRO('numbers', '42', 'fwd');
    eq(w.recall.active, true);
    eq(w.speed.active, false);
  });

  T('迁移幂等：跑两次不覆盖已有新数据', function () {
    reset();
    allCardMastery = { numbers: { '11': { level: 3 } } }; allWeak = {};
    MT2.migrate();
    MT2.log('numbers', '11', 'fwd', { ms: 0.5, ok: true });
    localStorage.removeItem('mt_migrated_v2');
    MT2.migrate();
    eq(MT2.rec('numbers', '11', 'fwd').trials.length, 1, '第二次迁移把试次冲掉了');
  });

  T('导出内容是合法 JSON 且带版本标识', function () {
    reset();
    MT2.log('numbers', '11', 'fwd', { ms: 1.0, ok: true });
    var payload = {};
    MT2.EXPORT_KEYS.forEach(function (k) {
      var v = localStorage.getItem(k); if (v !== null) payload[k] = v;
    });
    var s = JSON.stringify({ app: 'memory-trainer', schema: MT2.SCHEMA, data: payload });
    var back = JSON.parse(s);
    eq(back.app, 'memory-trainer');
    assert(back.data.mt_retrieval, '导出漏了 mt_retrieval');
    JSON.parse(back.data.mt_retrieval);
  });

  // ==========================================================
  G('P1 计时口径');

  T('延迟只含 cue → 按键，核对时间不计入', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    commitAfter(1.5);
    var frozen = mtLatency;
    busy(150);                       // 模拟看答案 + 点评分
    judgeCard('remember');
    var t = MT2.rec('numbers', '11', 'fwd').trials[0];
    near(t.ms, 1.5, 0.05, '存下来的延迟');
    eq(t.ms, frozen, '记录值与冻结值不一致');
  });

  T('承诺后计时器停住', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    commitAfter(1.0);
    var shown = document.getElementById('train-timer').textContent;
    busy(120);
    eq(document.getElementById('train-timer').textContent, shown, '计时器承诺后还在走');
  });

  T('无强制等待、无翻牌锁定延迟', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    eq(currentFriction, 0);
    eq(f1Timer, null);
    eq(lockInTimer, null);
    eq(document.getElementById('f1-countdown').textContent, '');
    commitAfter(0.3);
    assert(document.getElementById('card-answer').classList.contains('visible'), '答案没有立即显示');
  });

  T('秒答不被惩罚', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    commitAfter(0.4);
    judgeCard('remember');
    var t = MT2.rec('numbers', '11', 'fwd').trials[0];
    eq(t.ok, true);
    assert(t.ms < 1, '0.4s 的试次没被正常记录');
    assert(!('revealTooFast' in t), '仍在记录 revealTooFast');
  });

  T('自评按钮不再按用时高亮', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    commitAfter(4.0);              // 旧版会高亮「不会」
    ['btn-judge-remember', 'btn-judge-vague', 'btn-judge-dont'].forEach(function (id) {
      eq(document.getElementById(id).style.boxShadow, '', id + ' 被高亮了');
    });
  });

  T('切后台的试次作废，不进延迟分布也不进正确率', function () {
    reset();
    MT2.log('numbers', '11', 'fwd', { ms: 9.9, ok: true, bg: true });
    var r = MT2.rec('numbers', '11', 'fwd');
    eq(r.median, null, '后台试次进了中位数');
    eq(r.acc, null, '后台试次进了正确率');
    eq(r.status, 0);
  });

  T('冲刺超时的试次不计入延迟分布', function () {
    reset();
    for (var i = 0; i < 4; i++) MT2.log('numbers', '11', 'fwd', { ms: 0.6, ok: true });
    MT2.log('numbers', '11', 'fwd', { ms: 3.0, ok: true, timedOut: true, verifiedOk: true });
    var r = MT2.rec('numbers', '11', 'fwd');
    near(r.median, 0.6, 0.001, '超时试次污染了中位数');
    eq(r.trials[4].timedOut, true);
    eq(r.trials[4].verifiedOk, true, '超时后的「认识」应单独留档');
  });

  T('试次上限 30，超出后滚动丢弃最旧的', function () {
    reset();
    for (var i = 0; i < 35; i++) MT2.log('numbers', '11', 'fwd', { ms: i / 100, ok: true });
    var r = MT2.rec('numbers', '11', 'fwd');
    eq(r.trials.length, 30);
    near(r.trials[0].ms, 0.05, 0.001, '丢弃的不是最旧的');
  });

  T('P90 计算正确', function () {
    reset();
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(function (v) {
      MT2.log('numbers', '11', 'fwd', { ms: v, ok: true });
    });
    var r = MT2.rec('numbers', '11', 'fwd');
    near(r.median, 5.5, 0.001, '中位');
    near(r.p90, 9.1, 0.001, 'P90');
  });

  // ==========================================================
  G('P1 状态机与弱项');

  T('四态阶梯：未测 → 能正确 → 能快速 → 隔天仍快速', function () {
    reset();
    eq(MT2.rec('numbers', '11', 'fwd').status, 0, '未测');
    fakeToday('2026-09-08');
    for (var i = 0; i < 3; i++) MT2.log('numbers', '11', 'fwd', { ms: 2.5, ok: true });
    eq(MT2.rec('numbers', '11', 'fwd').status, 1, '慢但对 → 能正确提取');
    for (var i = 0; i < 5; i++) MT2.log('numbers', '11', 'fwd', { ms: 0.6, ok: true });
    eq(MT2.rec('numbers', '11', 'fwd').status, 2, '快了但只有一天');
    fakeToday('2026-09-09'); MT2.log('numbers', '11', 'fwd', { ms: 0.6, ok: true });
    eq(MT2.rec('numbers', '11', 'fwd').status, 2, '两天还不够');
    fakeToday('2026-09-10'); MT2.log('numbers', '11', 'fwd', { ms: 0.6, ok: true });
    eq(MT2.rec('numbers', '11', 'fwd').status, 3, '三个不同日期后才算隔天仍快速');
    fakeToday(null);
  });

  T('答错清空「隔天」累计', function () {
    reset();
    fakeToday('2026-09-08'); MT2.log('numbers', '11', 'fwd', { ms: 0.6, ok: true });
    fakeToday('2026-09-09'); MT2.log('numbers', '11', 'fwd', { ms: 0.6, ok: true });
    eq(MT2.rec('numbers', '11', 'fwd').fastDays.length, 2);
    MT2.log('numbers', '11', 'fwd', { ms: 3.0, ok: false });
    eq(MT2.rec('numbers', '11', 'fwd').fastDays.length, 0, '答错后没有重新累积');
    fakeToday(null);
  });

  T('正确但慢 → 慢项，且不算错项', function () {
    reset();
    for (var i = 0; i < 5; i++) MT2.log('numbers', '77', 'fwd', { ms: 2.6, ok: true });
    var w = MT2.weakRO('numbers', '77', 'fwd');
    eq(w.speed.active, true, '没进慢项');
    eq(w.recall.active, false, '慢项被误判成错项');
  });

  T('慢项毕业需要跨 2 个不同日期', function () {
    reset();
    for (var i = 0; i < 5; i++) MT2.log('numbers', '77', 'fwd', { ms: 2.6, ok: true });
    eq(MT2.weakRO('numbers', '77', 'fwd').speed.active, true);
    for (var i = 0; i < 5; i++) MT2.log('numbers', '77', 'fwd', { ms: 0.7, ok: true });
    eq(MT2.weakRO('numbers', '77', 'fwd').speed.active, true, '同一天连答就毕业了');
    var r = MT2.rec('numbers', '77', 'fwd');
    r.trials.forEach(function (t, i) { if (i < 8) t.ts -= 86400000; });   // 前面几次改成昨天
    MT2.log('numbers', '77', 'fwd', { ms: 0.7, ok: true });
    eq(MT2.weakRO('numbers', '77', 'fwd').speed.active, false, '跨天达标后仍未毕业');
  });

  T('错项毕业需要 3 个不同日期', function () {
    reset();
    MT2.log('numbers', '42', 'fwd', { ms: 3.0, ok: false });
    fakeToday('2026-09-08'); MT2.log('numbers', '42', 'fwd', { ms: 1.0, ok: true });
    fakeToday('2026-09-08'); MT2.log('numbers', '42', 'fwd', { ms: 1.0, ok: true });
    eq(MT2.weakRO('numbers', '42', 'fwd').recall.active, true, '同一天答两次就毕业了');
    fakeToday('2026-09-09'); MT2.log('numbers', '42', 'fwd', { ms: 1.0, ok: true });
    fakeToday('2026-09-10'); MT2.log('numbers', '42', 'fwd', { ms: 1.0, ok: true });
    eq(MT2.weakRO('numbers', '42', 'fwd').recall.active, false, '三天后仍未毕业');
    eq(MT2.weakRO('numbers', '42', 'fwd').graduated, true);
    fakeToday(null);
  });

  T('正向与反向完全分开记账', function () {
    reset();
    MT2.log('numbers', '55', 'rev', { ms: 3.0, ok: false });
    eq(MT2.rec('numbers', '55', 'fwd').trials.length, 0, '反向失败污染了正向');
    eq(MT2.rec('numbers', '55', 'rev').trials.length, 1);
    eq(MT2.weakRO('numbers', '55', 'fwd').recall.active, false);
    eq(MT2.weakRO('numbers', '55', 'rev').recall.active, true);
  });

  T('到期调度真正生效：错项当天，掌握项 7 天后', function () {
    reset();
    MT2.log('numbers', '55', 'fwd', { ms: 3.0, ok: false });
    eq(MT2.rec('numbers', '55', 'fwd').nextDue, today(), '错项没有当天回来');
    assert(MT2.isDue('numbers', '55', 'fwd'), '错项应立即到期');
    fakeToday('2026-09-08');
    for (var i = 0; i < 5; i++) MT2.log('numbers', '88', 'fwd', { ms: 0.6, ok: true });
    fakeToday('2026-09-09'); MT2.log('numbers', '88', 'fwd', { ms: 0.6, ok: true });
    fakeToday('2026-09-10'); MT2.log('numbers', '88', 'fwd', { ms: 0.6, ok: true });
    fakeToday(null);
    eq(MT2.rec('numbers', '88', 'fwd').status, 3);
    assert(MT2.rec('numbers', '88', 'fwd').nextDue > today(), '掌握项没有排到以后');
    assert(!MT2.isDue('numbers', '88', 'fwd'), '掌握项不该立刻到期');
  });

  T('从未测过的编码算作到期', function () {
    reset();
    assert(MT2.isDue('numbers', '33', 'fwd'), '未测的应该进队列');
  });

  // ==========================================================
  G('P1 闪卡流程');

  T('「不会」不自动跳下一张，必须手动继续', function () {
    stage([{ type: 'forward', codes: ['11'] }, { type: 'forward', codes: ['22'] }]);
    f2DontKnow();
    assert(document.getElementById('card-answer').classList.contains('visible'), '答案没显示');
    eq(deckIndex, 0, '自动跳到下一张了');
    eq(document.getElementById('mt-continue').style.display, '', '没有出现继续按钮');
    mtContinue();
    eq(deckIndex, 1);
  });

  T('答错的卡片隔几张重新出现', function () {
    stage([{ type: 'forward', codes: ['11'] }, { type: 'forward', codes: ['22'] },
           { type: 'forward', codes: ['33'] }, { type: 'forward', codes: ['44'] },
           { type: 'forward', codes: ['55'] }, { type: 'forward', codes: ['66'] }]);
    var before = deck.length;
    f2DontKnow();
    eq(deck.length, before + 1, '没有重排入队');
    var pos = -1;
    deck.forEach(function (c, i) { if (c.requeued) pos = i; });
    assert(pos >= 4 && pos <= 6, '重排位置 ' + pos + ' 不在 3–5 张之后');
  });

  T('重排只发生一次，不会无限循环', function () {
    stage([{ type: 'forward', codes: ['11'], requeued: true }]);
    var before = deck.length;
    f2DontKnow();
    eq(deck.length, before, '重排过的卡片又被重排了');
  });

  T('答错进错项队列并记入本轮 missed', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    f2DontKnow();
    eq(MT2.weakRO('numbers', '11', 'fwd').recall.active, true);
    assert(sessionMissed.indexOf('11') !== -1, '没记入本轮 missed');
  });

  T('校准试次：先给 4 个选项，答案此时不显示', function () {
    stage([{ type: 'forward', codes: ['11'] }], { calibRate: 1 });
    commitAfter(1.0);
    var box = document.getElementById('mt-calib');
    eq(box.style.display, '');
    eq(box.querySelectorAll('.mt-calib-opt').length, 4);
    assert(!document.getElementById('card-answer').classList.contains('visible'),
           '校准试次不该提前显示答案');
    eq(document.getElementById('judge-controls').style.display, 'none', '不该同时给自评按钮');
  });

  T('校准选项一定包含正确答案，且标签不重复', function () {
    for (var n = 0; n < 12; n++) {
      stage([{ type: 'forward', codes: ['11'] }], { calibRate: 1 });
      commitAfter(1.0);
      var btns = document.getElementById('mt-calib').querySelectorAll('.mt-calib-opt');
      var codes = [], labels = {};
      Array.prototype.forEach.call(btns, function (b) {
        codes.push(b.getAttribute('data-code'));
        labels[b.textContent] = (labels[b.textContent] || 0) + 1;
      });
      assert(codes.indexOf('11') !== -1, '第 ' + n + ' 次抽样漏了正确答案');
      Object.keys(labels).forEach(function (k) {
        eq(labels[k], 1, '出现了重复选项「' + k + '」');
      });
    }
  });

  T('校准试次被标记，答对也要手动继续', function () {
    stage([{ type: 'forward', codes: ['11'] }, { type: 'forward', codes: ['22'] }], { calibRate: 1 });
    commitAfter(1.0);
    var box = document.getElementById('mt-calib'), right = null;
    Array.prototype.forEach.call(box.querySelectorAll('.mt-calib-opt'), function (b) {
      if (b.getAttribute('data-code') === '11') right = b;
    });
    right.click();
    var t = MT2.rec('numbers', '11', 'fwd').trials[0];
    eq(t.calib, true, '没标记为校准试次');
    eq(t.ok, true);
    eq(deckIndex, 0, '校准答对后直接跳了，看不到结果');
    eq(document.getElementById('mt-continue').style.display, '');
    mtContinue(); eq(deckIndex, 1);
  });

  T('校准答错记录实际误答对象', function () {
    stage([{ type: 'forward', codes: ['11'] }], { calibRate: 1 });
    commitAfter(1.0);
    var box = document.getElementById('mt-calib'), wrong = null;
    Array.prototype.forEach.call(box.querySelectorAll('.mt-calib-opt'), function (b) {
      if (!wrong && b.getAttribute('data-code') !== '11') wrong = b;
    });
    var chosen = wrong.getAttribute('data-code');
    wrong.click();
    var w = MT2.weakRO('numbers', '11', 'fwd');
    eq(w.confuse.wrongTargets[chosen], 1, '没记下误答成了哪个');
    eq(MT2.rec('numbers', '11', 'fwd').trials[0].ok, false);
  });

  T('连读答错时可以指出具体哪几个，其余算对', function () {
    stage([{ type: 'multi', codes: ['11', '22', '33'] }], { mode: 'multi' });
    commitAfter(2.0);
    judgeCard('dont_know');
    var box = document.getElementById('mt-multimiss');
    eq(box.style.display, '', '没有出现「哪几个没答上」');
    eq(box.querySelectorAll('.mt-miss-chip').length, 3);
    box.querySelector('.mt-miss-chip[data-code="22"]').click();
    box.querySelector('.mt-miss-done').click();
    eq(MT2.rec('numbers', '11', 'multi').trials[0].ok, true, '11 被连坐判错');
    eq(MT2.rec('numbers', '22', 'multi').trials[0].ok, false);
    eq(MT2.rec('numbers', '33', 'multi').trials[0].ok, true, '33 被连坐判错');
  });

  T('连读一个都没选时按全错处理', function () {
    stage([{ type: 'multi', codes: ['11', '22'] }], { mode: 'multi' });
    commitAfter(2.0);
    judgeCard('dont_know');
    document.getElementById('mt-multimiss').querySelector('.mt-miss-done').click();
    eq(MT2.rec('numbers', '11', 'multi').trials[0].ok, false);
    eq(MT2.rec('numbers', '22', 'multi').trials[0].ok, false);
  });

  T('反向卡片记到 rev 方向', function () {
    stage([{ type: 'reverse', codes: ['11'] }]);
    commitAfter(1.0);
    judgeCard('remember');
    eq(MT2.rec('numbers', '11', 'rev').trials.length, 1);
    eq(MT2.rec('numbers', '11', 'fwd').trials.length, 0);
  });

  T('「模糊」算对但单独记账', function () {
    stage([{ type: 'forward', codes: ['11'] }]);
    commitAfter(1.0);
    judgeCard('vague');
    var t = MT2.rec('numbers', '11', 'fwd').trials[0];
    eq(t.ok, true); eq(t.vague, true);
    eq(sessionVague, 1);
  });

  // ==========================================================
  G('P2 编排与仪表盘');

  T('今日训练优先抽错项', function () {
    reset();
    ['11', '22', '33'].forEach(function (c) {
      MT2.log('numbers', c, 'fwd', { ms: 3.0, ok: false });
    });
    var d = MT2.buildTodayDeck('numbers', getFilteredCodes(), 20);
    var picked = {};
    d.forEach(function (c) { picked[c.codes[0]] = 1; });
    ['11', '22', '33'].forEach(function (c) {
      assert(picked[c], '错项 ' + c + ' 没被抽进今日训练');
    });
  });

  T('今日训练题数随实测延迟调整', function () {
    reset();
    var fast = MT2.estimateSecsPerItem('numbers', getFilteredCodes());
    getFilteredCodes().slice(0, 20).forEach(function (c) {
      for (var i = 0; i < 3; i++) MT2.log('numbers', c, 'fwd', { ms: 4.5, ok: true });
    });
    var slow = MT2.estimateSecsPerItem('numbers', getFilteredCodes());
    assert(slow > fast, '延迟变慢后每题预算没有变大');
  });

  T('今日训练不超预算', function () {
    reset();
    var d = MT2.buildTodayDeck('numbers', getFilteredCodes(), 12);
    assert(d.length <= 12, '抽了 ' + d.length + ' 题，超出预算 12');
  });

  T('弱项模式包含慢项（旧版只收错项）', function () {
    reset();
    for (var i = 0; i < 5; i++) MT2.log('numbers', '77', 'fwd', { ms: 2.6, ok: true });
    MT2.log('numbers', '42', 'fwd', { ms: 3.0, ok: false });
    var d = buildDeck('weak');
    var picked = {};
    d.forEach(function (c) { picked[c.codes[0]] = 1; });
    assert(picked['77'], '慢项没进弱项复习');
    assert(picked['42'], '错项没进弱项复习');
  });

  T('今日弱项按新的两类统计', function () {
    reset();
    MT2.log('numbers', '42', 'fwd', { ms: 3.0, ok: false });
    eq(getTodayWeakCount(), 1);
    for (var i = 0; i < 5; i++) MT2.log('numbers', '77', 'fwd', { ms: 2.6, ok: true });
    eq(getTodayWeakCount(), 2, '慢项没算进今日弱项');
  });

  T('掌握度分布把未测卡片计入分母', function () {
    reset();
    var codes = getFilteredCodes();
    var s0 = MT2.deckSummary('numbers', codes, 'fwd');
    eq(s0.byStatus[0], codes.length, '一次都没练时，全部编码都该在最低一档');
    // 练到「能正确提取」的那张要从最低档移出去，其余仍留在分母里
    for (var i = 0; i < 3; i++) MT2.log('numbers', '11', 'fwd', { ms: 1.0, ok: true });
    var s = MT2.deckSummary('numbers', codes, 'fwd');
    eq(s.byStatus.reduce(function (a, b) { return a + b; }, 0), codes.length,
       '分布合计与编码总数不一致');
    eq(s.byStatus[1] + s.byStatus[2] + s.byStatus[3], 1, '达标的那张没有升档');
    eq(s.byStatus[0], codes.length - 1, '未测的没有单列一档');
  });

  T('试次不足 3 次时不给状态判定', function () {
    reset();
    MT2.log('numbers', '11', 'fwd', { ms: 0.5, ok: true });
    MT2.log('numbers', '11', 'fwd', { ms: 0.5, ok: true });
    eq(MT2.rec('numbers', '11', 'fwd').status, 0, '2 次就下结论了');
    eq(MT2.STATUS_LABEL[0], '未测/样本不足', '最低档的标签要说清是样本不足，不是没练过');
  });

  T('校准对比：样本不足时不给结论', function () {
    reset();
    for (var i = 0; i < 5; i++) MT2.log('numbers', '11', 'fwd', { ms: 1.0, ok: true, calib: true });
    var cc = MT2.calibrationCheck('numbers', getFilteredCodes(), 'fwd');
    eq(cc.enough, false, '样本不足却给了结论');
  });

  T('校准对比：自评放水时能测出来', function () {
    reset();
    var codes = getFilteredCodes().slice(0, 20);
    codes.forEach(function (c) {
      for (var i = 0; i < 2; i++) MT2.log('numbers', c, 'fwd', { ms: 1.0, ok: true, calib: false });
      MT2.log('numbers', c, 'fwd', { ms: 1.0, ok: i % 2 === 0, calib: true });
      MT2.log('numbers', c, 'fwd', { ms: 1.0, ok: false, calib: true });
    });
    var cc = MT2.calibrationCheck('numbers', codes, 'fwd');
    eq(cc.enough, true);
    assert(cc.gap > 0.08, '自评 ' + cc.selfAcc + ' vs 校准 ' + cc.calibAcc + '，没测出放水');
  });

  T('仪表盘与自动化地图能渲染', function () {
    reset();
    getFilteredCodes().slice(0, 10).forEach(function (c) {
      MT2.log('numbers', c, 'fwd', { ms: 1.0, ok: true });
    });
    MT2.showDash();
    assert(document.getElementById('mt-dash-body').innerHTML.indexOf('提取自动化') > -1, '仪表盘空白');
    MT2.showMap();
    assert(document.querySelectorAll('.mt-cell').length > 0, '地图没有格子');
    MT2.mapDetail(getFilteredCodes()[0]);
    assert(document.getElementById('mt-map-detail').innerHTML.indexOf('正向') > -1, '详情空白');
    showHome();
  });

  T('结束页的延迟卡片不会重复堆积', function () {
    reset();
    mtSessionTrials = [{ ms: 1.0, ok: true, bg: false, timedOut: false, calib: false }];
    finishSession();
    finishSession();
    eq(document.querySelectorAll('#mt-session-latency').length, 1, '每次结束都插一张新卡');
  });

  T('旧口径的历史数据不与新延迟混在一起', function () {
    reset();
    allStats = { numbers: [{ date: '2026-09-01', total: 10, correct: 8, wrong: 2, totalTime: 45 }] };
    getFilteredCodes().slice(0, 5).forEach(function (c) {
      MT2.log('numbers', c, 'fwd', { ms: 1.0, ok: true });
    });
    MT2.showDash();
    var html = document.getElementById('mt-dash-body').innerHTML;
    assert(html.indexOf('旧口径') > -1, '没有标注旧口径');
    var s = MT2.deckSummary('numbers', getFilteredCodes(), 'fwd');
    near(s.median, 1.0, 0.001, '旧的 totalTime 混进了新中位数');
    showHome();
  });

  // ==========================================================
  fakeToday(null);
  reset();

  var pass = results.filter(function (r) { return r.ok; }).length;
  var fail = results.length - pass;
  var lines = [], lastG = '';
  results.forEach(function (r) {
    if (r.g !== lastG) { lines.push(''); lines.push('## ' + r.g); lastG = r.g; }
    lines.push((r.ok ? 'PASS' : 'FAIL') + '  ' + r.n + (r.ok ? '' : '\n      → ' + r.e + (r.at ? '\n      ' + r.at.trim() : '')));
  });
  lines.push('');
  lines.push('SUMMARY ' + pass + ' passed, ' + fail + ' failed, ' + results.length + ' total');

  var pre = document.createElement('pre');
  pre.id = 'MT_TEST_RESULTS';
  pre.textContent = lines.join('\n');
  document.body.appendChild(pre);
  window.MT_TEST_FAILED = fail;
})();
