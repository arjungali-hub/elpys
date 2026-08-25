// Loading states — builders for the skeleton markup and the button spinner.
//
// The CSS lives in styles.css (search "LOADING STATES"); this file only
// assembles the markup those rules expect, so the shapes stay in one place
// instead of being retyped on six pages.
//
// Every skeleton carries aria-busy on its container and a visually hidden
// status line, so a screen reader hears "Loading opportunities" rather than
// silence. Reduced motion is handled in the CSS, not here.

(function (global) {
  'use strict';

  // Slight width variation per row, so a block of skeletons reads as text
  // rather than as a printed grid. Fixed sequences rather than Math.random():
  // a skeleton that reshuffles on every render is distracting, and identical
  // output makes the screenshots in the tests comparable.
  function pick(list, i) { return list[i % list.length]; }

  function srLine(text) {
    return '<span class="skel-sr" role="status">' + text + '</span>';
  }

  // ── Homepage card grid ────────────────────────────────────────────────────
  var CARD_W = [
    ['46%', '86%', '58%', 66, 48],
    ['38%', '78%', '64%', 54, 62],
    ['52%', '92%', '48%', 72, 44],
    ['42%', '82%', '70%', 58, 56],
    ['48%', '74%', '54%', 68, 50],
    ['36%', '88%', '62%', 62, 46],
  ];

  function skeletonCards(count, label) {
    var n = count || 6;
    var out = [srLine(label || 'Loading opportunities')];
    for (var i = 0; i < n; i++) {
      var w = pick(CARD_W, i);
      out.push(
        '<div class="skel-card">' +
          '<div class="skel skel-line" style="width:' + w[0] + '"></div>' +
          '<div class="skel skel-title" style="width:' + w[1] + '"></div>' +
          '<div class="skel skel-title" style="width:' + w[2] + '"></div>' +
          '<hr />' +
          '<div class="skel-chips">' +
            '<div class="skel skel-chip" style="width:' + w[3] + 'px"></div>' +
            '<div class="skel skel-chip" style="width:' + w[4] + 'px"></div>' +
          '</div>' +
        '</div>');
    }
    return out.join('');
  }

  // ── Map sidebar list ──────────────────────────────────────────────────────
  var ROW_W = [['72%', '40%'], ['54%', '48%'], ['64%', '34%'], ['48%', '44%'], ['68%', '38%']];

  function skeletonRows(count, label) {
    var n = count || 5;
    var out = [srLine(label || 'Finding opportunities nearby')];
    for (var i = 0; i < n; i++) {
      var w = pick(ROW_W, i);
      out.push(
        '<div class="skel-row">' +
          '<div class="skel skel-line" style="height:11px;width:' + w[0] + '"></div>' +
          '<div class="skel skel-meta" style="width:' + w[1] + '"></div>' +
        '</div>');
    }
    return out.join('');
  }

  // ── Detail page ───────────────────────────────────────────────────────────
  function skeletonDetail(label) {
    return srLine(label || 'Loading opportunity') +
      '<div class="skel skel-line" style="width:26%"></div>' +
      '<div class="skel skel-h1" style="width:74%;animation-delay:.08s"></div>' +
      '<div class="skel skel-line" style="height:10px;width:42%;animation-delay:.16s"></div>' +
      '<div class="skel-rule" style="margin:6px 0"></div>' +
      '<div class="skel skel-line" style="width:100%;animation-delay:.24s"></div>' +
      '<div class="skel skel-line" style="width:96%;animation-delay:.24s"></div>' +
      '<div class="skel skel-line" style="width:88%;animation-delay:.32s"></div>' +
      '<div class="skel skel-line" style="width:54%;animation-delay:.32s"></div>' +
      '<div class="skel-chips" style="margin-top:8px">' +
        '<div class="skel skel-button" style="width:118px;animation-delay:.4s"></div>' +
        '<div class="skel skel-button" style="width:92px;animation-delay:.4s"></div>' +
      '</div>';
  }

  // ── Table / queue ─────────────────────────────────────────────────────────
  // `shape` is the per-column class list, so a column can be a pill rather
  // than a bar — that is what makes the admin queue and the review queue read
  // as different tables.
  var TABLE_W = [
    ['82%', '64%', '48%', '64px'],
    ['66%', '78%', '40%', '52px'],
    ['90%', '54%', '56%', '70px'],
    ['74%', '68%', '52%', '58px'],
    ['86%', '46%', '62%', '66px'],
    ['70%', '72%', '44%', '54px'],
    ['80%', '58%', '50%', '62px'],
  ];

  function cell(cls, width) {
    var w = String(width).indexOf('px') !== -1 ? width : width;
    return '<div class="skel ' + cls + '" style="width:' + w + '"></div>';
  }

  function skeletonTable(opts) {
    opts = opts || {};
    var cols   = opts.cols   || '2.4fr 1.2fr 1fr 90px';
    var rows   = opts.rows   || 7;
    var label  = opts.label  || 'Loading';
    // Which column is the pill: last by default (a status chip), or first for
    // the review queue, where the leading column is the flagged field.
    var pillAt = opts.pillAt === undefined ? 3 : opts.pillAt;
    var headW  = opts.headWidths || ['38%', '52%', '44%', '60%'];

    var head = '<div class="skel-thead">';
    for (var h = 0; h < headW.length; h++) head += cell('skel-cell', headW[h]);
    head += '</div>';

    var body = '';
    for (var i = 0; i < rows; i++) {
      var w = pick(TABLE_W, i);
      body += '<div class="skel-trow">';
      for (var c = 0; c < headW.length; c++) {
        if (c === pillAt) body += cell('skel-pill', w[3]);
        else body += cell(c === 0 || (pillAt === 0 && c === 1) ? 'skel-cell-strong' : 'skel-cell', w[c]);
      }
      body += '</div>';
    }

    return srLine(label) + head + body;
  }

  // ── Profile form ──────────────────────────────────────────────────────────
  function checks(widths) {
    return '<div class="skel-checks">' + widths.map(function (w) {
      return '<div class="skel-check"><div class="skel skel-box"></div>' +
             '<div class="skel skel-checktext" style="width:' + w + 'px"></div></div>';
    }).join('') + '</div>';
  }

  function skeletonForm(label) {
    return srLine(label || 'Loading your profile') +
      '<div class="skel-field">' +
        '<div class="skel skel-label"></div>' +
        '<div class="skel skel-input"></div>' +
      '</div>' +
      '<div class="skel-field">' +
        '<div class="skel skel-label" style="width:20%"></div>' +
        checks([86, 62, 104, 74, 92, 58]) +
      '</div>' +
      '<div class="skel-field">' +
        '<div class="skel skel-label" style="width:24%"></div>' +
        checks([70, 88, 64]) +
      '</div>' +
      '<div class="skel-check" style="gap:10px">' +
        '<div class="skel skel-box"></div>' +
        '<div class="skel skel-checktext" style="width:52%"></div>' +
      '</div>' +
      '<div class="skel skel-button" style="width:132px"></div>';
  }

  // Fills a container with a skeleton and marks it busy. Returns the element
  // so a caller can hand it straight to clearSkeleton().
  function showSkeleton(el, html, extraClass) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    el.innerHTML = html;
    el.classList.add('skel-wave');
    if (extraClass) el.classList.add(extraClass);
    el.setAttribute('aria-busy', 'true');
    return el;
  }

  function clearSkeleton(el, extraClass) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.classList.remove('skel-wave');
    if (extraClass) el.classList.remove(extraClass);
    el.removeAttribute('aria-busy');
  }

  // ── Button spinner ────────────────────────────────────────────────────────
  var SPIN =
    '<span class="btn-spin" aria-hidden="true"><svg viewBox="0 0 40 40">' +
      '<circle class="btn-spin-track" cx="20" cy="20" r="17"></circle>' +
      '<circle class="btn-spin-arc" cx="20" cy="20" r="17"></circle>' +
    '</svg></span>';

  // The original label is stashed on the element the first time round, so
  // clearBusy always restores exactly what was there — including pages whose
  // button label differs from the hardcoded one a caller might guess.
  function setBusy(btn, busyLabel) {
    if (typeof btn === 'string') btn = document.getElementById(btn);
    if (!btn) return;
    if (btn.dataset.label === undefined) btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('btn-loading');
    btn.innerHTML = SPIN + (busyLabel || '');
  }

  function clearBusy(btn) {
    if (typeof btn === 'string') btn = document.getElementById(btn);
    if (!btn) return;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('btn-loading');
    if (btn.dataset.label !== undefined) btn.innerHTML = btn.dataset.label;
  }

  global.Loading = {
    cards:    skeletonCards,
    rows:     skeletonRows,
    detail:   skeletonDetail,
    table:    skeletonTable,
    form:     skeletonForm,
    show:     showSkeleton,
    clear:    clearSkeleton,
    setBusy:  setBusy,
    clearBusy: clearBusy,
  };
}(window));
