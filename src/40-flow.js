// ============================================================
// 闪卡流程重建：cue → 按键承诺（冻结延迟）→ 显示答案 → 核对
// 删除：F1 强制 3 秒等待、翻牌后锁定延迟、revealTooFast 速度惩罚、
//       时间建议自评高亮、「不会」后同步跳下一张
// ============================================================
var mtT0 = 0, mtCommitted = false, mtLatency = null;
var mtBg = false, mtTimedOut = false, mtIsCalib = false;
var mtAwaitContinue = false, mtSessionTrials = [], mtMultiMissed = {};
var mtCalibChoice = null;

// 切后台的试次作废
document.addEventListener('visibilitychange', function () {
  if (document.hidden && !mtCommitted) mtBg = true;
});

function mtEl(id) { return document.getElementById(id); }

// 训练屏动态补充的 DOM（不改 base.html 布局）
function mtInjectTrainingDom() {
  var scr = mtEl('screen-training');
  if (!scr || mtEl('mt-calib')) return;
  var anchor = mtEl('judge-controls');
  var calib = document.createElement('div');
  calib.id = 'mt-calib'; calib.className = 'mt-calib'; calib.style.display = 'none';
  scr.insertBefore(calib, anchor);
  var miss = document.createElement('div');
  miss.id = 'mt-multimiss'; miss.className = 'mt-multimiss'; miss.style.display = 'none';
  scr.insertBefore(miss, anchor);
  var cont = document.createElement('div');
  cont.id = 'mt-continue'; cont.className = 'controls'; cont.style.display = 'none';
  cont.innerHTML = '<button class="btn-reveal" onclick="mtContinue()">继续 (空格)</button>';
  scr.insertBefore(cont, anchor.nextSibling);
}

function mtHideAll() {
  ['train-controls', 'judge-controls', 'f2-controls', 'mt-calib', 'mt-continue', 'mt-multimiss']
    .forEach(function (id) { var e = mtEl(id); if (e) e.style.display = 'none'; });
  mtEl('think-time-hint').style.display = 'none';
}

// ------------------------------------------------------------
// 出题
// ------------------------------------------------------------
function showCurrentCard() {
  if (deckIndex >= deck.length) { finishSession(); return; }
  mtInjectTrainingDom();
  var card = deck[deckIndex];
  revealed = false; judgeReady = false; currentFriction = 0;
  mtCommitted = false; mtLatency = null; mtBg = false;
  mtTimedOut = false; mtIsCalib = false; mtAwaitContinue = false;
  mtMultiMissed = {}; mtCalibChoice = null;
  if (f1Timer) { clearInterval(f1Timer); f1Timer = null; }
  if (lockInTimer) { clearTimeout(lockInTimer); lockInTimer = null; }

  var p = mtEl('card-prompt'), a = mtEl('card-answer');
  a.style.transition = 'none';
  a.classList.remove('visible'); a.classList.remove('answer-fade');
  a.textContent = ''; a.offsetHeight; a.style.transition = '';

  mtHideAll();
  mtEl('tap-hint').style.display = 'none';
  mtEl('f1-countdown').textContent = '';
  mtEl('train-progress').textContent = (deckIndex + 1) + ' / ' + deck.length;

  var isKids = ['kidsnumbers','kidsabc','hiragana','katakana','jpwords','jpkatawords',
                'jpparticles','bopomofo','bopomofocb'].indexOf(currentDeckId) !== -1;
  var cardEl = p.closest('.card');
  if (cardEl) cardEl.classList.toggle('kids-card', isKids);

  if (card.type === 'reverse') {
    p.innerHTML = getName(card.codes[0]); p.className = 'number'; p.style.fontSize = '48px';
    a.textContent = card.codes[0];
  } else if (card.type === 'multi') {
    p.innerHTML = card.codes.map(formatCode).join('&nbsp;&nbsp;');
    p.className = 'number multi'; p.style.fontSize = '';
    a.textContent = card.codes.map(function (c) { return getName(c); }).join(' + ');
  } else {
    p.innerHTML = formatCode(card.codes[0]); p.className = 'number'; p.style.fontSize = '';
    a.textContent = getName(card.codes[0]);
  }

  var sb = mtEl('sprint-bar');
  if (card.type === 'sprint') {
    var tl = currentPhase === 1 ? 3000 : currentPhase === 2 ? 2000 : 1500;
    startSprintTimer(tl); sb.style.display = '';
  } else { sb.style.display = 'none'; stopSprintTimer(); }

  // 承诺按钮：所有卡片一致，无强制等待
  var f2 = mtEl('f2-controls');
  f2.style.display = 'flex';
  f2.children[0].textContent = '✓ 我想到了 (空格)';
  f2.children[1].textContent = '✗ 不会';
  if (card.requeued) mtEl('f1-countdown').textContent = '（刚才没答对，再试一次）';

  cardStartTime = Date.now();
  mtT0 = performance.now();
  updateTimer();
}

// 计时器：承诺后立刻停住，不再往上走
function updateTimer() {
  var el = mtEl('train-timer');
  function tick() {
    if (mtEl('screen-training').style.display === 'none') return;
    if (mtCommitted) { cancelAnimationFrame(timerRAF); return; }
    el.textContent = ((performance.now() - mtT0) / 1000).toFixed(1) + 's';
    timerRAF = requestAnimationFrame(tick);
  }
  cancelAnimationFrame(timerRAF); tick();
}

// ------------------------------------------------------------
// 承诺：冻结延迟。此后所有时间都不计入。
// ------------------------------------------------------------
function revealCard() { mtCommit(); }
function f2Know() { mtCommit(); }

function mtCommit() {
  if (mtCommitted) return;
  mtCommitted = true;
  mtLatency = (performance.now() - mtT0) / 1000;
  mtEl('train-timer').textContent = mtLatency.toFixed(2) + 's';
  stopSprintTimer();
  mtEl('f2-controls').style.display = 'none';
  mtEl('f1-countdown').textContent = '';

  var card = deck[deckIndex];
  var opts = mtBuildCalibOptions(card);
  if (opts && Math.random() < MT2.cfg('calibRate')) {
    mtIsCalib = true;
    mtShowCalib(card, opts);
  } else {
    revealed = true;
    mtShowAnswerAndVerify();
  }
}

// 校准试次：先产出答案，再看对错。用来检查自评是否放水。
function mtBuildCalibOptions(card) {
  if (!card || card.type === 'multi') return null;
  var codes = getFilteredCodes();
  if (codes.length < 6) return null;
  var isRev = card.type === 'reverse';
  var correct = card.codes[0];
  var pool = codes.filter(function (c) { return c !== correct; });
  var labelOf = function (c) { return isRev ? c : getName(c); };
  var seen = {}; seen[labelOf(correct)] = 1;
  var picks = [];
  shuffle(pool).forEach(function (c) {
    if (picks.length >= 3) return;
    var l = labelOf(c);
    if (seen[l]) return;           // 名称重复（如地点表里的「冰箱」）不做干扰项
    seen[l] = 1; picks.push(c);
  });
  if (picks.length < 3) return null;
  return shuffle(picks.concat([correct]));
}

function mtShowCalib(card, opts) {
  var isRev = card.type === 'reverse';
  var correct = card.codes[0];
  var box = mtEl('mt-calib');
  box.innerHTML = '<div class="mt-calib-title">校准试次：先选出答案</div>' +
    opts.map(function (c) {
      var label = isRev ? c : getName(c);
      return '<button class="mt-calib-opt" data-code="' + c + '">' +
             label.replace(/</g, '&lt;') + '</button>';
    }).join('');
  box.style.display = '';
  Array.prototype.forEach.call(box.querySelectorAll('.mt-calib-opt'), function (b, i) {
    b.onclick = function () { mtPickCalib(b.getAttribute('data-code'), correct, i); };
  });
}

function mtPickCalib(chosen, correct, idx) {
  if (revealed) return;
  revealed = true; mtCalibChoice = chosen;
  var box = mtEl('mt-calib');
  Array.prototype.forEach.call(box.querySelectorAll('.mt-calib-opt'), function (b) {
    var c = b.getAttribute('data-code');
    if (c === correct) b.classList.add('ok');
    else if (c === chosen) b.classList.add('bad');
    b.onclick = null;
  });
  var ok = chosen === correct;
  var card = deck[deckIndex];
  var dir = MT2.dirOf(card.type);
  if (!ok) MT2.logConfusion(currentDeckId, correct, dir, chosen);
  mtEl('card-answer').classList.add('visible');
  mtShowLatencyReadout(ok ? '✓ 正确' : '✗ 选错了');
  mtRecordAndAdvance(ok ? 'remember' : 'dont_know', true);
}

// ------------------------------------------------------------
// 显示答案 + 自评（自评时间不计入延迟）
// ------------------------------------------------------------
function mtShowAnswerAndVerify() {
  mtEl('card-answer').classList.add('visible');
  mtShowLatencyReadout('');
  judgeReady = true;
  var jc = mtEl('judge-controls');
  jc.style.display = '';
  // 不再按用时高亮建议按钮 —— 速度不等于正确性
  ['btn-judge-remember', 'btn-judge-vague', 'btn-judge-dont'].forEach(function (id) {
    var b = mtEl(id); if (b) { b.style.boxShadow = ''; b.style.transform = ''; }
  });
}

function mtShowLatencyReadout(extra) {
  var hint = mtEl('think-time-hint');
  var tier = MT2.tierOf(mtLatency);
  var txt = '⏱ ' + mtLatency.toFixed(2) + 's';
  if (tier) txt += ' · <span style="color:' + tier.color + '">' + tier.label + '</span>';
  if (mtTimedOut) txt += ' · <span style="color:#f0574a">超时</span>';
  if (mtBg) txt += ' · <span style="color:#888">切后台，本次不计入</span>';
  if (extra) txt += ' · ' + extra;
  hint.innerHTML = txt;
  hint.style.display = '';
}

// ------------------------------------------------------------
// 「不会」：显示答案，给足阅读时间，隔几张重测
// ------------------------------------------------------------
function f2DontKnow() {
  if (mtCommitted) return;
  mtCommitted = true;
  mtLatency = (performance.now() - mtT0) / 1000;
  stopSprintTimer();
  revealed = true;
  mtEl('f2-controls').style.display = 'none';
  mtEl('card-answer').classList.add('visible');
  mtEl('train-timer').textContent = mtLatency.toFixed(2) + 's';
  mtShowLatencyReadout('看清楚答案再继续');
  mtRecordAndAdvance('dont_know', false);
}

// ------------------------------------------------------------
// 自评 → 记录 → 推进
// ------------------------------------------------------------
function judgeCard(result) {
  if (!revealed || mtAwaitContinue) return;
  mtRecordAndAdvance(result, mtIsCalib);
}

function mtRecordAndAdvance(result, isCalib) {
  var card = deck[deckIndex];
  var dir = MT2.dirOf(card.type);
  var ok = result !== 'dont_know';
  var vague = result === 'vague';

  mtEl('judge-controls').style.display = 'none';

  // 连读答错：让用户指出到底哪几个没答上，不再一起判错
  if (!ok && card.type === 'multi' && card.codes.length > 1 && !card._missPicked) {
    mtShowMultiMiss(card);
    return;
  }

  var missedSet = card._missPicked || null;
  card.codes.forEach(function (c) {
    var codeOk = ok;
    if (missedSet) codeOk = missedSet.indexOf(c) === -1;
    MT2.log(currentDeckId, c, dir, {
      ms: mtLatency, ok: codeOk, vague: vague && codeOk,
      calib: !!isCalib, timedOut: mtTimedOut, verifiedOk: ok,
      bg: mtBg, mode: currentMode
    });
    if (!codeOk) { addWeakItem(c); sessionMissed.push(c); }
    else { markWeakCorrect(c); }
  });
  recordPracticed(card.codes);

  mtSessionTrials.push({ ms: mtLatency, ok: ok, vague: vague, calib: !!isCalib,
                         timedOut: mtTimedOut, bg: mtBg, dir: dir });
  if (!mtBg && ok && !mtTimedOut) sessionTimes.push(mtLatency);
  if (ok && !vague) sessionCorrect++; else if (vague) sessionVague++; else sessionWrong++;

  if (!ok || isCalib) {
    if (!ok) mtRequeue(card);
    mtAwaitContinue = true;
    mtEl('mt-continue').style.display = '';
    return;
  }
  mtNext();
}

function mtShowMultiMiss(card) {
  var box = mtEl('mt-multimiss');
  var picked = [];
  box.innerHTML = '<div class="mt-calib-title">哪几个没答上？（点选后继续）</div>' +
    card.codes.map(function (c) {
      return '<button class="mt-miss-chip" data-code="' + c + '">' +
             formatCode(c) + ' → ' + getName(c) + '</button>';
    }).join('') +
    '<button class="mt-miss-done">确定</button>';
  box.style.display = '';
  Array.prototype.forEach.call(box.querySelectorAll('.mt-miss-chip'), function (b) {
    b.onclick = function () {
      var c = b.getAttribute('data-code');
      var i = picked.indexOf(c);
      if (i === -1) { picked.push(c); b.classList.add('on'); }
      else { picked.splice(i, 1); b.classList.remove('on'); }
    };
  });
  box.querySelector('.mt-miss-done').onclick = function () {
    card._missPicked = picked.length ? picked : card.codes.slice();
    box.style.display = 'none';
    mtRecordAndAdvance('dont_know', mtIsCalib);
  };
}

// 答错的卡片隔 3–5 张重测一次（只重排一次，避免无限循环）
function mtRequeue(card) {
  if (card.requeued) return;
  var gap = MT2.cfg('requeueGap');
  var g = gap[0] + Math.floor(Math.random() * (gap[1] - gap[0] + 1));
  var pos = Math.min(deck.length, deckIndex + 1 + g);
  deck.splice(pos, 0, { type: card.type, codes: card.codes.slice(), requeued: true });
}

function mtContinue() {
  if (!mtAwaitContinue) return;
  mtAwaitContinue = false;
  mtEl('mt-continue').style.display = 'none';
  mtNext();
}

function mtNext() { deckIndex++; showCurrentCard(); }

// ------------------------------------------------------------
// 冲刺：超时单独记录，超时后的「认识」不算限时成功
// ------------------------------------------------------------
function startSprintTimer(ms) {
  stopSprintTimer();
  var fill = mtEl('sprint-fill');
  fill.style.width = '100%'; fill.className = 'fill';
  var st = performance.now();
  sprintInterval = setInterval(function () {
    var p = Math.max(0, 1 - (performance.now() - st) / ms) * 100;
    fill.style.width = p + '%';
    fill.className = p < 20 ? 'fill danger' : p < 50 ? 'fill warning' : 'fill';
    if (performance.now() - st >= ms) {
      stopSprintTimer();
      mtTimedOut = true;
      mtCommit();
    }
  }, 50);
}

// 空格在等待「继续」时推进
document.addEventListener('keydown', function (e) {
  if (document.querySelector('.modal-overlay.show')) return;
  if (mtEl('screen-training').style.display === 'none') return;
  if (e.code === 'Space' && mtAwaitContinue) { e.preventDefault(); mtContinue(); }
  if (mtIsCalib && !revealed && /^Digit[1-4]$/.test(e.code)) {
    var box = mtEl('mt-calib');
    var btns = box ? box.querySelectorAll('.mt-calib-opt') : [];
    var i = parseInt(e.code.slice(5), 10) - 1;
    if (btns[i]) { e.preventDefault(); btns[i].click(); }
  }
}, true);
