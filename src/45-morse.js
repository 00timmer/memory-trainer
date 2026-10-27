// ============================================================
// 摩尔斯电码：用 0–99 数字桩（11 路飞 / 12 特兰克斯 / 21 香蕉鳄鱼 / 22 17·18号）
// 1 = ·（嘀）  2 = —（嗒）
//
// 接入方式：作为内置牌组 morse，复用 System C 的承诺→冻结→核对流程。
//   字母 → 编码  = 随机闪卡（fwd）
//   编码 → 字母  = 反向闪卡（rev）
//   听音 → 字母  = 新卡型 audio（aud），延迟从「播完」开始算
//   单词解码/编码 = 新卡型 wdec / waud / wenc，按单词记账，不污染单字母统计
// 故事只是过渡工具：答错时必定提示；「答案下显示故事」可以在熟练后关掉。
// 永远不考故事本身（脱桩原则）。
// ============================================================
var MZ = {};

MZ.CODES = {
  E: '1', T: '2', I: '11', A: '12', N: '21', M: '22',
  S: '111', U: '112', R: '121', W: '122', D: '211', K: '212', G: '221', O: '222',
  B: '2111', C: '2121', F: '1121', H: '1111', J: '1222', L: '1211', P: '1221',
  Q: '2212', V: '1112', X: '2112', Y: '2122', Z: '2211',
  '0': '22222', '1': '12222', '2': '11222', '3': '11122', '4': '11112',
  '5': '11111', '6': '21111', '7': '22111', '8': '22211', '9': '22221'
};

MZ.GROUPS = [
  { label: '第一组 · 1–2 位', codes: 'ETIANM'.split('') },
  { label: '第二组 · 3 位', codes: 'SURWDKGO'.split('') },
  { label: '第三组 · 4 位', codes: 'BCFHJLPQVXYZ'.split('') },
  { label: '数字 0–9（规律，不编故事）', codes: '1234567890'.split('') }
];

// 拆分 + 故事。统一句式：数字桩按编码顺序出场 → 最后落到这个字母自己的字母桩（A 牛顿、B 熊…）。
// 三位编码里单个信号：在开头说「先…」，在结尾说「最后…」，镜像对（W/G、D/U）就不会讲成同一句话。
// 例外：Y 的字母桩是特兰克斯，和数字桩 12 撞了 —— 用它会让 2122 被误还原出一个 12，所以 Y 落到「时间机器」。
// orig = 用户 prompt 里的原版故事，故事表里附在下面。
MZ.STORIES = {
  E: { split: '1', peg: '蛋蛋男爵', story: '「嘀」一声短响，吵醒了蛋蛋男爵', orig: 'E 发出一声短嘀' },
  T: { split: '2', peg: '腾虎', story: '「嗒——」一声长鸣，惊动了腾虎', orig: 'T 发出一声长嗒' },
  I: { split: '11', peg: '青雉', story: '路飞一拳打碎青雉的冰', orig: '路飞站直变成 I' },
  A: { split: '12', peg: '牛顿', story: '特兰克斯一剑劈开苹果，砸中牛顿', orig: '特兰克斯举着 A' },
  N: { split: '21', peg: '甘福尔', story: '香蕉鳄鱼一口咬住甘福尔', orig: '香蕉鳄鱼咬断 N' },
  M: { split: '22', peg: '孙悟空', story: '17、18 号和孙悟空打成一团', orig: '17 号和 18 号举起 M' },
  S: { split: '1+11', peg: '张伟', story: '先一道短闪光，路飞被晃了眼，撞上律师张伟',
       orig: '短闪光照到路飞胸前的 S' },
  U: { split: '11+2', peg: '辉夜', story: '路飞先出场，最后一道长闪电劈开辉夜的竹子',
       orig: '路飞拉出长闪电，弯成 U' },
  R: { split: '12+1', peg: '巨石强森', story: '特兰克斯先出场，最后一道短闪光照在巨石强森的肌肉上',
       orig: '特兰克斯按一次短闪按钮，出现 R' },
  W: { split: '1+22', peg: '二代火影', story: '先亮一道短闪光，17、18 号围攻二代火影',
       orig: '短闪光照亮 17、18 号的 W' },
  D: { split: '2+11', peg: '乔兹', story: '先劈下一道长闪电，路飞撞碎乔兹的钻石身体',
       orig: '长闪电劈中路飞的 D' },
  K: { split: '2+12', peg: '烬', story: '先劈下一道长闪电，特兰克斯跳上烬的翼龙背',
       orig: '长闪电劈中特兰克斯的 K' },
  G: { split: '22+1', peg: '卡库', story: '17、18 号先出场，最后一道短闪光照向卡库的长脖子',
       orig: '17、18 号被短闪光照亮，出现 G' },
  O: { split: '22+2', peg: '娜美', story: '17、18 号先出场，最后一道长闪电从娜美的天候棒里劈出',
       orig: '17、18 号发出一道长闪光，形成 O' },
  B: { split: '21+11', peg: '熊', story: '香蕉鳄鱼咬住路飞，熊冲过来抢蜂蜜', orig: '香蕉鳄鱼咬住路飞的 B 帽' },
  C: { split: '21+21', peg: '比鲁斯', story: '一条香蕉鳄鱼咬着另一条香蕉鳄鱼的尾巴，围住比鲁斯',
       orig: '两条香蕉鳄鱼围成 C' },
  F: { split: '11+21', peg: '鸣人', story: '路飞骑着香蕉鳄鱼去追鸣人', orig: '路飞骑香蕉鳄鱼挥舞 F 旗' },
  H: { split: '11+11', peg: '星矢', story: '路飞和路飞的分身一左一右，把星矢扶上天马', orig: '两个路飞手拉手变成 H' },
  J: { split: '12+22', peg: '林俊杰', story: '特兰克斯和 17、18 号在 KTV 抢林俊杰的麦', orig: '特兰克斯和 17、18 号钓出 J' },
  L: { split: '12+11', peg: '辛巴', story: '特兰克斯和路飞一起骑上辛巴', orig: '特兰克斯把路飞折成 L' },
  P: { split: '12+21', peg: '乌龙', story: '特兰克斯骑着香蕉鳄鱼追乌龙', orig: '特兰克斯骑香蕉鳄鱼举 P' },
  Q: { split: '22+12', peg: '奎因', story: '17、18 号追着特兰克斯，撞上恐龙奎因', orig: '17、18 号追着特兰克斯抢 Q' },
  V: { split: '11+12', peg: '蔬菜人', story: '路飞和特兰克斯把蔬菜人打到自爆', orig: '路飞与特兰克斯举起 V' },
  X: { split: '21+12', peg: '雏田', story: '香蕉鳄鱼和特兰克斯被雏田的白眼看穿', orig: '香蕉鳄鱼和特兰克斯交叉成 X' },
  Y: { split: '21+22', peg: '时间机器', story: '香蕉鳄鱼撞上 17、18 号，一起被吸进时间机器',
       orig: '香蕉鳄鱼撞上 17、18 号，撞出 Y' },
  Z: { split: '22+11', peg: '兔子警官', story: '17、18 号和路飞闯进动物城，被兔子警官开罚单', orig: '17、18 号把路飞折成 Z' }
};

// 分组口诀：单词只帮记「哪些字母在这一组」；按前两位数字桩排的顺序才能直接推出编码
MZ.PEG_NAMES = { '11': '路飞', '12': '特兰克斯', '21': '香蕉鳄鱼', '22': '17/18号' };
MZ.GROUP_AIDS = [
  { word: 'INMATE', order: 'E T · I A N M', note: 'E=1 T=2；I A N M = 11 12 21 22' },
  { word: 'DUG WORKS / DUSK GROW', order: 'SU · RW · DK · GO', note: '每对前一个 +1，后一个 +2' },
  { word: '', order: 'HVF · LPJ · BXCY · ZQ', note: '空格 1122 / 1212 / 2221 / 2222 没有英文字母' },
  null
];

// 按「前两位数字桩 × 剩余部分」排成表；空格 = 该编码没有英文字母
MZ.pegGrid = function (codes) {
  var len = MZ.CODES[codes[0]].length;
  if (len < 3) return null;
  var sufs = len === 3 ? ['1', '2'] : ['11', '12', '21', '22'];
  var byCode = {};
  codes.forEach(function (c) { byCode[MZ.CODES[c]] = c; });
  return ['11', '12', '21', '22'].map(function (pre) {
    return { pre: pre, peg: MZ.PEG_NAMES[pre],
             cells: sufs.map(function (suf) { return { suf: suf, letter: byCode[pre + suf] || '' }; }) };
  });
};

MZ.gridHtml = function (codes) {
  var g = MZ.pegGrid(codes);
  if (!g) return '';
  var h = '<table class="mz-grid"><tr><th>前两位</th>' +
    g[0].cells.map(function (c) { return '<th>+' + c.suf + '</th>'; }).join('') + '</tr>';
  g.forEach(function (row) {
    h += '<tr><td class="mz-gp">' + row.pre + ' ' + row.peg + '</td>' + row.cells.map(function (c) {
      return c.letter ? '<td class="mz-gl">' + c.letter + '</td>' : '<td class="mz-ge">—</td>';
    }).join('') + '</tr>';
  });
  return h + '</table>';
};

MZ.aidLine = function (i) {
  var a = MZ.GROUP_AIDS[i];
  if (!a) return '';
  return '口诀：<b>' + a.order + '</b>' + (a.word ? '（' + a.word + '）' : '');
};

MZ.DIGIT_RULE = '1–5 从左边逐个加短音；6–0 从左边逐个加长音';
MZ.digitHint = function (d) {
  var n = parseInt(d, 10);
  if (n >= 1 && n <= 5) return d + ' = 前 ' + n + ' 个短 + ' + (5 - n) + ' 个长';
  var k = n === 0 ? 5 : n - 5;
  return d + ' = 前 ' + k + ' 个长 + ' + (5 - k) + ' 个短';
};

// 镜像（倒序）和反相（1↔2）对：最容易互相误答
MZ.CONFUSABLE = [['E','T'],['I','M'],['A','N'],['S','O'],['D','U'],['G','W'],['K','R'],
                 ['B','V'],['F','L'],['Q','Y'],['X','P'],['B','J'],['S','H'],['H','5']];

MZ.WORDS = (
  'THE AND MAN TEN NET TIN TAN MAT MET MEN AIM ANT ATE EAT TEA TIE MAN ' +
  'SEA SET SIT SAT NOT NOW HOT HAT HIT HIM HER SHE SUN RUN FUN DOG CAT COW BOX FOX ' +
  'BED RED BAD DAD SON TOP CUP MAP PEN PIG EGG ICE OIL OWL KEY JOB JAM ZOO YES YOU ' +
  'WHY WAY WIN WET OLD END ' +
  'TEAM MEAT TIME MINT NAME MAIN TAME ITEM MEAN NEAT STAR STOP SHIP SHOP SNOW RAIN ' +
  'WIND FISH BIRD BOOK DOOR HOME HAND KING LOVE MOON NOTE ROAD ROOM SOUP TREE WAVE ' +
  'WORK YEAR ZERO QUIZ JUMP BLUE GOLD HELP HOPE ' +
  'RADIO WATER HOUSE MUSIC LIGHT NIGHT HAPPY GREEN TRAIN QUEEN PIANO ZEBRA EARTH ' +
  'HEART OCEAN TIGER MAGIC MORSE ' +
  'SIGNAL ANSWER WINTER SUMMER BRIDGE GARDEN PLANET ROCKET FRIEND'
).split(' ').filter(function (w, i, a) { return w && a.indexOf(w) === i; });

MZ.WORD_TYPES = { wdec: 1, waud: 1, wenc: 1 };
MZ.MODE_INFO = {
  'morse-audio': { name: '听音识字母', count: 20, type: 'audio' },
  'morse-wdec':  { name: '单词解码（看）', count: 10, type: 'wdec' },
  'morse-waud':  { name: '单词解码（听）', count: 10, type: 'waud' },
  'morse-wenc':  { name: '单词编码', count: 10, type: 'wenc' }
};

MZ.dots = function (c12) { return c12.replace(/1/g, '·').replace(/2/g, '—'); };
MZ.isWord = function (code) { return currentDeckId === 'morse' && !MZ.CODES[code] && /^[A-Z]{2,}$/.test(code); };
MZ.wordCode = function (w, sep) {
  return w.split('').map(function (ch) { return MZ.CODES[ch]; }).join(sep || ' / ');
};

// 牌组数据：答案 = 「12  ·—」，既保留你的数字写法，也让点划本身慢慢接手
MZ.DATA = {};
MZ.GROUPS.forEach(function (g) {
  g.codes.forEach(function (c) { MZ.DATA[c] = MZ.CODES[c] + '  ' + MZ.dots(MZ.CODES[c]); });
});
BUILTIN.morse = { name: '📡 摩尔斯电码', data: MZ.DATA };

MT2.DEFAULTS.morseWpm = 15;        // 字符速度（WPM）
MT2.DEFAULTS.morseFreq = 600;      // 音调 Hz
MT2.DEFAULTS.morseStory = true;    // 答案下显示故事（学习期开，熟练后关）
MT2.DIR_LABEL.aud = '听音';
MT2.DIR_LABEL.wdec = '单词解码';
MT2.DIR_LABEL.waud = '听单词';
MT2.DIR_LABEL.wenc = '单词编码';

Object.keys(MZ.MODE_INFO).forEach(function (m) {
  MODE_DEFAULTS[m] = MZ.MODE_INFO[m].count;
  MODE_NAMES[m] = MZ.MODE_INFO[m].name;
});

// 第一次进摩尔斯牌组：默认范围是第一组 ETIANM，允许重复（6 个字母撑不起 20 题）
MZ.seedRange = function () {
  if (modeSettings.morse) return;
  var first = MZ.GROUPS[0].codes.slice();
  modeSettings.morse = {};
  ['random', 'reverse', 'sprint', 'confusable', 'morse-audio',
   'morse-wdec', 'morse-waud', 'morse-wenc'].forEach(function (m) {
    modeSettings.morse[m] = { count: MODE_DEFAULTS[m], selected: first.slice(), repeat: true };
  });
  saveModeSettings();
};

// ------------------------------------------------------------
// 牌组接线
// ------------------------------------------------------------
var _mzOrigGroups = getCodeGroups;
getCodeGroups = function () {
  if (currentDeckId === 'morse') return MZ.GROUPS.map(function (g) { return { label: g.label, codes: g.codes.slice() }; });
  return _mzOrigGroups();
};

var _mzOrigConfusable = getConfusable;
getConfusable = function () {
  if (currentDeckId === 'morse') return MZ.CONFUSABLE.map(function (p) { return p.slice(); });
  return _mzOrigConfusable();
};

// 单词不在牌组数据里：答案就是它的编码
var _mzOrigGetName = getName;
getName = function (code) {
  if (MZ.isWord(code)) return MZ.wordCode(code);
  return _mzOrigGetName(code);
};

// 单词不进旧弱项表 —— 否则「弱项复习」会抽到一张不存在的卡
var _mzOrigAddWeak = addWeakItem;
addWeakItem = function (code) { if (MZ.isWord(code)) return; _mzOrigAddWeak(code); };
var _mzOrigMarkWeak = markWeakCorrect;
markWeakCorrect = function (code) { if (MZ.isWord(code)) return; _mzOrigMarkWeak(code); };

var _mzOrigDirOf = MT2.dirOf;
MT2.dirOf = function (t) {
  if (t === 'audio') return 'aud';
  if (MZ.WORD_TYPES[t]) return t;
  return _mzOrigDirOf(t);
};

MZ.wordsFor = function (letters) {
  return MZ.WORDS.filter(function (w) {
    return w.split('').every(function (ch) { return letters.indexOf(ch) !== -1; });
  });
};

var _mzOrigBuildDeck = buildDeck;
buildDeck = function (mode) {
  var info = MZ.MODE_INFO[mode];
  if (!info) return _mzOrigBuildDeck(mode);
  var codes = getFilteredCodes(), count = getModeCount(mode) || info.count;
  if (info.type === 'audio') {
    return pickCodes(codes, count, true).map(function (c) { return { type: 'audio', codes: [c] }; });
  }
  var words = MZ.wordsFor(codes);
  var out = [];
  while (out.length < count && words.length) out = out.concat(shuffle(words));
  return out.slice(0, count).map(function (w) { return { type: info.type, codes: [w] }; });
};

var _mzOrigStartMode = startMode;
startMode = function (mode) {
  var info = MZ.MODE_INFO[mode];
  if (info) {
    if (info.type === 'audio' || info.type === 'waud') {
      var why = MZ.audioProblem();
      if (why) { alert(why); return; }
      MZ.unlockAudio();   // 必须在点击手势里创建/恢复 AudioContext
    }
    if (MZ.WORD_TYPES[info.type]) {
      var n = MZ.wordsFor(getFilteredCodes()).length;
      if (n < 5) {
        alert('当前字母范围只能拼出 ' + n + ' 个单词，太少了。\n在范围里多勾几个字母（第一组 ETIANM 就能拼出 20 多个）。');
        return;
      }
    }
  }
  _mzOrigStartMode(mode);
};

// ------------------------------------------------------------
// 音频：Web Audio 正弦波。APK 的 WebView 也支持（和 Web Speech 不同）
// ------------------------------------------------------------
MZ.ctx = null;
MZ.playing = false;
MZ.playToken = 0;
MZ.audioProblem = function () {
  if (!(window.AudioContext || window.webkitAudioContext)) return '这个浏览器不支持 Web Audio，没法播放摩尔斯音。';
  return '';
};
MZ.unlockAudio = function () {
  try {
    if (!MZ.ctx) MZ.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (MZ.ctx.state === 'suspended') MZ.ctx.resume();
  } catch (e) { MZ.ctx = null; }
};

// 时长（秒）：点 1 单位、划 3 单位、元素间 1、字母间 3×2（学习期放宽字间距，字符本身仍按 WPM）
MZ.LETTER_GAP_UNITS = 6;
MZ.unitSec = function () { return 1.2 / (MT2.cfg('morseWpm') || 15); };
MZ.schedule = function (codes12) {
  var u = MZ.unitSec(), t = 0, marks = [];
  codes12.forEach(function (c, li) {
    if (li > 0) t += MZ.LETTER_GAP_UNITS * u;
    c.split('').forEach(function (sym, i) {
      if (i > 0) t += u;
      var len = (sym === '1' ? 1 : 3) * u;
      marks.push([t, len]); t += len;
    });
  });
  return { marks: marks, total: t };
};

// 返回 Promise：播完 resolve（按计算时长，不依赖音频事件，静音/无设备也能推进）
MZ.play = function (codes12) {
  var plan = MZ.schedule(codes12);
  var token = ++MZ.playToken;
  MZ.playing = true;
  try {
    MZ.unlockAudio();
    var ctx = MZ.ctx;
    if (ctx) {
      var t0 = ctx.currentTime + 0.08, f = MT2.cfg('morseFreq') || 600;
      plan.marks.forEach(function (m) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        var s = t0 + m[0], e = s + m[1];
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.5, s + 0.005);
        g.gain.setValueAtTime(0.5, e - 0.005);
        g.gain.linearRampToValueAtTime(0, e);
        o.connect(g); g.connect(ctx.destination);
        o.start(s); o.stop(e + 0.01);
      });
    }
  } catch (e) {}
  return new Promise(function (res) {
    setTimeout(function () {
      if (token === MZ.playToken) MZ.playing = false;
      res(token === MZ.playToken);
    }, plan.total * 1000 + 120);
  });
};
MZ.stop = function () { MZ.playToken++; MZ.playing = false; };

MZ.cardCodes12 = function (card) {
  var c = card.codes[0];
  if (MZ.CODES[c]) return [MZ.CODES[c]];
  return c.split('').map(function (ch) { return MZ.CODES[ch]; });
};

// ------------------------------------------------------------
// 训练屏：卡面 + 故事提示
// ------------------------------------------------------------
MZ.storyText = function (c) {
  if (/^[0-9]$/.test(c)) return MZ.digitHint(c) + '（规律：' + MZ.DIGIT_RULE + '）';
  var s = MZ.STORIES[c];
  if (!s) return '';
  return c + ' = ' + MZ.CODES[c] + '（' + s.split + '）· ' + s.story;
};

MZ.storyEl = function () {
  var el = mtEl('mz-story');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mz-story'; el.className = 'mz-story'; el.style.display = 'none';
    var a = mtEl('card-answer');
    a.parentNode.insertBefore(el, a.nextSibling);
  }
  return el;
};

// 其他牌组也可以在揭晓后挂提示（如字母编码的桥接词）：MZ.HINTS[deckId] = function (code) → 文本
MZ.HINTS = {};
MZ.hasHints = function () { return currentDeckId === 'morse' || !!MZ.HINTS[currentDeckId]; };

MZ.showStory = function (force) {
  if (!MZ.hasHints()) return;
  var card = deck[deckIndex];
  if (!card) return;
  var lines;
  if (currentDeckId !== 'morse') {
    lines = [MZ.HINTS[currentDeckId](card.codes[0])];   // 桥接词提示：揭晓后总是显示
  } else if (!force && !MT2.cfg('morseStory')) {
    return;
  } else if (MZ.WORD_TYPES[card.type]) {
    var w = card.codes[0];
    lines = w.split('').map(function (ch) { return ch + ' ' + MZ.CODES[ch] + ' ' + MZ.dots(MZ.CODES[ch]); });
    lines = [lines.join('　')];
  } else {
    lines = [MZ.storyText(card.codes[0])];
  }
  var el = MZ.storyEl();
  el.innerHTML = lines.map(function (l) { return l.replace(/</g, '&lt;'); }).join('<br>');
  el.style.display = '';
};
MZ.hideStory = function () { var el = mtEl('mz-story'); if (el) el.style.display = 'none'; };

MZ.replayBtn = function (show) {
  var b = mtEl('mz-replay');
  if (!b) {
    b = document.createElement('button');
    b.id = 'mz-replay'; b.className = 'mt-btn mz-replay';
    b.textContent = '🔁 再听一遍';
    b.onclick = function () { var c = deck[deckIndex]; if (c) MZ.play(MZ.cardCodes12(c)); };
    var a = mtEl('card-answer');
    a.parentNode.insertBefore(b, a.nextSibling);
  }
  b.style.display = show ? '' : 'none';
};

var _mzOrigShowCard = showCurrentCard;
showCurrentCard = function () {
  MZ.stop();
  MZ.hideStory();
  MZ.replayBtn(false);
  _mzOrigShowCard();
  if (currentDeckId !== 'morse') return;
  var card = deck[deckIndex];
  if (!card) return;
  var p = mtEl('card-prompt'), a = mtEl('card-answer');
  var c = card.codes[0];

  if (card.type === 'reverse' && MZ.CODES[c]) {
    p.style.fontSize = '40px';
  } else if (card.type === 'wdec') {
    p.textContent = MZ.wordCode(c); p.className = 'number'; p.style.fontSize = '30px';
    a.textContent = c + '　' + MZ.wordCode(c, ' ').split(' ').map(MZ.dots).join(' ');
  } else if (card.type === 'wenc') {
    p.textContent = c; p.className = 'number'; p.style.fontSize = '';
    a.textContent = MZ.wordCode(c);
  } else if (card.type === 'audio' || card.type === 'waud') {
    p.textContent = '🔊'; p.className = 'number'; p.style.fontSize = '';
    a.textContent = card.type === 'audio' ? c + '　' + getName(c) : c + '　' + MZ.wordCode(c);
    MZ.startListening(card);
  }
};

// 听音卡：播放期间不能承诺；延迟从「播完」那一刻开始算 —— 否则长字母天然吃亏
MZ.startListening = function (card) {
  var f2 = mtEl('f2-controls');
  f2.style.display = 'none';
  cancelAnimationFrame(timerRAF);
  mtEl('train-timer').textContent = '♪';
  mtEl('f1-countdown').textContent = '听……';
  var idx = deckIndex;
  MZ.play(MZ.cardCodes12(card)).then(function (current) {
    if (!current || deckIndex !== idx || mtCommitted) return;
    if (mtEl('screen-training').style.display === 'none') return;
    f2.style.display = 'flex';
    mtEl('f1-countdown').textContent = card.requeued ? '（刚才没答对，再试一次）' : '';
    cardStartTime = Date.now();
    mtT0 = performance.now();
    updateTimer();
  });
};

var _mzOrigCommit = mtCommit;
mtCommit = function () { if (MZ.playing) return; _mzOrigCommit(); };
var _mzOrigDontKnow = f2DontKnow;
f2DontKnow = function () {
  if (MZ.playing) return;
  var was = mtCommitted;
  _mzOrigDontKnow();
  if (!was && MZ.hasHints()) { MZ.showStory(true); MZ.afterReveal(); }
};

MZ.afterReveal = function () {
  var card = deck[deckIndex];
  if (card && (card.type === 'audio' || card.type === 'waud')) MZ.replayBtn(true);
};

// 校准试次：听音卡按「反向」出选项（选字母）；单词卡不做校准
var _mzOrigCalibOpts = mtBuildCalibOptions;
mtBuildCalibOptions = function (card) {
  if (card && MZ.WORD_TYPES[card.type]) return null;
  if (card && card.type === 'audio') return _mzOrigCalibOpts({ type: 'reverse', codes: card.codes });
  return _mzOrigCalibOpts(card);
};
var _mzOrigShowCalib = mtShowCalib;
mtShowCalib = function (card, opts) {
  if (card && card.type === 'audio') card = { type: 'reverse', codes: card.codes };
  _mzOrigShowCalib(card, opts);
};
var _mzOrigPickCalib = mtPickCalib;
mtPickCalib = function (chosen, correct, idx) {
  var was = revealed;
  _mzOrigPickCalib(chosen, correct, idx);
  if (!was && MZ.hasHints()) { MZ.showStory(chosen !== correct); MZ.afterReveal(); }
};

var _mzOrigShowAnswer = mtShowAnswerAndVerify;
mtShowAnswerAndVerify = function () {
  _mzOrigShowAnswer();
  if (MZ.hasHints()) { MZ.showStory(false); MZ.afterReveal(); }
};

// 自评「不会/错」：一定提示故事（答错时告诉你正确编码 + 对应的桩）
var _mzOrigRecord = mtRecordAndAdvance;
mtRecordAndAdvance = function (result, isCalib) {
  _mzOrigRecord(result, isCalib);
  if (MZ.hasHints() && result === 'dont_know' && mtAwaitContinue) MZ.showStory(true);
};

// 离开训练屏时停掉声音
var _mzOrigEndTraining = endTraining;
endTraining = function () { MZ.stop(); _mzOrigEndTraining(); };

// ------------------------------------------------------------
// 首页面板（只在摩尔斯牌组显示）
// ------------------------------------------------------------
MZ.groupProgress = function (g) {
  var n1 = 0, n2 = 0, meds = [];
  g.codes.forEach(function (c) {
    var r = MT2.recRO('morse', c, 'fwd');
    if (r && r.status >= 1) n1++;
    if (r && r.status >= 2) n2++;
    if (r && r.median !== null) meds.push(r.median);
  });
  return { correct: n1, fast: n2, total: g.codes.length, median: MT2.quantile(meds, 0.5) };
};

MZ.renderPanel = function () {
  var modes = document.getElementById('home-modes');
  if (!modes) return;
  var panel = document.getElementById('mz-panel');
  if (currentDeckId !== 'morse') { if (panel) panel.style.display = 'none'; return; }
  MZ.seedRange();
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'mz-panel'; panel.className = 'mz-panel';
  }
  var anchor = document.getElementById('mt-dm-entries');
  if (anchor) modes.insertBefore(panel, anchor.nextSibling);
  else if (panel.parentNode !== modes) modes.insertBefore(panel, modes.firstChild);
  panel.style.display = '';

  var icoN = 0;
  var ico = function (txt) {
    return '<div class="ui-ico" style="background:' + MT2.ICON_TINT[icoN++ % MT2.ICON_TINT.length] + '">' + txt + '</div>';
  };
  var row = function (icon, title, desc, onclick, right) {
    return '<div class="ui-row' + (onclick ? ' ui-chev' : '') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
      ico(icon) + '<div class="ui-txt"><div class="ui-t">' + title + '</div>' +
      (desc ? '<div class="ui-d">' + desc + '</div>' : '') + '</div>' + (right || '') + '</div>';
  };

  var prog = MZ.GROUPS.map(function (g, gi) {
    var p = MZ.groupProgress(g);
    var done = p.fast === p.total;
    var aid = MZ.GROUP_AIDS[gi];
    var desc = '能正确 ' + p.correct + '/' + p.total + ' · 能快速 ' + p.fast + '/' + p.total +
      (p.median !== null ? ' · 中位 ' + p.median.toFixed(2) + 's' : '') +
      (aid ? '<br><span class="mz-aid">口诀 ' + aid.order + (aid.word ? '（' + aid.word + '）' : '') + '</span>' : '');
    var badge = done ? '<span class="ui-badge ok">✓ 可加下一组</span>'
                     : '<span class="ui-badge">' + p.fast + '/' + p.total + '</span>';
    return row(gi < 3 ? String(gi + 1) : '#', g.label.split(' · ')[0].split('（')[0] + ' <span class="mz-letters">' + g.codes.join(' ') + '</span>',
               desc, '', badge);
  }).join('');

  icoN = 0;
  var drills = [
    ['A→', '字母 → 编码', '看字母，想出 1/2 编码', "openModeSettings('random')"],
    ['→A', '编码 → 字母', '看编码，认出字母', "openModeSettings('reverse')"],
    ['⏱', '1 秒冲刺', '限时识别，目标 < 0.8s', "openModeSettings('sprint')"],
    ['🔊', '听音识字母', '听嘀嗒，延迟从播完开始算', "openModeSettings('morse-audio')"],
    ['🔤', '单词解码（看）', '只用已加入范围的字母', "openModeSettings('morse-wdec')"],
    ['👂', '单词解码（听）', '', "openModeSettings('morse-waud')"],
    ['✏️', '单词编码', '看单词，写出每个字母的编码', "openModeSettings('morse-wenc')"],
    ['📖', '编码故事表', '口诀表 + 26 个故事', 'MZ.showStoryTable()']
  ].map(function (d) { return row(d[0], d[1], d[2], d[3]); }).join('');

  icoN = 0;
  var wpm = MT2.cfg('morseWpm'), story = MT2.cfg('morseStory');
  var wpmSel = '<select class="ui-select" onchange="MT2.setCfg(\'morseWpm\', parseInt(this.value,10))">' +
    [10, 13, 15, 18, 20, 25].map(function (v) {
      return '<option value="' + v + '"' + (v === wpm ? ' selected' : '') + '>' + v + ' WPM</option>';
    }).join('') + '</select>';
  var storySel = '<select class="ui-select" onchange="MT2.setCfg(\'morseStory\', this.value===\'1\'); MZ.renderPanel()">' +
    '<option value="1"' + (story ? ' selected' : '') + '>总是显示</option>' +
    '<option value="0"' + (!story ? ' selected' : '') + '>只在答错时</option></select>';

  panel.innerHTML =
    '<div class="ui-sec-h">摩尔斯进度 <span class="ui-sec-sub">1 = · 嘀　2 = — 嗒</span></div>' +
    '<div class="ui-group">' + prog + '</div>' +
    '<div class="ui-foot">在各练习的「选择编码范围」里一组一组加，组内全部「能快速」再加下一组。</div>' +
    '<div class="ui-sec-h">摩尔斯练习</div>' +
    '<div class="ui-group">' + drills + '</div>' +
    '<div class="ui-sec-h">摩尔斯设置</div>' +
    '<div class="ui-group">' +
      row('♪', '字符速度', '改了速度，前后的听音延迟不能直接比', '', wpmSel) +
      row('💬', '答案下显示故事', '学习期总是显示；组内都「能快速」后改成只在答错时', '', storySel) +
    '</div>';
};

var _mzOrigHomeUI = updateHomeUI;
updateHomeUI = function () { _mzOrigHomeUI(); MZ.renderPanel(); };

MZ.showStoryTable = function () {
  var m = document.getElementById('mz-story-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mz-story-modal'; m.className = 'modal-overlay';
    m.onclick = function (e) { if (e.target === m) closeModal('mz-story-modal'); };
    document.body.appendChild(m);
  }
  var h = '<div class="modal mz-table"><h3>📖 编码故事表</h3>' +
    '<div class="mt-note">11 路飞 · 12 特兰克斯 · 21 香蕉鳄鱼 · 22 17/18 号。四位一律 2+2 拆。' +
    '数字桩按编码顺序出场，最后落到字母自己的字母桩（A 牛顿、B 熊…）。' +
    '三位编码：单个信号在开头说「先…」，在结尾说「最后…」。' +
    'Y 的字母桩特兰克斯和数字桩 12 撞了，Y 改落到「时间机器」。每条下面附原版。</div>';
  MZ.GROUPS.forEach(function (g) {
    h += '<div class="mz-th">' + g.label + '</div>';
    var aid = MZ.GROUP_AIDS[MZ.GROUPS.indexOf(g)];
    if (aid) {
      h += '<div class="mz-aidbox">' + (aid.word ? '单词：<b>' + aid.word + '</b>（记这一组有哪些字母）<br>' : '') +
        '顺序：<b>' + aid.order + '</b> —— ' + aid.note + MZ.gridHtml(g.codes) + '</div>';
    }
    h += '<table>';
    g.codes.forEach(function (c) {
      var s = MZ.STORIES[c];
      h += '<tr><td class="mz-l">' + c + (s ? '<div class="mz-peg">' + s.peg + '</div>' : '') + '</td><td class="mz-c">' + MZ.CODES[c] + '<br><span>' +
        MZ.dots(MZ.CODES[c]) + '</span></td><td>' +
        (s ? s.story + (s.split.length > 2 ? '<span class="mt-sub">（' + s.split + '）</span>' : '') +
             (s.orig ? '<div class="mt-sub">原版：' + s.orig + '</div>' : '')
           : MZ.digitHint(c)) +
        '</td></tr>';
    });
    h += '</table>';
    if (g.codes[0] === '1') h += '<div class="mt-note">规律：' + MZ.DIGIT_RULE + '</div>';
  });
  h += '<div class="btn-row"><button class="btn-save" onclick="closeModal(\'mz-story-modal\')">关闭</button></div></div>';
  m.innerHTML = h;
  openModal('mz-story-modal');
};
