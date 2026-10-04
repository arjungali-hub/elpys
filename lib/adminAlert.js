// Short "something arrived" emails to the Elpys inbox (hello.elpys@gmail.com):
// a new /submit submission, new feedback, or something new waiting in Data
// review / Analytics review (api/review-alerts.js).
//
// An alert is a convenience and must never cost a visitor their submission:
//   - callers send only AFTER their database write has succeeded;
//   - the wait is capped (WAIT_MS, and never past the function's own time
//     budget — api/*.js runs with maxDuration 10 in vercel.json), after which
//     the caller carries on and the send finishes or fails on its own;
//   - every failure is caught and logged here, never thrown;
//   - at most FLOOD_MAX visitor-triggered alerts per rolling 24 hours, counted
//     in memory per function instance like the rate limiters in api/submit.js
//     and api/feedback.js. Imperfect across instances, which is acceptable:
//     it exists so a bot that gets past Turnstile can't fill the inbox.

const sendEmail = require('./sendEmail');

const ALERT_TO    = 'hello.elpys@gmail.com';
const SITE        = 'https://elpys.vercel.app';
const WAIT_MS     = 3000;
const FLOOD_MAX   = 30;
const FLOOD_WIN   = 24 * 60 * 60 * 1000;

let sentAt = [];   // timestamps of visitor-triggered alerts, this instance

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Subject lines are plain text: no line breaks, and a sensible length.
function subjectLine(s, max) {
  const one = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

function cut(s, max) {
  const t = String(s == null ? '' : s).trim();
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

// Same look as the weekly digest email (api/send-digest.js). rows is a list of
// [label, value] pairs, already plain text; they are escaped here.
function layout({ heading, rows, body, button }) {
  const rowsHtml = (rows || []).map(([k, v]) =>
    '<tr><td style="padding:0.3rem 1rem 0.3rem 0;color:#888;vertical-align:top;white-space:nowrap;">' + esc(k) + '</td>' +
    '<td style="padding:0.3rem 0;color:#1A1A1A;">' + esc(v) + '</td></tr>').join('');
  const bodyHtml = body
    ? '<p style="font-size:0.95rem;color:#1A1A1A;line-height:1.55;white-space:pre-wrap;margin:0 0 1.25rem;">' + esc(body) + '</p>'
    : '';
  return '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;' +
    'background:#F7F7F7;margin:0;padding:2rem 1rem;">' +
    '<div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;border:1px solid #E5E7EB;">' +
      '<p style="font-size:1.25rem;font-weight:700;letter-spacing:-0.02em;margin:0 0 0.25rem;color:#1A1A1A;">Elpys</p>' +
      '<p style="font-size:0.875rem;color:#888;margin:0 0 1.5rem;">' + esc(heading) + '</p>' +
      (rowsHtml ? '<table style="font-size:0.95rem;border-collapse:collapse;margin:0 0 1.5rem;">' + rowsHtml + '</table>' : '') +
      bodyHtml +
      (button ? '<a href="' + esc(button.href) + '" style="display:inline-block;background:#1A1A1A;color:#fff;text-decoration:none;' +
        'padding:0.65rem 1.1rem;border-radius:8px;font-size:0.95rem;font-weight:600;">' + esc(button.label) + '</a>' : '') +
    '</div></body></html>';
}

// Waits for p at most ms, then gives up waiting (p keeps running). Resolves
// to true if p finished in time.
function within(p, ms) {
  let timer;
  return Promise.race([
    p.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// For visitor-triggered alerts (submit, feedback). startedAt is when the
// request began, so the wait never runs the function past its time budget.
async function sendVisitorAlert(mail, startedAt, label) {
  try {
    const now = Date.now();
    sentAt = sentAt.filter(t => now - t < FLOOD_WIN);
    if (sentAt.length >= FLOOD_MAX) {
      console.warn('Alert email skipped (' + label + '): ' + FLOOD_MAX + ' already sent in the last 24h on this instance.');
      return;
    }
    const budget = Math.min(WAIT_MS, 9000 - (now - (startedAt || now)));
    if (budget < 500) {
      console.warn('Alert email skipped (' + label + '): not enough time left in this request.');
      return;
    }
    sentAt.push(now);
    const sending = sendEmail(Object.assign({ to: ALERT_TO }, mail))
      .catch(err => { console.error('Alert email failed (' + label + '):', err && err.message ? err.message : err); });
    const done = await within(sending, budget);
    if (!done) console.warn('Alert email still sending after ' + budget + 'ms (' + label + '); not waiting for it.');
  } catch (err) {
    console.error('Alert email error (' + label + '):', err && err.message ? err.message : err);
  }
}

function submissionAlert(row, id) {
  const name = String(row.name || '').trim() || '(no name)';
  const cats = String(row.category || '').split(/\s*,\s*/).filter(Boolean)
    .map(c => c.replace(/\b\w/g, m => m.toUpperCase())).join(', ') || '—';
  const when = row.opportunity_type === 'one_time'
    ? 'One-time' + (row.event_date ? ', ' + row.event_date : '')
    : 'Recurring';
  const photos = (row.cover_image_url ? 1 : 0) + (Array.isArray(row.gallery_image_urls) ? row.gallery_image_urls.length : 0);
  const link = SITE + '/admin-review' + (id != null ? '?id=' + encodeURIComponent(id) : '');
  const rows = [['Name', name], ['Categories', cats], ['When', when], ['Photos', String(photos)]];
  return {
    subject: subjectLine('New Elpys submission: ' + subjectLine(name, 80), 100),
    html: layout({ heading: 'A new listing was submitted and is waiting for review.', rows, button: { href: link, label: 'Review it' } }),
    text: 'A new listing was submitted and is waiting for review.\n\n' +
      rows.map(([k, v]) => k + ': ' + v).join('\n') + '\n\nReview it: ' + link + '\n',
  };
}

function feedbackAlert(row) {
  const message = cut(row.message, 1000);
  const link = SITE + '/admin-feedback';
  return {
    subject: 'New Elpys feedback',
    html: layout({ heading: 'New feedback was sent through the site.', body: message, button: { href: link, label: 'Open feedback' } }),
    text: 'New feedback was sent through the site.\n\n' + message + '\n\nOpen feedback: ' + link + '\n',
  };
}

module.exports = { sendVisitorAlert, submissionAlert, feedbackAlert, layout, esc, subjectLine, cut, within, ALERT_TO, SITE,
  _resetFloodForTests: () => { sentAt = []; } };
