// ============================================================
// 延迟保持队列 —— System A / B 共用
// 关键约束：测试前绝不重新呈现原文，否则测的是重学而不是保持。
// 纯网页没有推送，所以做成到期队列：下次打开训练时优先插队。
// 记录的是「真实经过时间」而不是标称档位。
// ============================================================
MT2.RETENTION_STEPS = [
  { label: '30s', ms: 30e3 },
  { label: '5min', ms: 300e3 },
  { label: '24h', ms: 864e5 },
  { label: '3d', ms: 2592e5 },
  { label: '7d', ms: 6048e5 }
];

// 按真实间隔分桶。标称 24h 但实际隔了 4 天，就按 3d 记，不按 24h 记。
MT2.RETENTION_BUCKETS = [
  { key: 'immediate', label: '即时', max: 20e3 },
  { key: '30s',  label: '30 秒', max: 90e3 },
  { key: '5min', label: '5 分钟', max: 900e3 },
  { key: '1h',   label: '1 小时', max: 6 * 3600e3 },
  { key: '24h',  label: '24 小时', max: 48 * 3600e3 },
  { key: '3d',   label: '3 天', max: 6 * 864e5 },
  { key: '7d',   label: '7 天', max: 12 * 864e5 },
  { key: 'long', label: '更久', max: Infinity }
];

MT2.delayBucket = function (ms) {
  for (var i = 0; i < MT2.RETENTION_BUCKETS.length; i++) {
    if (ms < MT2.RETENTION_BUCKETS[i].max) return MT2.RETENTION_BUCKETS[i];
  }
  return MT2.RETENTION_BUCKETS[MT2.RETENTION_BUCKETS.length - 1];
};
MT2.delayLabel = function (ms) { return MT2.delayBucket(ms).label; };

MT2.fmtDelay = function (ms) {
  if (ms < 90e3) return Math.round(ms / 1000) + ' 秒';
  if (ms < 5400e3) return Math.round(ms / 60000) + ' 分钟';
  if (ms < 48 * 3600e3) return (ms / 3600e3).toFixed(1) + ' 小时';
  return (ms / 864e5).toFixed(1) + ' 天';
};

MT2.enqueueRetention = function (itemId, modality) {
  var now = Date.now();
  MT2.RETENTION_STEPS.forEach(function (st) {
    MT2.db.queue.push({
      itemId: itemId, source: 'direct', modality: modality || 'visual',
      label: st.label, dueTs: now + st.ms, createdTs: now
    });
  });
  if (MT2.db.queue.length > 2000) MT2.db.queue = MT2.db.queue.slice(-2000);
};

MT2.dueRetention = function (now) {
  now = now || Date.now();
  return MT2.db.queue.filter(function (q) { return q.dueTs <= now; });
};

// 取最该测的一条：到期最久的优先
MT2.takeRetention = function (now) {
  var due = MT2.dueRetention(now);
  if (!due.length) return null;
  due.sort(function (a, b) { return a.dueTs - b.dueTs; });
  return due[0];
};

// 结算一条：记真实间隔，并把同一材料所有「已经到期」的条目一并清掉
// —— 否则刚测完就会被同一材料的另一档再问一遍。未到期的保留。
MT2.resolveRetention = function (entry, scores, actualDelayMs) {
  var now = Date.now();
  if (scores) {
    if (!MT2.db.direct.retention) MT2.db.direct.retention = [];
    var b = MT2.delayBucket(actualDelayMs);
    MT2.db.direct.retention.push({
      ts: now, itemId: entry.itemId, source: entry.source || 'direct',
      modality: entry.modality || 'visual',
      scheduled: entry.label, bucket: b.key,
      actualDelayMs: Math.round(actualDelayMs),
      scores: scores
    });
    if (MT2.db.direct.retention.length > 2000) {
      MT2.db.direct.retention = MT2.db.direct.retention.slice(-2000);
    }
  }
  MT2.db.queue = MT2.db.queue.filter(function (q) {
    if (q.itemId !== entry.itemId) return true;
    return q.dueTs > now;      // 未到期的留着，已到期的连同本条一起清掉
  });
  MT2.save();
};

// ------------------------------------------------------------
// 保持曲线（仪表盘用）
// ------------------------------------------------------------
MT2.retentionCurve = function (modality) {
  var rows = (MT2.db.direct.retention || []).filter(function (r) {
    return !modality || r.modality === modality;
  });
  // 即时那一档来自原始试次本身，不在 retention 表里
  var imm = MT2.db.direct.trials.filter(function (t) {
    return (t.kind === 'meaningful' || t.kind === 'audioText') &&
           (!modality || t.modality === modality);
  });
  var out = {};
  function push(key, sc) {
    if (!out[key]) out[key] = { n: 0, keyword: 0, verbatim: 0, gist: 0 };
    out[key].n++;
    out[key].keyword += (sc.keyword || 0);
    out[key].verbatim += (sc.verbatim || 0);
    out[key].gist += (sc.gist || 0);
  }
  imm.forEach(function (t) { push('immediate', t.scores); });
  rows.forEach(function (r) { push(r.bucket, r.scores); });
  Object.keys(out).forEach(function (k) {
    var o = out[k];
    o.keyword /= o.n; o.verbatim /= o.n; o.gist /= o.n;
  });
  return out;
};

MT2.retentionStatus = function () {
  var due = MT2.dueRetention();
  var byItem = {};
  due.forEach(function (q) { byItem[q.itemId] = 1; });
  return {
    pending: MT2.db.queue.length,
    dueEntries: due.length,
    dueItems: Object.keys(byItem).length,
    tested: (MT2.db.direct.retention || []).length
  };
};
