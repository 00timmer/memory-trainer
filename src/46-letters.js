// ============================================================
// 字母编码：用户自己的 A–Z（+ 部分小写）字母桩
// 答案 = 桩人物/物件；桥接词（Apple、Bee…）只在揭晓后作为提示出现 ——
// 放进答案里的话，反向卡（人物 → 字母）会被 Apple 直接泄题。
// 大小写是两套不同的桩，按不同编码记账。小写 h 用户还没定，暂不收录。
// ============================================================
var LZ = {};

LZ.ITEMS = {
  A: ['牛顿', 'Apple'],
  B: ['熊', 'Bee · 熊爱吃蜂蜜'],
  C: ['比鲁斯', 'Cat'],
  D: ['乔兹', 'Diamond · 钻石果实'],
  E: ['蛋蛋男爵', 'Egg'],
  F: ['鸣人', 'Fox · 九尾妖狐 · 数字 09'],
  G: ['卡库', 'Giraffe · 长颈鹿果实'],
  H: ['星矢', 'Horse · 天马 · 圣斗士星矢'],
  I: ['青雉', 'Ice · 冰冰果实 · 数字 00'],
  J: ['林俊杰', 'JJ · 唱歌 · KTV'],
  K: ['烬', 'King · 翼龙果实'],
  L: ['辛巴', 'Lion · 数码宝贝狮子兽'],
  M: ['孙悟空', 'Monkey'],
  N: ['甘福尔', 'Knight · 空岛 · 马 · 鸟'],
  O: ['娜美', 'Orange · 种橘子 · 宙斯天候棒'],
  P: ['乌龙', 'Pig · 龙珠 · 会变身的猪'],
  Q: ['奎因', 'Queen · 恐龙'],
  R: ['巨石强森', 'Rock · 肌肉男'],
  S: ['张伟', 'Snake · 律师'],
  T: ['腾虎', 'Tiger · 海军大将'],
  U: ['辉夜', 'UFO'],
  V: ['蔬菜人', 'Vegetable · 龙珠 · 自爆'],
  W: ['二代火影', 'Water'],
  X: ['雏田', 'X-ray · 白眼'],
  Y: ['特兰克斯', 'Year · 时间机器 · 对应 12'],
  Z: ['兔子警官', 'Zoo · Zootopia'],
  a: ['马斯克', 'auto · 车 · 特斯拉'],
  b: ['宠物狗', 'brownie'],
  c: ['砂糖', 'candy'],
  d: ['神笔马良', 'drawer'],
  e: ['梅利号', 'elf · 船精灵'],
  f: ['马红骏', 'phoenix · 凤凰'],
  g: ['川普', 'golf']
};

LZ.DATA = {};
Object.keys(LZ.ITEMS).forEach(function (k) { LZ.DATA[k] = LZ.ITEMS[k][0]; });
BUILTIN.letters = { name: '🔤 字母编码', data: LZ.DATA };

LZ.UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
LZ.LOWER = Object.keys(LZ.ITEMS).filter(function (k) { return /[a-z]/.test(k); });

var _lzOrigGroups = getCodeGroups;
getCodeGroups = function () {
  if (currentDeckId === 'letters') {
    return [
      { label: '大写 A–M', codes: LZ.UPPER.slice(0, 13) },
      { label: '大写 N–Z', codes: LZ.UPPER.slice(13) },
      { label: '小写（' + LZ.LOWER.join(' ') + '）', codes: LZ.LOWER.slice() }
    ];
  }
  return _lzOrigGroups();
};

// 同一个字母的大小写是两套桩，最容易串
var _lzOrigConfusable = getConfusable;
getConfusable = function () {
  if (currentDeckId === 'letters') return LZ.LOWER.map(function (c) { return [c.toUpperCase(), c]; });
  return _lzOrigConfusable();
};

// 揭晓后的提示：桥接词
MZ.HINTS.letters = function (code) {
  var it = LZ.ITEMS[code];
  return it ? code + ' = ' + it[0] + ' · ' + it[1] : '';
};
