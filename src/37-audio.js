// ============================================================
// 听觉呈现 —— Web Speech API
// Android WebView 不支持 speechSynthesis，APK 里会自动置灰并说明原因。
// ============================================================
MT2.tts = {
  voices: [], voice: null, probed: false, lastError: '',

  probe: function (cb) {
    var self = this;
    if (!('speechSynthesis' in window)) {
      self.probed = true; self.lastError = 'no-api';
      if (cb) cb(false); return;
    }
    var tries = 0;
    (function load() {
      var v = [];
      try { v = window.speechSynthesis.getVoices() || []; } catch (e) { v = []; }
      if (v.length || tries++ > 12) {
        self.voices = v;
        self.voice = self.pickVoice(v);
        self.probed = true;
        if (!v.length) self.lastError = 'no-voices';
        else if (!self.voice) self.lastError = 'no-zh-voice';
        else self.lastError = '';
        if (cb) cb(!!self.voice);
        return;
      }
      setTimeout(load, 120);
    })();
  },

  pickVoice: function (v) {
    var pref = null;
    v.forEach(function (x) {
      var l = (x.lang || '').toLowerCase();
      if (!pref && (l.indexOf('zh-cn') === 0 || l.indexOf('zh_cn') === 0)) pref = x;
    });
    if (!pref) v.forEach(function (x) {
      if (!pref && (x.lang || '').toLowerCase().indexOf('zh') === 0) pref = x;
    });
    return pref;
  },

  supported: function () { return this.probed && !!this.voice; },

  reason: function () {
    if (!('speechSynthesis' in window)) return '这个浏览器不支持 Web Speech API。Android WebView（APK 版）就属于这种情况——听觉训练请用网页版。';
    if (this.lastError === 'no-voices') return '系统里没有可用的语音包。macOS 在「系统设置 → 辅助功能 → 朗读内容」里添加中文语音，Windows 在「时间和语言 → 语音」里添加。';
    if (this.lastError === 'no-zh-voice') return '找到了 ' + this.voices.length + ' 个语音，但没有中文语音。需要在系统里装一个中文语音包。';
    return '';
  },

  // 播完才 resolve。返回实际播放时长，用作曝光时长。
  speak: function (text, opts) {
    opts = opts || {};
    var self = this;
    return new Promise(function (resolve, reject) {
      if (!self.supported()) { reject(new Error('tts-unavailable')); return; }
      try { window.speechSynthesis.cancel(); } catch (e) {}
      var u = new SpeechSynthesisUtterance(text);
      u.voice = self.voice;
      u.lang = self.voice.lang;
      u.rate = opts.rate || 1;
      u.pitch = 1;
      var t0 = performance.now(), done = false;
      var finish = function (err) {
        if (done) return; done = true;
        clearTimeout(guard);
        if (err) reject(err); else resolve(performance.now() - t0);
      };
      u.onend = function () { finish(null); };
      u.onerror = function (e) { finish(new Error('tts-error:' + (e && e.error || ''))); };
      // 播放卡死时不能把试次挂起：按字数给一个宽松上限
      var guard = setTimeout(function () {
        try { window.speechSynthesis.cancel(); } catch (e) {}
        finish(new Error('tts-timeout'));
      }, Math.max(8000, text.length * 900 + 6000));
      try { window.speechSynthesis.speak(u); }
      catch (e) { finish(new Error('tts-throw')); }
    });
  },

  stop: function () { try { window.speechSynthesis.cancel(); } catch (e) {} }
};

MT2.ttsTest = function () {
  MT2.tts.probe(function (ok) {
    if (!ok) { alert('语音不可用。\n\n' + MT2.tts.reason()); MT2.refreshAudioEntry(); return; }
    MT2.tts.speak('这是一段中文语音测试。', { rate: MT2.cfg('audioRate') || 1 })
      .then(function (ms) {
        alert('语音正常。\n使用的语音：' + MT2.tts.voice.name + '（' + MT2.tts.voice.lang + '）\n' +
              '这句话播了 ' + (ms / 1000).toFixed(1) + ' 秒。');
        MT2.refreshAudioEntry();
      })
      .catch(function (e) {
        alert('语音启动失败：' + e.message + '\n\n' + MT2.tts.reason());
        MT2.refreshAudioEntry();
      });
  });
};

MT2.refreshAudioEntry = function () {
  var e = document.getElementById('mt-audio-entry');
  if (!e) return;
  var d = document.getElementById('mt-audio-desc');
  if (MT2.tts.supported()) {
    e.classList.remove('disabled');
    var a = MT2.dmAdaptive();
    var ds = MT2.directSummary(30, 'audio');
    if (d) d.textContent = '当前 ' + a.audioSeq.len + ' 位数字串 · 语音材料 T' + a.audioText.tier +
      (ds.trials ? ' · 近 30 天 ' + ds.trials + ' 次' : ' · 还没练过');
  } else {
    e.classList.add('disabled');
    if (d) d.textContent = MT2.tts.probed ? MT2.tts.reason() : '正在检测语音…';
  }
};
