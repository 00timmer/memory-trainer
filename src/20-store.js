// ============================================================
// MT2 — 三系统重构：存储层 / 迁移 / 导出导入
// 旧 localStorage key 一律不删、不改写。新数据全部写新 key。
// ============================================================
var MT2 = {};
MT2.SCHEMA = 2;

// 提取延迟分档（带渐近线：<0.8s 已接近简单反应时下限，不再要求更快）
MT2.TIERS = [
  { max: 0.80, key: 'auto',   label: '⚡自动', color: '#3ddc84' },
  { max: 1.20, key: 'fast',   label: '快',     color: '#8bd450' },
  { max: 2.00, key: 'fluent', label: '流畅',   color: '#e8c547' },
  { max: 3.00, key: 'slow',   label: '慢',     color: '#f0883e' },
  { max: 1e9,  key: 'stuck',  label: '卡壳',   color: '#f0574a' }
];
MT2.tierOf = function (sec) {
  if (sec == null || !isFinite(sec)) return null;
  for (var i = 0; i < MT2.TIERS.length; i++) if (sec < MT2.TIERS[i].max) return MT2.TIERS[i];
  return MT2.TIERS[MT2.TIERS.length - 1];
};

MT2.DIR_LABEL = { fwd: '正向', rev: '反向', multi: '连读' };
MT2.STATUS_LABEL = ['未测/样本不足', '能正确提取', '能快速提取', '隔天仍能快速提取'];
MT2.MAX_TRIALS = 30;      // 每个 code+direction 保留的试次数
MT2.RECENT = 5;           // 滚动窗口

function mtLoad(key, def) {
  try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}

MT2.db = {
  retrieval: mtLoad('mt_retrieval', {}),
  weakness:  mtLoad('mt_weakness', {}),
  direct:    mtLoad('mt_direct', { trials: [], baselines: [], adaptive: {} }),
  encoding:  mtLoad('mt_encoding', { items: [], tta: [] }),
  queue:     mtLoad('mt_queue', []),
  used:      mtLoad('mt_materials_used', {}),
  settings:  mtLoad('mt_settings', {})
};

MT2.DEFAULTS = {
  calibRate: 0.20,      // 校准试次比例
  speedTarget: 2.0,     // 「正确但慢」阈值（秒）
  sessionLen: '15m',
  requeueGap: [3, 5]    // 答错后隔几张重测
};
MT2.cfg = function (k) {
  var v = MT2.db.settings[k];
  return v === undefined ? MT2.DEFAULTS[k] : v;
};
MT2.setCfg = function (k, v) { MT2.db.settings[k] = v; MT2.save(); };

MT2.save = function () {
  try {
    localStorage.setItem('mt_retrieval', JSON.stringify(MT2.db.retrieval));
    localStorage.setItem('mt_weakness', JSON.stringify(MT2.db.weakness));
    localStorage.setItem('mt_direct', JSON.stringify(MT2.db.direct));
    localStorage.setItem('mt_encoding', JSON.stringify(MT2.db.encoding));
    localStorage.setItem('mt_queue', JSON.stringify(MT2.db.queue));
    localStorage.setItem('mt_materials_used', JSON.stringify(MT2.db.used));
    localStorage.setItem('mt_settings', JSON.stringify(MT2.db.settings));
    localStorage.setItem('mt_schema_version', String(MT2.SCHEMA));
  } catch (e) { console.warn('MT2 save failed', e); }
};

// ------------------------------------------------------------
// 一次性迁移（幂等）。旧数据只读，不删除。
// 关键决定：旧 mastery level 3 只映射到 status 1「能正确提取」，
// 不映射到 2「能快速提取」—— 旧计时口径被污染，没有可信延迟数据。
// ------------------------------------------------------------
MT2.migrate = function () {
  if (localStorage.getItem('mt_migrated_v2') === '1') return;
  var deckId, code;
  for (deckId in allCardMastery) {
    var dm = allCardMastery[deckId];
    for (code in dm) {
      var old = dm[code];
      if (!old || !old.level) continue;
      var r = MT2.rec(deckId, code, 'fwd');
      if (r.trials.length) continue;              // 已有新数据则不覆盖
      r.status = old.level >= 1 ? 1 : 0;
      r.source = 'migrated';
      r.lastSeen = old.lastReview || null;
    }
  }
  for (deckId in allWeak) {
    var dw = allWeak[deckId];
    for (code in dw) {
      var w = MT2.weak(deckId, code, 'fwd');
      w.recall.active = true;
      w.recall.since = dw[code].addedDate || today();
      w.recall.migrated = true;
    }
  }
  localStorage.setItem('mt_migrated_v2', '1');
  MT2.save();
};

// ------------------------------------------------------------
// 导出 / 导入（P0：数据安全兜底，先于一切功能）
// ------------------------------------------------------------
MT2.EXPORT_KEYS = [
  'mt_deck', 'mt_phase', 'mt_udecks', 'mt_custom2', 'mt_weak2', 'mt_stats2',
  'mt_practiced', 'mt_card_mastery', 'mt_hidden_decks', 'mt_mode_settings',
  'mt_streak', 'mt_last_train',
  'mt_retrieval', 'mt_weakness', 'mt_direct', 'mt_encoding', 'mt_queue',
  'mt_materials_used', 'mt_settings', 'mt_schema_version', 'mt_migrated_v2'
];

MT2.exportData = function () {
  var out = { app: 'memory-trainer', schema: MT2.SCHEMA, exportedAt: new Date().toISOString(), data: {} };
  MT2.EXPORT_KEYS.forEach(function (k) {
    var v = localStorage.getItem(k);
    if (v !== null) out.data[k] = v;
  });
  var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'memory-trainer-' + today() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
};

MT2.importData = function (file, mode) {
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (e) { alert('文件不是有效的 JSON'); return; }
    if (!parsed || parsed.app !== 'memory-trainer' || !parsed.data) {
      alert('这不是本 App 导出的备份文件'); return;
    }
    var keys = Object.keys(parsed.data);
    var msg = '备份时间：' + (parsed.exportedAt || '未知') + '\n包含 ' + keys.length + ' 项数据。\n\n' +
              (mode === 'replace' ? '⚠️ 覆盖导入会清除当前设备上的全部训练数据。' : '合并导入：只补上当前设备没有的数据项。') +
              '\n\n确定继续？';
    if (!confirm(msg)) return;
    keys.forEach(function (k) {
      if (mode === 'replace' || localStorage.getItem(k) === null) {
        localStorage.setItem(k, parsed.data[k]);
      }
    });
    alert('导入完成，页面将重新加载。');
    location.reload();
  };
  reader.readAsText(file);
};
