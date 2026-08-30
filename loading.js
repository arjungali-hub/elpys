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

  // ── Card stacks (Aug 2026 corrections pass) ───────────────────────────────
  // admin.html and review.html render "header → body → footer actions" cards,
  // not tables, so skeletonTable was the wrong shape for both. It stays
  // exported for any genuinely tabular view added later.

  function bar(cls, width, extra) {
    return '<div class="skel ' + cls + '" style="width:' + width +
           (extra ? ';' + extra : '') + '"></div>';
  }

  // review.html — data_review_flags. Roughly half the real flags carry a
  // suggested value, so alternate rather than drawing the callout every time;
  // a stack of identical cards reads as a printed grid.
  var FLAG_W = [
    ['54%', '86px', '30%', '92%', '78%'],
    ['60%', '70px', '34%', '88%', '64%'],
    ['48%', '94px', '26%', '95%', '71%'],
    ['57%', '78px', '38%', '90%', '58%'],
  ];

  function skeletonFlagCards(opts) {
    opts = opts || {};
    var n = opts.count || 4;
    var out = [srLine(opts.label || 'Loading flagged listings')];
    for (var i = 0; i < n; i++) {
      var w = pick(FLAG_W, i);
      var withSuggested = i % 2 === 0;
      out.push(
        '<div class="skel-stackcard">' +
          '<div class="skel-cardhead">' + bar('skel-title', w[0]) + bar('skel-chip', w[1]) + '</div>' +
          bar('skel-meta', w[2]) +
          bar('skel-line', w[3]) +
          bar('skel-line', w[4]) +
          (withSuggested
            ? bar('skel-meta', '22%', 'margin-top:4px') + '<div class="skel skel-callout"></div>'
            : '') +
          '<div class="skel-cardfoot">' +
            bar('skel-btn-sm', '84px') +
            bar('skel-btn-sm', '96px') +
            (withSuggested ? bar('skel-btn-sm', '72px') : '') +
          '</div>' +
        '</div>');
    }
    return out.join('');
  }

  // admin.html. 'pending' cards carry the approve panel — slug/lat/lng inputs,
  // the Leaflet map and its hint — which makes them tall, so two or three is
  // plenty. 'published' cards are just a name, a meta line and two buttons.
  function skeletonSubmissionCards(opts) {
    opts = opts || {};
    var pending = opts.variant !== 'published';
    var n = opts.count || (pending ? 2 : 3);
    var out = [srLine(opts.label || (pending ? 'Loading the pending queue' : 'Loading published listings'))];
    var W = pending
      ? [['56%', '38%'], ['62%', '34%'], ['50%', '42%']]
      : [['50%', '42%'], ['58%', '36%'], ['46%', '48%'], ['54%', '40%']];

    for (var i = 0; i < n; i++) {
      var w = pick(W, i);
      out.push(
        '<div class="skel-stackcard">' +
          '<div class="skel-cardhead">' + bar('skel-h1', w[0]) + '</div>' +
          bar('skel-meta', w[1]) +
          (pending
            ? // description, steps, sign-up link
              bar('skel-line', '96%') + bar('skel-line', '90%') + bar('skel-line', '62%') +
              bar('skel-meta', '24%', 'margin-top:6px') +
              bar('skel-line', '74%') + bar('skel-line', '68%') + bar('skel-line', '56%') +
              bar('skel-meta', '46%') +
              // approve panel: label, three inputs, map, hint
              bar('skel-meta', '28%', 'margin-top:8px') +
              '<div class="skel-inputrow">' +
                '<div class="skel skel-input-sm"></div>' +
                '<div class="skel skel-input-sm"></div>' +
                '<div class="skel skel-input-sm"></div>' +
              '</div>' +
              '<div class="skel skel-map"></div>' +
              bar('skel-meta', '54%')
            : '') +
          '<div class="skel-cardfoot">' +
            (pending
              ? bar('skel-btn-sm', '90px') + bar('skel-btn-sm', '78px') + bar('skel-btn-sm', '66px')
              : bar('skel-btn-sm', '74px') + bar('skel-btn-sm', '88px')) +
          '</div>' +
        '</div>');
    }
    return out.join('');
  }

  // ── account.html profile form (replaces skeletonForm here) ────────────────
  // Four blocks in the page's real order. No leading label+input pair: the
  // account page has no free-text field, and the old skeleton invented one.
  var DAYS = 7;

  function availGrid() {
    var cells = '<div class="skel-spacer"></div>' +
      '<div class="skel skel-colhead"></div>'.repeat(3);
    for (var d = 0; d < DAYS; d++) {
      cells += '<div class="skel skel-day"></div>' +
               '<div class="skel skel-cell-sq"></div>'.repeat(3);
    }
    return '<div class="skel-availgrid">' + cells + '</div>';
  }

  function skeletonAvailForm(label) {
    var interests = [84, 62, 104, 74, 92, 58, 88, 66].map(function (w) {
      return bar('skel-chip', w + 'px');
    }).join('');

    return srLine(label || 'Loading your profile') +
      // 1. Interests
      '<div class="skel-block">' +
        bar('skel-label', '20%') +
        '<div class="skel skel-hint"></div>' +
        '<div class="skel-checks">' + interests + '</div>' +
        bar('skel-button', '124px') +
      '</div>' +
      // 2. Availability
      '<div class="skel-block">' +
        bar('skel-label', '24%') +
        bar('skel-hint', '54%') +
        availGrid() +
        bar('skel-button', '140px') +
      '</div>' +
      // 3. Email notifications
      '<div class="skel-block">' +
        bar('skel-label', '28%') +
        bar('skel-hint', '70%') +
        bar('skel-button', '150px') +
      '</div>' +
      // 4. Account
      '<div class="skel-block">' +
        bar('skel-label', '16%') +
        '<div class="skel-actions">' +
          bar('skel-button', '88px') +
          bar('skel-button', '126px') +
        '</div>' +
      '</div>';
  }

  global.Loading = {
    cards:    skeletonCards,
    rows:     skeletonRows,
    detail:   skeletonDetail,
    table:    skeletonTable,          // kept for a genuinely tabular view
    form:     skeletonForm,           // generic; account.html uses availForm
    flagCards:       skeletonFlagCards,
    submissionCards: skeletonSubmissionCards,
    availForm:       skeletonAvailForm,
    show:     showSkeleton,
    clear:    clearSkeleton,
    setBusy:  setBusy,
    clearBusy: clearBusy,
  };
}(window));
