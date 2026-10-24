// ============================================================
// 顶部牌组：横向标签 → 下拉筛选
// 标签多了以后横向滚动找不到；下拉按类别分组。
// 长按隐藏的手势在 <select> 上做不了，改成旁边的「⋯」按钮。
// ============================================================
var DECK_CATEGORIES = [
  { label: '编码', ids: ['numbers', 'poker', 'locations', 'morse'] },
  { label: '日语', ids: ['hiragana', 'katakana', 'jpwords', 'jpkatawords', 'jpparticles'] },
  { label: '注音', ids: ['bopomofo', 'bopomofocb'] },
  { label: '儿童', ids: ['kidsnumbers', 'kidsabc'] }
];

function renderTabs() {
  var c = document.getElementById('deck-tabs');
  c.innerHTML = '';
  c.classList.add('deck-filter');
  var visible = getAllDeckIds();
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var opt = function (id) {
    return '<option value="' + esc(id) + '"' + (id === currentDeckId ? ' selected' : '') + '>' +
           esc(getDeckInfo(id).name) + '</option>';
  };

  var placed = {}, html = '';
  DECK_CATEGORIES.forEach(function (cat) {
    var ids = cat.ids.filter(function (id) { return visible.indexOf(id) !== -1; });
    if (!ids.length) return;
    ids.forEach(function (id) { placed[id] = 1; });
    html += '<optgroup label="' + cat.label + '">' + ids.map(opt).join('') + '</optgroup>';
  });
  var rest = visible.filter(function (id) { return !placed[id]; });
  if (rest.length) html += '<optgroup label="自定义">' + rest.map(opt).join('') + '</optgroup>';

  var sel = document.createElement('select');
  sel.id = 'deck-select';
  sel.className = 'deck-select';
  sel.setAttribute('aria-label', '选择牌组');
  sel.innerHTML = html;
  sel.onchange = function () { switchDeck(sel.value); };
  c.appendChild(sel);

  var btn = function (txt, title, fn) {
    var b = document.createElement('button');
    b.className = 'deck-filter-btn'; b.textContent = txt; b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = fn;
    c.appendChild(b);
  };
  btn('⋯', '隐藏当前牌组', function () { showTabMenu(currentDeckId); });
  if (hiddenDecks.length > 0) btn('👁', '恢复隐藏的牌组', function () { showRestoreModal(); });
  btn('+', '新建牌组', function () {
    document.getElementById('new-deck-name').value = '';
    openModal('create-deck-modal');
  });
}
