// ============================================================
// Memory Trainer 自测套件
// 用法：./run-tests.sh （构建 → headless Chrome 跑一遍 → 非零退出码表示失败）
// 这个文件不会被 build.sh 打进 index.html，只在测试时注入。
// ============================================================
(function () {
  var results = [], group = '';

  function G(name) { group = name; }
  var pending = [];
  function T(name, fn) {
    try {
      var r = fn();
      if (r && typeof r.then === 'function') {
        var slot = { ok: true, g: group, n: name };
        results.push(slot);
        pending.push(r.catch(function (e) { slot.ok = false; slot.e = e.message; }));
        return;
      }
      results.push({ ok: true, g: group, n: name });
    }
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
  G('P3 材料与评分');

  T('随机字符序列内部不重复', function () {
    for (var n = 0; n < 40; n++) {
      var c = MT2.MAT.pickChars(8);
      eq(c.length, 8);
      var seen = {};
      c.forEach(function (x) { assert(!seen[x], '序列里出现了重复字 ' + x); seen[x] = 1; });
    }
  });

  T('材料库避免重复取同一段文本', function () {
    reset();
    var t1 = MT2.MAT.TEXTS.filter(function (t) { return t.tier === 1; }).length;
    var got = {};
    for (var i = 0; i < t1; i++) got[MT2.MAT.pickText(1).text] = 1;
    eq(Object.keys(got).length, t1, '还没用完就开始重复了');
    assert(MT2.MAT.freshTextCount(1) === 0, 'usedLedger 没记上');
  });

  T('序列评分：项目正确与位置正确分开算', function () {
    var s1 = MT2.MAT.scoreSeq(['海', '钟', '纸'], ['海', '钟', '纸']);
    eq(s1.positions, 3); eq(s1.items, 3); eq(s1.perfect, true);
    var s2 = MT2.MAT.scoreSeq(['海', '钟', '纸'], ['海', '纸', '钟']);
    eq(s2.positions, 1, '位置只有第一个对');
    eq(s2.items, 3, '三个字都记住了，只是顺序错');
    eq(s2.perfect, false);
    var s3 = MT2.MAT.scoreSeq(['海', '钟', '纸'], []);
    eq(s3.positions, 0); eq(s3.items, 0);
  });

  T('序列评分：多写的字不会把正确率刷上去', function () {
    var s = MT2.MAT.scoreSeq(['海', '钟'], ['海', '钟', '纸', '月', '桥']);
    eq(s.items, 2, '多写的字被算成了记住');
    assert(s.itemAcc <= 1, 'itemAcc 超过 100%');
    eq(s.perfect, false, '多写了还算完美');
  });

  T('序列评分：把同一个字写几遍不能顶几个字', function () {
    // 只记住一个字、剩下靠重复凑数，应该只算记住一个
    var s = MT2.MAT.scoreSeq(['海', '钟', '纸'], ['海', '海', '海']);
    eq(s.items, 1, '重复的字被反复计数');
    near(s.itemAcc, 1 / 3, 0.001, '正确率被重复刷上去了');
    var s2 = MT2.MAT.scoreSeq(['海', '钟'], ['海', '海', '钟']);
    eq(s2.items, 2, '多写一遍的字被算成额外记住');
  });

  T('文本评分：逐字 / 关键词 / 顺序 三项独立', function () {
    var t = '门口那棵老槐树昨夜被风吹断了。';
    var keys = ['门口', '老槐树', '昨夜', '风', '吹断'];
    var full = MT2.MAT.scoreText(t, t, keys);
    near(full.verbatim, 1, 0.001, '原样抄写的逐字分');
    near(full.keyword, 1, 0.001, '关键词');
    near(full.order, 1, 0.001, '顺序');
    var none = MT2.MAT.scoreText(t, '完全不相干的内容', keys);
    eq(none.keysHit, 0);
    assert(none.verbatim < 0.3, '不相干的内容拿到了 ' + none.verbatim);
  });

  T('文本评分：关键词齐但顺序颠倒，顺序分要掉', function () {
    var t = '他先去银行取了钱，又绕到药店买了退烧药。';
    var keys = ['银行', '取钱', '药店', '退烧药'];
    var rev = MT2.MAT.scoreText(t, '退烧药，药店，取钱，银行', keys);
    near(rev.keyword, 1, 0.001, '关键词应该全中');
    assert(rev.order < 0.6, '顺序完全颠倒却拿了 ' + rev.order);
  });

  T('文本评分：只记住大意、没记住原话时逐字分低但关键词分不为零', function () {
    var t = '会议推迟到下周二上午十点，地点从二楼小厅改到了四楼的东侧会议室。';
    var keys = ['推迟', '下周二', '上午十点', '二楼小厅', '四楼', '东侧会议室'];
    var s = MT2.MAT.scoreText(t, '会议改到下周二，换到四楼开', keys);
    assert(s.keysHit >= 2, '关键词一个都没匹配上');
    assert(s.verbatim < 0.6, '逐字分不该这么高');
  });

  // ==========================================================
  G('P3 直接记忆流程');

  function dmStage(plan, kind) {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    DM.start(kind || 'training', plan, null);
  }
  function dmType(str) { document.getElementById('dm-seq-input').value = str; }

  T('呈现阶段结束后材料被清空', function () {
    dmStage([{ kind: 'random', len: 3, exposureMs: 10 }]);
    assert(document.getElementById('dm-material').innerHTML.length > 0, '呈现阶段没显示材料');
    DM.trial.target = ['海', '钟', '纸'];
    clearTimeout(DM.exposeTimer);
    DM.recall();
    eq(document.getElementById('dm-expose').style.display, 'none');
    eq(document.getElementById('dm-recall').style.display, 'block');
  });

  T('回忆阶段不给任何选项（自主回忆，不是再认）', function () {
    dmStage([{ kind: 'random', len: 4, exposureMs: 10 }]);
    DM.recall();
    var panel = document.getElementById('dm-recall');
    eq(panel.querySelectorAll('button.mt-calib-opt, .dm-option').length, 0, '出现了备选项');
    var btns = panel.querySelectorAll('button');
    eq(btns.length, 2, '回忆面板应该只有提交和想不起来两个按钮');
  });

  T('提交后按位置逐格核对', function () {
    dmStage([{ kind: 'random', len: 3, exposureMs: 10 }]);
    DM.trial.target = ['海', '钟', '纸'];
    DM.recall(); dmType('海纸钟'); DM.submit();
    eq(DM.trial.score.positions, 1);
    eq(DM.trial.score.items, 3);
    var slots = document.querySelectorAll('#dm-fb-body .dm-slot');
    eq(slots.length, 3);
    assert(slots[0].classList.contains('ok'), '第一格应判对');
    assert(slots[1].classList.contains('bad'), '第二格应判错');
  });

  T('「完全想不起来」记 0 分而不是跳过', function () {
    dmStage([{ kind: 'random', len: 4, exposureMs: 10 }]);
    DM.trial.target = ['海', '钟', '纸', '月'];
    DM.recall(); DM.submit(true);
    eq(DM.trial.score.items, 0);
    DM.next();
    eq(MT2.db.direct.trials.length, 1, '空白试次没有被记录');
    eq(MT2.db.direct.trials[0].scores.item, 0);
  });

  T('有意义材料必须先自评大意才能继续', function () {
    dmStage([{ kind: 'meaningful', tier: 1 }]);
    DM.recall();
    document.getElementById('dm-text-input').value = '门口的老槐树昨夜被风吹断了';
    DM.submit();
    eq(document.getElementById('dm-gist').style.display, '', '没有要求自评大意');
    eq(document.getElementById('dm-next-btn').disabled, true, '没评就能继续');
    var before = MT2.db.direct.trials.length;
    DM.next();
    eq(MT2.db.direct.trials.length, before, '没评大意却记录了');
    DM.setGist(0.5);
    eq(document.getElementById('dm-next-btn').disabled, false);
    DM.next();
    eq(MT2.db.direct.trials.length, before + 1);
    eq(MT2.db.direct.trials[before].scores.gist, 0.5);
  });

  T('有意义材料写入延迟保持队列，且不重新呈现原文', function () {
    dmStage([{ kind: 'meaningful', tier: 1 }]);
    DM.recall();
    document.getElementById('dm-text-input').value = '随便写点';
    DM.submit(); DM.setGist(0); DM.next();
    var q = MT2.db.queue.filter(function (x) { return x.source === 'direct'; });
    assert(q.length >= 3, '没有排延迟测试，实际 ' + q.length);
    var labels = q.map(function (x) { return x.label; });
    assert(labels.indexOf('24h') !== -1, '缺 24h 那一档');
    assert(q[0].dueTs > Date.now(), '到期时间不在未来');
  });

  // ==========================================================
  G('P3 自适应与基线');

  T('难度按块调整，不因单次运气变动', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    var a = MT2.dmAdaptive();
    a.random.len = 4;
    for (var i = 0; i < 4; i++) DM.adapt({ kind: 'random', score: { itemAcc: 1 } });
    eq(MT2.dmAdaptive().random.len, 4, '不满一个块就调难度了');
    DM.adapt({ kind: 'random', score: { itemAcc: 1 } });
    eq(MT2.dmAdaptive().random.len, 5, '满一个块、全对，应该升难度');
    for (var i = 0; i < 5; i++) DM.adapt({ kind: 'random', score: { itemAcc: 0.2 } });
    eq(MT2.dmAdaptive().random.len, 4, '一直做不对应该降难度');
  });

  T('难度在中间区间保持不动', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    MT2.dmAdaptive().random.len = 5;
    for (var i = 0; i < 5; i++) DM.adapt({ kind: 'random', score: { itemAcc: 0.78 } });
    eq(MT2.dmAdaptive().random.len, 5, '70–85% 区间不该动难度');
  });

  T('基线计划：长度与次数固定，曝光锁死 3 秒', function () {
    reset();
    var plan = MT2.buildBaselinePlan();
    eq(plan.length, 25);
    var byLen = {};
    plan.forEach(function (p) {
      byLen[p.len] = (byLen[p.len] || 0) + 1;
      eq(p.exposureMs, 3000, '基线曝光被改了');
      eq(p.baseline, true);
    });
    eq(Object.keys(byLen).sort().join(','), '3,4,5,6,7');
    Object.keys(byLen).forEach(function (L) { eq(byLen[L], 5, L + ' 项的次数不对'); });
  });

  T('基线训练不参与自适应', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    MT2.dmAdaptive().random.len = 4;
    DM.kind = 'baseline';
    for (var i = 0; i < 10; i++) {
      DM.record({ kind: 'random', len: 7, baseline: true, exposureMs: 3000, recallMs: 1000,
                  score: { positionAcc: 1, itemAcc: 1, perfect: true } });
    }
    eq(MT2.dmAdaptive().random.len, 4, '基线试次污染了日常难度');
    DM.kind = 'training';
  });

  T('容量估计：在 77.5% 那条线上插值', function () {
    var c = MT2.computeCapacity({ 3: 1.0, 4: 0.96, 5: 0.79, 6: 0.57, 7: 0.31 });
    assert(c.value > 5 && c.value < 6, '容量落在 ' + c.value + '，应该在 5–6 之间');
    var ceil = MT2.computeCapacity({ 3: 1.0, 4: 1.0, 5: 1.0 });
    eq(ceil.ceiling, true, '全部达标时应标为触顶');
    eq(ceil.text, '≥ 5');
    var floor = MT2.computeCapacity({ 3: 0.5, 4: 0.3 });
    eq(floor.below, true, '最短的都不达标时应标为低于下限');
  });

  T('基线结果按条件存档，条件不同则拒绝比较', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    var mk = function (acc) {
      return [3, 4, 5, 6, 7].reduce(function (arr, L) {
        for (var i = 0; i < 5; i++) {
          arr.push({ kind: 'random', len: L, score: { itemAcc: acc(L) } });
        }
        return arr;
      }, []);
    };
    var b1 = MT2.saveBaseline(mk(function (L) { return L <= 4 ? 1 : L === 5 ? 0.8 : 0.4; }));
    assert(b1.capacity > 4, '容量算错了：' + b1.capacityText);
    eq(b1.exposureMs, 3000);
    eq(b1.lens.join(','), '3,4,5,6,7');
    var b2 = MT2.saveBaseline(mk(function (L) { return L <= 5 ? 1 : L === 6 ? 0.8 : 0.4; }));
    assert(MT2.baselineComparable(b1, b2), '同条件的两次基线被判为不可比');
    assert(b2.capacity > b1.capacity, '容量没有反映提升');
    var b3 = JSON.parse(JSON.stringify(b2)); b3.exposureMs = 5000;
    assert(!MT2.baselineComparable(b1, b3), '曝光时长不同却判为可比');
    var b4 = JSON.parse(JSON.stringify(b2)); b4.lens = [3, 4, 5];
    assert(!MT2.baselineComparable(b1, b4), '长度集合不同却判为可比');
  });

  T('仪表盘：没跑过基线时明确说日常训练不能当基线', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    for (var i = 0; i < 3; i++) {
      DM.record({ kind: 'random', len: 4, exposureMs: 3000, recallMs: 900,
                  score: { positionAcc: 0.75, itemAcc: 0.75, perfect: false } });
    }
    MT2.showDash();
    var html = document.getElementById('mt-dash-body').innerHTML;
    assert(html.indexOf('还没跑过标准化基线') > -1, '没有提示缺基线');
    assert(html.indexOf('自适应') > -1, '没有说明自适应长度不能当基线');
    showHome();
  });

  T('仪表盘：随机序列的迁移限制要写在明处', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    DM.record({ kind: 'random', len: 4, exposureMs: 3000, recallMs: 900,
                score: { positionAcc: 1, itemAcc: 1, perfect: true } });
    MT2.showDash();
    var html = document.getElementById('mt-dash-body').innerHTML;
    assert(html.indexOf('不太会迁移') > -1, '仪表盘没有标注迁移有限');
    showHome();
  });

  // ==========================================================
  G('P3 今日训练分段');

  T('15/20 分钟含直接记忆段，5 分钟不含', function () {
    reset();
    var s5 = MT2.buildSegments('5m').map(function (g) { return g.type; });
    eq(s5.join(','), 'retrieval', '5 分钟速练不该塞直接记忆');
    var s15 = MT2.buildSegments('15m');
    eq(s15.map(function (g) { return g.type; }).join(','), 'direct,retrieval');
    eq(s15[0].minutes, 5);
    eq(s15[1].minutes, 10, '剩下的时间没有留给提取');
    var s20 = MT2.buildSegments('20m');
    eq(s20[1].minutes, 15);
  });

  T('直接记忆段结束后自动进入提取段', function () {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {} };
    MT2.session = { segs: MT2.buildSegments('15m'), i: -1, preset: '15m' };
    MT2.runNextSegment();
    eq(document.getElementById('screen-direct').style.display, 'block', '没有先进直接记忆');
    DM.plan = [];            // 假装这一段已经做完
    DM.idx = 0;
    DM.finish();
    DM.continueSession();
    eq(document.getElementById('screen-training').style.display, 'block', '没有接上提取段');
    assert(deck.length > 0, '提取段没有题');
    eq(currentMode, 'today');
  });

  T('直接记忆计划里两类材料都有', function () {
    reset();
    var plan = MT2.buildDirectPlan(300);
    var kinds = {};
    plan.forEach(function (p) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
    assert(kinds.random > 0, '没有随机序列');
    assert(kinds.meaningful > 0, '没有有意义材料');
  });


  // ==========================================================
  G('P4 延迟保持队列');

  function resetDirect() {
    reset();
    MT2.db.direct = { trials: [], baselines: [], adaptive: {}, retention: [] };
    MT2.db.queue = [];
  }

  T('学过的有意义材料会排进五档保持队列', function () {
    resetDirect();
    DM.kind = 'training';
    DM.record({ kind: 'meaningful', modality: 'visual', tier: 1, text: '门口那棵老槐树昨夜被风吹断了。',
                keys: ['门口'], exposureMs: 4000, recallMs: 9000, gist: 1,
                score: { keyword: 1, verbatim: 0.8, order: 1 } });
    eq(MT2.db.queue.length, 5, '五档没排全');
    var labels = MT2.db.queue.map(function (q) { return q.label; }).join(',');
    eq(labels, '30s,5min,24h,3d,7d');
    MT2.db.queue.forEach(function (q) { assert(q.dueTs > q.createdTs, '到期时间不在曝光之后'); });
  });

  T('随机序列不排保持队列', function () {
    resetDirect();
    DM.kind = 'training';
    DM.record({ kind: 'random', modality: 'visual', len: 4, exposureMs: 3000, recallMs: 5000,
                score: { positionAcc: 1, itemAcc: 1, perfect: true } });
    eq(MT2.db.queue.length, 0, '序列试次也排了保持测试');
  });

  T('只有到期的才会被取出来', function () {
    resetDirect();
    var now = Date.now();
    MT2.db.queue = [
      { itemId: 'txt:A', label: '24h', dueTs: now + 3600e3, createdTs: now },
      { itemId: 'txt:B', label: '5min', dueTs: now - 60e3, createdTs: now - 360e3 }
    ];
    eq(MT2.dueRetention().length, 1);
    eq(MT2.takeRetention().itemId, 'txt:B');
  });

  T('到期最久的优先补测', function () {
    resetDirect();
    var now = Date.now();
    MT2.db.queue = [
      { itemId: 'txt:A', label: '5min', dueTs: now - 60e3, createdTs: now - 360e3 },
      { itemId: 'txt:B', label: '24h', dueTs: now - 3 * 864e5, createdTs: now - 4 * 864e5 }
    ];
    eq(MT2.takeRetention().itemId, 'txt:B', '积压最久的没有优先');
  });

  T('按真实经过时间分桶，不按标称档位', function () {
    eq(MT2.delayBucket(25e3).key, '30s');
    eq(MT2.delayBucket(400e3).key, '5min');
    eq(MT2.delayBucket(30 * 3600e3).key, '24h');
    // 标称 24h 但实际隔了 4 天 —— 必须记到 3d 那一桶
    eq(MT2.delayBucket(4 * 864e5).key, '3d', '迟到的测试还按 24h 记');
    eq(MT2.delayBucket(30 * 864e5).key, 'long');
  });

  T('结算记的是真实间隔和真实桶位', function () {
    resetDirect();
    var now = Date.now();
    var entry = { itemId: 'txt:A', source: 'direct', modality: 'visual',
                  label: '24h', dueTs: now - 10, createdTs: now - 4 * 864e5 };
    MT2.db.queue = [entry];
    MT2.resolveRetention(entry, { keyword: 0.6, verbatim: 0.2, order: 1, gist: 0.5 }, 4 * 864e5);
    var r = MT2.db.direct.retention[0];
    eq(r.scheduled, '24h', '没保留标称档位');
    eq(r.bucket, '3d', '桶位没按真实间隔算');
    near(r.actualDelayMs / 864e5, 4, 0.01, '真实间隔');
  });

  T('测完一项后，同一材料已到期的其它档位一并清掉，未到期的保留', function () {
    resetDirect();
    var now = Date.now();
    var due1 = { itemId: 'txt:A', label: '30s', dueTs: now - 5000, createdTs: now - 40e3 };
    var due2 = { itemId: 'txt:A', label: '5min', dueTs: now - 100, createdTs: now - 40e3 };
    var future = { itemId: 'txt:A', label: '24h', dueTs: now + 864e5, createdTs: now - 40e3 };
    var other = { itemId: 'txt:B', label: '30s', dueTs: now - 5000, createdTs: now - 40e3 };
    MT2.db.queue = [due1, due2, future, other];
    MT2.resolveRetention(due1, { keyword: 1, verbatim: 1, order: 1, gist: 1 }, 40e3);
    var ids = MT2.db.queue.map(function (q) { return q.itemId + ':' + q.label; });
    assert(ids.indexOf('txt:A:24h') !== -1, '未到期的档位被误删');
    eq(ids.indexOf('txt:A:5min'), -1, '同材料已到期的档位没有一起清掉');
    eq(ids.indexOf('txt:A:30s'), -1, '刚测过的条目还留在队列里');
    assert(ids.indexOf('txt:B:30s') !== -1, '别的材料被误删');
  });

  T('保持测试不会再往队列里加新条目', function () {
    resetDirect();
    var now = Date.now();
    var entry = { itemId: 'txt:A', label: '30s', dueTs: now - 100, createdTs: now - 40e3 };
    MT2.db.queue = [entry];
    DM.record({ kind: 'delayed', entry: entry, text: 'A', keys: [], cue: 'A',
                actualDelayMs: 40e3, gist: 1, score: { keyword: 1, verbatim: 1, order: 1 } });
    eq(MT2.db.queue.length, 0, '保持测试自己又排了一轮，会无限循环');
    eq(MT2.db.direct.retention.length, 1);
  });

  T('保持测试不写进普通试次表（不然会污染即时正确率）', function () {
    resetDirect();
    var now = Date.now();
    var entry = { itemId: 'txt:A', label: '24h', dueTs: now - 100, createdTs: now - 864e5 };
    MT2.db.queue = [entry];
    DM.record({ kind: 'delayed', entry: entry, text: 'A', keys: [], cue: 'A',
                actualDelayMs: 864e5, gist: 0, score: { keyword: 0.2, verbatim: 0.1, order: null } });
    eq(MT2.db.direct.trials.length, 0, '延迟试次混进了即时试次表');
  });

  T('保持曲线按桶聚合，即时那一档来自原始试次', function () {
    resetDirect();
    DM.kind = 'training';
    DM.record({ kind: 'meaningful', modality: 'visual', tier: 1, text: '门口那棵老槐树昨夜被风吹断了。',
                keys: ['门口'], exposureMs: 4000, recallMs: 9000, gist: 1,
                score: { keyword: 0.9, verbatim: 0.8, order: 1 } });
    MT2.db.direct.retention.push({ ts: Date.now(), itemId: 'txt:X', modality: 'visual',
      scheduled: '24h', bucket: '24h', actualDelayMs: 864e5,
      scores: { keyword: 0.5, verbatim: 0.2, order: 1, gist: 0.5 } });
    var c = MT2.retentionCurve();
    near(c.immediate.keyword, 0.9, 0.001, '即时档');
    near(c['24h'].keyword, 0.5, 0.001, '24 小时档');
    eq(c.immediate.n, 1);
  });

  T('保持测试一轮最多补 8 项', function () {
    resetDirect();
    var now = Date.now();
    MT2.MAT.TEXTS.slice(0, 20).forEach(function (m) {
      MT2.db.queue.push({ itemId: 'txt:' + m.text, label: '24h', dueTs: now - 1000, createdTs: now - 864e5 });
    });
    DM.start('training', [], null);
    eq(DM.trial.kind, 'delayed', '没有开始补测');
    eq(DM.retentionBudget, 7, '第一项补测后预算应该只减一');
    DM.active = false;
  });

  T('材料已不在库里的队列条目被丢弃，但不占用补测名额', function () {
    resetDirect();
    var now = Date.now();
    MT2.db.queue.push({ itemId: 'txt:早就删掉的材料', label: '24h', dueTs: now - 1000, createdTs: now - 864e5 });
    MT2.db.queue.push({ itemId: 'txt:' + MT2.MAT.TEXTS[0].text, label: '24h', dueTs: now - 900, createdTs: now - 864e5 });
    DM.start('training', [], null);
    eq(DM.trial.kind, 'delayed');
    eq(DM.trial.text, MT2.MAT.TEXTS[0].text, '没有跳过失效条目继续补测');
    eq(DM.retentionBudget, 1, '失效条目占用了补测名额');
    DM.active = false;
  });

  T('基线测试不补保持测试', function () {
    resetDirect();
    var now = Date.now();
    MT2.db.queue.push({ itemId: 'txt:A', label: '24h', dueTs: now - 1000, createdTs: now - 864e5 });
    DM.start('baseline', [], null);
    eq(DM.retentionBudget, 0, '基线被保持测试插队，条件就不标准了');
    DM.active = false;
  });

  T('保持测试给的线索不算进逐字分', function () {
    resetDirect();
    var mat = MT2.MAT.TEXTS[0];
    var now = Date.now();
    var entry = { itemId: 'txt:' + mat.text, label: '24h', dueTs: now - 10, createdTs: now - 864e5 };
    MT2.db.queue = [entry];
    DM.start('training', [], null);
    DM.retentionBudget = 1;
    DM.runTrial();
    eq(DM.trial.kind, 'delayed', '没有取到保持测试');
    eq(DM.trial.cue, mat.text.slice(0, 3));
    // 落在线索里的关键词要从分母里剔掉，否则白送一个命中
    var inCue = mat.keys.filter(function (k) { return mat.text.indexOf(k) < DM.trial.cue.length; });
    assert(inCue.length > 0, '这条材料的第一个关键词不在线索里，换一条来测');
    // 只把线索那三个字原样写回去，逐字分应该是 0，不是「答对了开头」
    document.getElementById('dm-text-input').value = DM.trial.cue;
    DM.submit();
    eq(DM.trial.score.keysTotal, mat.keys.length - inCue.length, '线索里的关键词还算在分母里');
    assert(DM.trial.score.verbatim < 0.05,
           '只抄线索就拿了 ' + DM.trial.score.verbatim.toFixed(2) + ' 的逐字分');
    eq(DM.trial.score.keysHit, 0, '抄线索却算命中了关键词');
    DM.active = false;
  });

  // ==========================================================
  G('P4 听觉直接记忆');

  var realSpeak = MT2.tts.speak, realSupported = MT2.tts.supported;
  function fakeTTS(opts) {
    opts = opts || {};
    MT2.tts.spoken = [];
    MT2.tts.supported = function () { return opts.supported !== false; };
    // 同步 thenable：真 Promise 会跑到 dump-dom 之后，测试就抓不到了
    MT2.tts.pendingCb = null;
    MT2.tts.flush = function () { var c = MT2.tts.pendingCb; MT2.tts.pendingCb = null; if (c) c(); };
    MT2.tts.speak = function (text, o) {
      MT2.tts.spoken.push({ text: text, rate: o && o.rate });
      var fail = opts.fail, val = text.length * 200, manual = opts.manual;
      if (manual) {
        return { then: function (onOk) {
          MT2.tts.pendingCb = function () { if (!fail && onOk) onOk(val); };
          return { catch: function (onErr) {
            if (fail) MT2.tts.pendingCb = function () { onErr(new Error('tts-error:fake')); };
          } };
        } };
      }
      return {
        then: function (onOk) {
          if (!fail && onOk) onOk(val);
          return { catch: function (onErr) { if (fail && onErr) onErr(new Error('tts-error:fake')); } };
        }
      };
    };
  }
  function realTTS() { MT2.tts.speak = realSpeak; MT2.tts.supported = realSupported; }

  T('听觉呈现全程不显示原文', function () {
    resetDirect(); fakeTTS({ manual: true });
    DM.start('training', [{ kind: 'audioText', modality: 'audio', tier: 0 }], null);
    var text = DM.trial.text;
    var mat = document.getElementById('dm-material').textContent;
    eq(mat.indexOf(text), -1, '播放时把原文显示出来了，那就不是听觉测试');
    assert(mat.indexOf('播放中') > -1, '没有播放提示');
    eq(MT2.tts.spoken.length, 1, '没有调用语音');
    eq(MT2.tts.spoken[0].text, text);
    MT2.tts.flush();          // 语音播完
    eq(document.getElementById('dm-recall').style.display, 'block', '播完没有进回忆');
    var whole = document.getElementById('screen-direct').textContent;
    eq(whole.indexOf(text), -1, '回忆阶段把原文露出来了');
    DM.active = false; realTTS();
  });

  T('数字串按「三、七」这样念，避免被读成一个数', function () {
    eq(MT2.MAT.speakableSeq(['3', '7', '1']), '3、7、1');
    resetDirect(); fakeTTS();
    DM.start('training', [{ kind: 'audioSeq', modality: 'audio', len: 4 }], null);
    eq(MT2.tts.spoken[0].text, DM.trial.target.join('、'));
    DM.active = false; realTTS();
  });

  T('回忆阶段没有重放按钮', function () {
    resetDirect(); fakeTTS();
    DM.start('training', [{ kind: 'audioSeq', modality: 'audio', len: 4 }], null);
    DM.recall();
    var btns = document.getElementById('dm-recall').querySelectorAll('button');
    eq(btns.length, 2, '回忆面板多了按钮，可能是重放');
    var txt = document.getElementById('dm-recall').textContent;
    eq(txt.indexOf('重放'), -1, '出现了重放');
    eq(txt.indexOf('再听'), -1, '出现了再听一遍');
    DM.active = false; realTTS();
  });

  T('语音播放失败的试次作废，不记成答错', function () {
    resetDirect(); fakeTTS({ fail: true });
    DM.kind = 'training';
    DM.start('training', [{ kind: 'audioSeq', modality: 'audio', len: 4 }], null);
    var t = DM.trial;
    eq(t.voided, true, '失败的试次没有标记作废');
    assert(document.getElementById('dm-material').textContent.indexOf('失败') > -1, '没有告诉用户为什么作废');
    DM.record(t);
    eq(MT2.db.direct.trials.length, 0, '作废的试次被记成了成绩');
    eq(MT2.db.queue.length, 0, '作废的试次还排了保持测试');
    DM.active = false; realTTS();
  });

  T('语音不可用时拒绝开始，并说明原因', function () {
    resetDirect(); fakeTTS({ supported: false });
    var alerted = null, oldAlert = window.alert;
    window.alert = function (m) { alerted = m; };
    MT2.startAudioTraining(5);
    window.alert = oldAlert;
    assert(alerted && alerted.indexOf('语音') > -1, '没有提示语音不可用');
    eq(DM.active, false, '语音不可用却开始了训练');
    realTTS();
  });

  T('听觉与视觉分开记账', function () {
    resetDirect();
    DM.kind = 'training';
    DM.record({ kind: 'random', modality: 'visual', len: 5, exposureMs: 3000, recallMs: 4000,
                score: { positionAcc: 1, itemAcc: 1, perfect: true } });
    DM.record({ kind: 'audioSeq', modality: 'audio', len: 4, rate: 1, exposureMs: 2500, recallMs: 4000,
                score: { positionAcc: 0.5, itemAcc: 0.5, perfect: false } });
    var v = MT2.directSummary(null, 'visual'), a = MT2.directSummary(null, 'audio');
    eq(v.trials, 1); eq(a.trials, 1);
    near(v.itemAcc, 1, 0.001, '视觉成绩被听觉污染');
    near(a.itemAcc, 0.5, 0.001, '听觉成绩被视觉污染');
  });

  T('听觉与视觉的难度阶梯互不影响', function () {
    resetDirect();
    DM.kind = 'training';
    MT2.dmAdaptive().random.len = 4;
    MT2.dmAdaptive().audioSeq.len = 4;
    for (var i = 0; i < 5; i++) {
      DM.adapt({ kind: 'audioSeq', modality: 'audio', score: { itemAcc: 1 } });
    }
    eq(MT2.dmAdaptive().audioSeq.len, 5, '听觉难度没升');
    eq(MT2.dmAdaptive().random.len, 4, '听觉的成绩把视觉难度也拉上去了');
  });

  T('语音材料从短语档起步，不会降到句子档以下的负数', function () {
    resetDirect();
    DM.kind = 'training';
    MT2.dmAdaptive().audioText.tier = 0;
    for (var i = 0; i < 10; i++) {
      DM.adapt({ kind: 'audioText', modality: 'audio', gist: 0,
                 score: { keyword: 0, verbatim: 0, order: 0 } });
    }
    eq(MT2.dmAdaptive().audioText.tier, 0, '听觉文本档位掉到 0 以下了');
    MT2.dmAdaptive().meaningful.tier = 1;
    for (var i = 0; i < 10; i++) {
      DM.adapt({ kind: 'meaningful', modality: 'visual', gist: 0,
                 score: { keyword: 0, verbatim: 0, order: 0 } });
    }
    eq(MT2.dmAdaptive().meaningful.tier, 1, '视觉文本档位不该降到短语档');
  });

  T('语速被记录下来，混用时仪表盘要警告', function () {
    resetDirect(); fakeTTS();
    DM.kind = 'training';
    DM.record({ kind: 'audioSeq', modality: 'audio', len: 4, rate: 1, exposureMs: 2000, recallMs: 3000,
                score: { positionAcc: 1, itemAcc: 1, perfect: true } });
    eq(MT2.db.direct.trials[0].rate, 1, '没记语速');
    DM.record({ kind: 'audioSeq', modality: 'audio', len: 4, rate: 1.5, exposureMs: 1500, recallMs: 3000,
                score: { positionAcc: 1, itemAcc: 1, perfect: true } });
    var html = MT2.renderDirectCard('audio');
    assert(html.indexOf('不同的语速') > -1, '混用语速没有警告');
    realTTS();
  });

  T('今日训练在语音可用时把直接记忆段一分为二', function () {
    resetDirect(); fakeTTS();
    MT2.session = { segs: MT2.buildSegments('15m'), i: -1, preset: '15m' };
    MT2.runNextSegment();
    var mods = {};
    DM.plan.forEach(function (p) { mods[p.modality] = 1; });
    assert(mods.visual && mods.audio, '语音可用时听觉没有排进今日训练');
    DM.active = false; realTTS();
  });

  T('语音不可用时今日训练只排视觉，不报错', function () {
    resetDirect(); fakeTTS({ supported: false });
    MT2.session = { segs: MT2.buildSegments('15m'), i: -1, preset: '15m' };
    MT2.runNextSegment();
    var mods = {};
    DM.plan.forEach(function (p) { mods[p.modality] = 1; });
    assert(mods.visual, '没有视觉试次');
    assert(!mods.audio, '语音不可用却排了听觉试次');
    DM.active = false; realTTS();
  });

  // ==========================================================
  fakeToday(null);
  reset();

  function report() {
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
  }
  if (pending.length) Promise.all(pending).then(report); else report();
})();
