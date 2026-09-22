export const GUTTER = `
var SPLIT_MIN = 20;
var SPLIT_MAX = 80;
function applySplitWidth(percent) {
  var value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, percent));
  document.documentElement.style.setProperty('--split-w', value + '%');
  return value;
}
try {
  var saved = parseFloat(localStorage.getItem('tt-split-w'));
  if (saved === saved) applySplitWidth(saved);
} catch (e) {}

var gutter = document.getElementById('gutter');
if (gutter) {
  gutter.addEventListener('pointerdown', function (e) {
    if (!isSplit()) return;
    e.preventDefault();
    gutter.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  gutter.addEventListener('pointermove', function (e) {
    if (!document.body.classList.contains('resizing')) return;
    applySplitWidth((e.clientX / window.innerWidth) * 100);
  });
  var release = function (e) {
    if (!document.body.classList.contains('resizing')) return;
    document.body.classList.remove('resizing');
    if (gutter.hasPointerCapture && gutter.hasPointerCapture(e.pointerId)) {
      gutter.releasePointerCapture(e.pointerId);
    }
    var now = document.documentElement.style.getPropertyValue('--split-w');
    try { localStorage.setItem('tt-split-w', parseFloat(now)); } catch (err) {}
  };
  gutter.addEventListener('pointerup', release);
  gutter.addEventListener('pointercancel', release);
  gutter.addEventListener('dblclick', function () {
    applySplitWidth(50);
    try { localStorage.setItem('tt-split-w', 50); } catch (err) {}
  });
}


var treeFilter = document.querySelector('.treeFilter');
if (treeFilter) {
  treeFilter.addEventListener('input', function () {
    var q = treeFilter.value.trim().toLowerCase();
    var boxes = document.querySelectorAll('details.case');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].hidden = q ? (boxes[i].dataset.find || '').indexOf(q) === -1 : false;
    }
    var groups = document.querySelectorAll('details.group');
    for (var g = groups.length - 1; g >= 0; g--) {
      if (!q) { groups[g].hidden = false; continue; }
      var alive = groups[g].querySelector('details.case:not([hidden]), details.group:not([hidden])');
      groups[g].hidden = !alive;
      if (alive) groups[g].open = true;
    }
  });
}
`;
