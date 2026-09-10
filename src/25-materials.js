// ============================================================
// 材料库 —— System A / B 需要「永远是新材料」，用 usedLedger 保证不重复
// ============================================================
MT2.MAT = {};

// 常用独体/高频字，尽量避免相邻成词。随机序列与标准化基线都从这里取。
MT2.MAT.CHARS = (
  '海钟纸月桥火山石田刀弓马牛羊鱼鸟虫木林森水冰雪风云雷电光影' +
  '门窗床桌椅碗杯瓶盆锅刀叉勺针线布衣帽鞋袜伞扇镜梳刷' +
  '手足耳目口鼻舌牙心肝肺胃骨血皮毛发指腰背肩肘膝' +
  '天地日星辰春夏秋冬东南西北中前后左右上下内外' +
  '金银铜铁锡玉珠宝钱票纸卡书笔墨砚印章旗鼓琴棋' +
  '米面油盐糖醋茶酒奶蛋肉菜果瓜豆麦稻粟薯蒜姜葱' +
  '车船飞舟桥路街巷村镇城池塔亭台楼阁寺庙宫殿园' +
  '走跑跳飞游爬滚落升沉浮沈推拉扛抱抬扔接握捏敲' +
  '红黄蓝绿白黑紫青灰棕粉橙银金深浅明暗浓淡艳素' +
  '声音响静吵闹哭笑喊叫唱吹打拍摇晃颤抖震荡鸣哨' +
  '刀枪剑戟盾甲盔袍带钩环链锁钥梯绳网笼箱柜架板' +
  '龙虎狮象狼熊鹿兔猫狗猪鸡鸭鹅鸽雀鹰蛇蛙蝶蜂蚁'
).split('');

// 有意义材料：keys 是关键词，用来自动打「关键词」和「顺序」两项分
// tier 1 短句 / 2 长句 / 3 两句 / 4 短段
MT2.MAT.TEXTS = [
  { tier: 1, text: '门口那棵老槐树昨夜被风吹断了。', keys: ['门口', '老槐树', '昨夜', '风', '吹断'] },
  { tier: 1, text: '他把钥匙落在了三楼的会议室里。', keys: ['钥匙', '三楼', '会议室'] },
  { tier: 1, text: '第二班渡轮六点半从北岸出发。', keys: ['第二班', '渡轮', '六点半', '北岸'] },
  { tier: 1, text: '厨房抽屉里有一把红柄的螺丝刀。', keys: ['厨房', '抽屉', '红柄', '螺丝刀'] },
  { tier: 1, text: '她在信封背面写了一串陌生的号码。', keys: ['信封', '背面', '一串', '陌生', '号码'] },
  { tier: 1, text: '仓库最里侧堆着四箱没拆封的瓷砖。', keys: ['仓库', '最里侧', '四箱', '没拆封', '瓷砖'] },
  { tier: 1, text: '午后的雨把整条石板路洗得发亮。', keys: ['午后', '雨', '石板路', '发亮'] },
  { tier: 1, text: '老板要求周五之前交出三份报价。', keys: ['老板', '周五', '三份', '报价'] },
  { tier: 1, text: '窗台上那盆花已经三周没有浇水。', keys: ['窗台', '花', '三周', '没有浇水'] },
  { tier: 1, text: '他记错了车次，站在了反方向的月台。', keys: ['记错', '车次', '反方向', '月台'] },

  { tier: 2, text: '会议推迟到下周二上午十点，地点从二楼小厅改到了四楼的东侧会议室。', keys: ['推迟', '下周二', '上午十点', '二楼小厅', '四楼', '东侧会议室'] },
  { tier: 2, text: '医生叮嘱他这瓶药每天两次，饭后服用，连续吃满十四天不要中断。', keys: ['医生', '每天两次', '饭后', '十四天', '不要中断'] },
  { tier: 2, text: '那家书店搬到了巷子深处，门面比原来小了一半，但二楼多出一个阅览区。', keys: ['书店', '巷子深处', '小了一半', '二楼', '阅览区'] },
  { tier: 2, text: '快递员说包裹已经放在物业前台，取件时需要报出手机尾号的后四位。', keys: ['快递员', '包裹', '物业前台', '手机尾号', '后四位'] },
  { tier: 2, text: '这条路在雨季经常积水，所以他们把发电机挪到了离地一米的水泥台上。', keys: ['雨季', '积水', '发电机', '离地一米', '水泥台'] },
  { tier: 2, text: '她辞掉了城里的工作，回到老家开了一间只在周末营业的小面馆。', keys: ['辞掉', '城里', '老家', '周末', '小面馆'] },
  { tier: 2, text: '合同里写明，如果三十日内未收到书面异议，条款将自动延续一年。', keys: ['合同', '三十日', '书面异议', '自动延续', '一年'] },
  { tier: 2, text: '实验做了七次才成功，前六次都是因为温度控制在了错误的区间。', keys: ['七次', '成功', '前六次', '温度控制', '错误区间'] },
  { tier: 2, text: '他把旧照片按年份分成四摞，最上面那摞的边角已经全部卷了起来。', keys: ['旧照片', '年份', '四摞', '最上面', '边角', '卷'] },
  { tier: 2, text: '巡逻队每隔两小时经过一次，唯独凌晨三点到五点之间会跳过这一段。', keys: ['巡逻队', '两小时', '凌晨三点', '五点', '跳过'] },

  { tier: 3, text: '仓库的钥匙一共有三把。一把在主管手里，一把挂在门卫室，最后一把不知去向。', keys: ['仓库', '钥匙', '三把', '主管', '门卫室', '不知去向'] },
  { tier: 3, text: '那年冬天特别冷，河面结的冰厚到可以走人。孩子们在上面滑了整整一个月。', keys: ['那年冬天', '特别冷', '河面', '冰厚', '走人', '一个月'] },
  { tier: 3, text: '他先去银行取了钱，又绕到药店买了退烧药。回家时发现门是虚掩着的。', keys: ['银行', '取钱', '药店', '退烧药', '门', '虚掩'] },
  { tier: 3, text: '项目分成三期。第一期修路，第二期建厂房，第三期要等明年的批文下来才能动。', keys: ['三期', '修路', '厂房', '明年', '批文'] },
  { tier: 3, text: '她说她记得那个电话号码，但只记得开头是零二一。剩下的八位怎么想都想不起来。', keys: ['电话号码', '零二一', '八位', '想不起来'] },
  { tier: 3, text: '船在第三天遇到了风暴。桅杆断了一根，好在货物都用绳网固定着，一件也没丢。', keys: ['第三天', '风暴', '桅杆', '断了一根', '绳网', '一件没丢'] },
  { tier: 3, text: '老屋的地基是青石垒的。后来加盖二层时用了红砖，两种材料的接缝至今还看得出来。', keys: ['地基', '青石', '二层', '红砖', '接缝'] },
  { tier: 3, text: '他把三个月的账目重新核了一遍。差额出在四月的一笔运费上，数字被多写了一个零。', keys: ['三个月', '账目', '差额', '四月', '运费', '多写一个零'] },

  { tier: 4, text: '早班车六点二十从村口发出，途经镇上的集市、中学和医院，终点是县城的老汽车站。整趟车大约要走五十分钟。如果遇上赶集日，在集市那一站可能会多停十分钟。', keys: ['六点二十', '村口', '集市', '中学', '医院', '老汽车站', '五十分钟', '赶集日', '多停十分钟'] },
  { tier: 4, text: '这台机器有四个警示灯。绿灯代表正常，黄灯代表需要检修，红灯必须立刻停机。第四个是蓝灯，只有在固件升级的时候才会亮，平时看到蓝灯说明有人动过设置。', keys: ['四个警示灯', '绿灯正常', '黄灯检修', '红灯停机', '蓝灯', '固件升级', '有人动过设置'] },
  { tier: 4, text: '他祖父留下三样东西：一只走时不准的怀表、一本封面脱落的账册，还有半张地契。怀表后来修好了，账册被虫蛀掉了大半，地契一直锁在铁盒里，谁也没打开看过。', keys: ['祖父', '三样东西', '怀表', '账册', '半张地契', '修好', '虫蛀', '铁盒'] },
  { tier: 4, text: '搬家那天下了雨。搬运工先把书搬上车，因为纸怕淋湿；家具最后装，用防水布盖着。到新住处已经是傍晚，电还没通，一屋子箱子只能靠手机的光一件件拆。', keys: ['搬家', '下雨', '书先搬', '纸怕淋湿', '家具最后', '防水布', '傍晚', '电没通', '手机的光'] },
  { tier: 4, text: '这份合同的关键在第七条。它规定任何一方要终止合作，必须提前九十天以挂号信的方式通知对方。口头通知和电子邮件都不算数。违反这一条的一方需要赔偿三个月的服务费。', keys: ['第七条', '终止合作', '提前九十天', '挂号信', '口头和邮件不算', '赔偿三个月服务费'] },
  { tier: 4, text: '他每天的路线几乎不变：七点出门，先在街角买一份报纸，然后步行穿过公园，在东门口的长椅上坐十分钟，八点整走进办公楼。只有下雨天他会改坐两站公交。', keys: ['七点出门', '街角', '报纸', '穿过公园', '东门口长椅', '十分钟', '八点整', '下雨改坐公交', '两站'] }
];

// ------------------------------------------------------------
// 取材料：优先没用过的；全部用过后重新开放，但避开最近 N 次用过的
// ------------------------------------------------------------
MT2.MAT.pickText = function (tier) {
  var pool = MT2.MAT.TEXTS.filter(function (t) { return t.tier === tier; });
  if (!pool.length) pool = MT2.MAT.TEXTS.slice();
  var fresh = pool.filter(function (t) { return !MT2.db.used['txt:' + t.text]; });
  var use = fresh.length ? fresh : pool.slice().sort(function (a, b) {
    return (MT2.db.used['txt:' + a.text] || 0) - (MT2.db.used['txt:' + b.text] || 0);
  }).slice(0, Math.max(1, Math.ceil(pool.length / 2)));
  var item = use[Math.floor(Math.random() * use.length)];
  MT2.db.used['txt:' + item.text] = Date.now();
  return item;
};

MT2.MAT.freshTextCount = function (tier) {
  return MT2.MAT.TEXTS.filter(function (t) {
    return t.tier === tier && !MT2.db.used['txt:' + t.text];
  }).length;
};

// 随机字符序列：同一序列内不重复
MT2.MAT.pickChars = function (n) {
  var pool = MT2.MAT.CHARS, out = [], seen = {};
  var guard = 0;
  while (out.length < n && guard++ < 2000) {
    var c = pool[Math.floor(Math.random() * pool.length)];
    if (seen[c]) continue;
    seen[c] = 1; out.push(c);
  }
  return out;
};

MT2.MAT.pickDigits = function (n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(String(Math.floor(Math.random() * 10)));
  return out;
};

// ------------------------------------------------------------
// 评分
// ------------------------------------------------------------
// 序列：位置正确 与 项目正确（不管顺序）分开算 —— 项目记忆和顺序记忆是两回事
MT2.MAT.scoreSeq = function (target, answer) {
  var n = target.length;
  var pos = 0;
  for (var i = 0; i < n; i++) if (answer[i] === target[i]) pos++;
  var pool = target.slice(), items = 0;
  answer.forEach(function (a) {
    var i = pool.indexOf(a);
    if (i !== -1) { pool.splice(i, 1); items++; }
  });
  return {
    n: n,
    positions: pos, positionAcc: n ? pos / n : 0,
    items: items, itemAcc: n ? Math.min(items, n) / n : 0,
    perfect: pos === n && answer.length === n
  };
};

function mtLevenshtein(a, b) {
  var m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}
MT2.MAT.levenshtein = mtLevenshtein;

// 最长递增子序列长度 —— 用来判断关键词有没有按原顺序出现
function mtLisLen(arr) {
  var tails = [];
  arr.forEach(function (v) {
    var lo = 0, hi = tails.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    tails[lo] = v;
  });
  return tails.length;
}

// 有意义材料：逐字 / 关键词 / 顺序 自动算，大意由用户自评
MT2.MAT.scoreText = function (target, answer, keys) {
  var norm = function (s) { return (s || '').replace(/[\s，。、；：？！,.;:?!"'「」（）()]/g, ''); };
  var t = norm(target), a = norm(answer);
  var dist = mtLevenshtein(t, a);
  var verbatim = t.length ? Math.max(0, 1 - dist / t.length) : 0;

  var found = [], hit = 0;
  (keys || []).forEach(function (k, idx) {
    var kk = norm(k);
    var at = a.indexOf(kk);
    if (kk && at !== -1) { hit++; found.push({ order: idx, at: at }); }
  });
  var keyword = (keys && keys.length) ? hit / keys.length : null;

  var order = null;
  if (found.length >= 2) {
    found.sort(function (x, y) { return x.at - y.at; });
    order = mtLisLen(found.map(function (f) { return f.order; })) / found.length;
  } else if (found.length === 1) {
    order = 1;
  }
  return { verbatim: verbatim, keyword: keyword, order: order, keysHit: hit,
           keysTotal: (keys || []).length, editDistance: dist };
};
