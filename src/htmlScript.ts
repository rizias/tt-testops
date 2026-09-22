import { GUTTER } from './htmlGutter.js';

export const HANDLER = `<script>${GUTTER}
function byAct(target, act) {
  var b = target.closest && target.closest('[data-act="' + act + '"]');
  return b;
}
function toc() { return document.getElementById('section-toc'); }
function paneEl() { return document.getElementById('pane'); }
function zeroEl() { return document.getElementById('pane-zero'); }
function isSplit() { return document.body.classList.contains('split'); }
var currentCase = null;
var currentInner = null;

function clearCase() {
  if (currentCase && currentInner) currentCase.appendChild(currentInner);
  if (currentCase) currentCase.classList.remove('case_current');
  currentCase = null;
  currentInner = null;
  var head = document.querySelector('.paneHead');
  if (head) head.remove();
  var zero = zeroEl();
  if (zero) zero.hidden = false;
}
function selectCase(box) {
  var pane = paneEl();
  if (!box || !pane || box === currentCase) return;
  var inner = box.querySelector(':scope > .caseInner');
  var head = box.querySelector(':scope > summary');
  if (!inner || !head) return;
  clearCase();
  var title = document.createElement('div');
  title.className = 'paneHead';
  title.innerHTML = head.innerHTML;
  pane.appendChild(title);
  pane.appendChild(inner);
  currentCase = box;
  currentInner = inner;
  box.classList.add('case_current');
  var zero = zeroEl();
  if (zero) zero.hidden = true;
  pane.scrollTop = 0;
  try { localStorage.setItem('tt-case', box.id); } catch (e) {}
}
function restoreSelected() {
  var id = null;
  try { id = localStorage.getItem('tt-case'); } catch (e) {}
  if (!id) return;
  var box = document.getElementById(id);
  if (!box || !box.classList.contains('case')) return;
  for (var node = box.parentElement; node; node = node.parentElement) {
    if (node.matches && node.matches('details.group')) node.open = true;
  }
  selectCase(box);
  var head = box.querySelector(':scope > summary');
  if (head && head.scrollIntoView) head.scrollIntoView({ block: 'center' });
}
function setView(split) {
  document.body.classList.toggle('split', split);
  var b = document.querySelector('[data-act="view"]');
  if (b) b.textContent = split ? 'документом' : 'две колонки';
  try { localStorage.setItem('tt-view', split ? 'split' : 'doc'); } catch (e) {}
  if (split) {
    showToc(false);
    var boxes = document.querySelectorAll('details.case');
    for (var i = 0; i < boxes.length; i++) boxes[i].open = false;
    restoreSelected();
  } else {
    clearCase();
  }
}
try { if (localStorage.getItem('tt-view') === 'split') setView(true); } catch (e) {}
function tocButton() { return document.querySelector('[data-act="toc"]'); }
function showToc(on) {
  var panel = toc();
  if (!panel) return;
  panel.hidden = !on;
  var b = tocButton();
  if (b) b.setAttribute('aria-expanded', String(on));
  if (on) {
    var field = panel.querySelector('.tocSearch');
    if (field) field.focus();
    var here = panel.querySelector('.tocRow_here');
    if (here && here.scrollIntoView) here.scrollIntoView({ block: 'nearest' });
  } else if (b) b.focus();
}

document.addEventListener('click', function (e) {
  var img = e.target.closest && e.target.closest('.blockBody img, .comment img');
  if (img && img.getAttribute('src')) { e.preventDefault(); openViewer(img); return; }

  var caseHead = e.target.closest && e.target.closest('details.case > summary');
  if (caseHead && isSplit() && !(e.target.closest && e.target.closest('a, .ctl'))) {
    e.preventDefault();
    selectCase(caseHead.parentElement);
    return;
  }

  var row = e.target.closest && e.target.closest('.tocRow');
  var jump = row ? row.querySelector('[data-section-target]') : null;
  if (!jump) jump = e.target.closest && e.target.closest('[data-section-target]');
  if (jump) {
    e.preventDefault();
    var target = document.getElementById(jump.dataset.sectionTarget);
    if (!target) return;
    for (var node = target.parentElement; node; node = node.parentElement) {
      if (node.matches && node.matches('details.group')) node.open = true;
    }
    var was = document.querySelector('.tocRow_here');
    if (was) was.classList.remove('tocRow_here');
    var row = jump.closest('.tocRow');
    if (row) row.classList.add('tocRow_here');
    requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
    return;
  }

  var b = e.target.closest && e.target.closest('.ctl, .toTop');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  var act = b.dataset.act;

  if (act === 'copy') { copyCase(b); return; }
  if (act === 'toc') { showToc(toc() && toc().hidden); return; }
  if (act === 'view') { setView(!document.body.classList.contains('split')); return; }
  if (act === 'close-toc') { showToc(false); return; }

  if (act === 'open-section') {
    var branch = b.closest('details.group');
    if (!branch) return;
    branch.open = true;
    var inside = branch.querySelectorAll(isSplit() ? 'details.group' : 'details');
    for (var k = 0; k < inside.length; k++) inside[k].open = true;
    return;
  }

  if (act === 'collapse-section') {
    var group = b.closest('details.group');
    if (!group) return;
    group.open = false;
    requestAnimationFrame(function () {
      var head = group.querySelector(':scope > summary');
      if (head && head.scrollIntoView) head.scrollIntoView({ block: 'nearest' });
    });
    return;
  }

  if (act === 'open-all' || act === 'close-all') {
    var open = act === 'open-all';
    var all = document.querySelectorAll(isSplit() ? 'details.group' : 'details');
    for (var i = 0; i < all.length; i++) all[i].open = open;
    return;
  }

  if (b.classList.contains('toTop')) {
    var top = document.getElementById('page-top');
    if (top) top.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
});

function copyCase(b) {
  var name = b.dataset.caseName || '';
  var url = b.dataset.caseUrl || '';
  var plain = name + ' — ' + url;
  var done = function () {
    b.classList.add('ctl_done');
    setTimeout(function () { b.classList.remove('ctl_done'); }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(plain).then(done, function () { fallbackCopy(plain); done(); });
  } else { fallbackCopy(plain); done(); }
}
function fallbackCopy(text) {
  var field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try { document.execCommand('copy'); } catch (err) {}
  field.remove();
}

var search = document.querySelector('.tocSearch');
if (search) {
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    var items = document.querySelectorAll('.tocTree li[data-search]');
    for (var i = 0; i < items.length; i++) {
      var hit = !q || items[i].dataset.search.indexOf(q) !== -1;
      items[i].hidden = !hit;
      if (hit && q) {
        for (var up = items[i].parentElement; up; up = up.parentElement) {
          if (up.tagName === 'LI') up.hidden = false;
          if (up.classList && up.classList.contains('tocTree')) break;
        }
      }
    }
  });
}

var heads = [].slice.call(document.querySelectorAll('details.group > summary'));
function markHere(id) {
  var row = document.querySelector('[data-section-target="' + id + '"]');
  row = row && row.closest('.tocRow');
  if (!row || row.classList.contains('tocRow_here')) return;
  var was = document.querySelector('.tocRow_here');
  if (was) was.classList.remove('tocRow_here');
  row.classList.add('tocRow_here');
  var panel = toc();
  if (panel && !panel.hidden && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}
function updateHere() {
  var toolbar = 44;
  var step = 30;
  var best = null;
  var bestDepth = -1;
  for (var i = 0; i < heads.length; i++) {
    var head = heads[i];
    var box = head.getBoundingClientRect();
    var group = head.parentElement;
    if (!group || box.bottom < 0) continue;
    var depth = Number(group.getAttribute('data-depth') || 0);
    if (box.top > toolbar + depth * step + 8) continue;
    if (depth >= bestDepth) { best = head; bestDepth = depth; }
  }
  if (best) markHere(best.id);
}
if (heads.length && window.IntersectionObserver) {
  var spy = new IntersectionObserver(updateHere, { rootMargin: '-56px 0px -92% 0px' });
  for (var h = 0; h < heads.length; h++) spy.observe(heads[h]);
  updateHere();
}

var toTopButton = document.querySelector('.toTop');
var sentinel = document.getElementById('top-sentinel');
if (toTopButton && sentinel && window.IntersectionObserver) {
  new IntersectionObserver(function (entries) {
    toTopButton.hidden = entries[0].isIntersecting;
  }).observe(sentinel);
}

var viewer = null;
function openViewer(img) {
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer.innerHTML = '<button class="viewerClose" title="Закрыть (Esc)">×</button><img alt="">';
    document.body.appendChild(viewer);
    viewer.addEventListener('click', function (e) {
      if (e.target.tagName === 'IMG') { zoomAt(e); return; }
      closeViewer();
    });
  }
  var full = viewer.querySelector('img');
  full.src = img.getAttribute('src');
  full.alt = img.getAttribute('alt') || '';
  viewer.classList.remove('viewer_zoom');
  viewer.classList.add('viewer_on');
  document.body.classList.add('locked');
}
function zoomAt(e) {
  var on = !viewer.classList.contains('viewer_zoom');
  var box = e.target.getBoundingClientRect();
  var rx = (e.clientX - box.left) / box.width;
  var ry = (e.clientY - box.top) / box.height;
  viewer.classList.toggle('viewer_zoom', on);
  if (!on) return;
  var full = viewer.querySelector('img');
  viewer.scrollLeft = full.offsetWidth * rx - viewer.clientWidth / 2;
  viewer.scrollTop = full.offsetHeight * ry - viewer.clientHeight / 2;
}
function closeViewer() {
  if (!viewer) return;
  viewer.classList.remove('viewer_on', 'viewer_zoom');
  document.body.classList.remove('locked');
}
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (viewer && viewer.classList.contains('viewer_on')) { closeViewer(); return; }
  if (toc() && !toc().hidden) showToc(false);
});
</script>`;
