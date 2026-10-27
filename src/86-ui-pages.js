// ============================================================
// 其他页面套用同一套分组版式：卡片标题移到框外，成为小节标题
// 各页面的卡片是渲染时动态生成的，所以用 MutationObserver 统一处理，
// 不必逐个改每个渲染函数。只移动标题节点，不动卡片内容和点击行为。
// ============================================================
MT2.sectionize = function (root) {
  Array.prototype.forEach.call((root || document).querySelectorAll('.mt-card'), function (card) {
    if (card.getAttribute('data-ui')) return;
    var h = card.firstElementChild;
    if (!h || !h.classList.contains('mt-card-h')) return;
    // 结束页里的本轮延迟卡片嵌在 summary-card 里，标题留在原处
    if (card.closest('.summary-card')) return;
    card.setAttribute('data-ui', '1');
    h.classList.remove('mt-card-h');
    h.classList.add('ui-sec-h');
    Array.prototype.forEach.call(h.querySelectorAll('.mt-sub'), function (s) { s.classList.add('ui-sec-sub'); });
    card.parentNode.insertBefore(h, card);
    if (card.style.display === 'none') h.style.display = 'none';
  });
};

(function () {
  var pending = false;
  var run = function () { pending = false; MT2.sectionize(document); };
  var mo = new MutationObserver(function () {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(run);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  MT2.sectionize(document);
})();
