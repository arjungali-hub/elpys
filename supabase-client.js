// Supabase connection — replace with your real project URL and anon key
const SUPABASE_URL     = 'https://ukrykzmehvghedrvmkjj.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcnlrem1laHZnaGVkcnZta2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODc4NzgsImV4cCI6MjA5ODk2Mzg3OH0.J1J4p3lTbQKMc3GvWVlBxAZZV1jGYPIU4Jj_ePLndgM';

// ── Shared helpers ───────────────────────────────────────────────────────────

// Every page builds its cards by string-concatenating database values into
// HTML, so anything that reaches a template has to come through here first.
// Listings are admin-approved, but "approved" means a human read the text and
// thought it looked fine — not that they checked it for quote characters.
// Escaping the single quote too keeps it safe inside single-quoted attributes.
function escHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

// URLs get a second check: escaping stops an attribute breakout, but
// `javascript:` needs no quotes to be dangerous. Anything that isn't a plain
// web or mail link, or a same-site path, becomes '#'.
//
// Written as reject-then-allow rather than one permissive pattern. The site
// uses extensionless URLs, so internal links no longer end in .html and the
// allowlist can't key on that — and a naive "allow bare words" rule would wave
// `javascript:alert(1)` straight through, since `javascript` is a bare word.
// So anything carrying a scheme we don't explicitly want is rejected FIRST,
// and only then is what remains accepted as a path.
function safeUrl(value) {
  const url = String(value == null ? '' : value).trim();

  // Explicitly allowed schemes.
  if (/^(https?:\/\/|mailto:)/i.test(url)) return escHtml(url);

  // `//evil.example` is protocol-relative: it loads from another origin
  // entirely, despite looking like a same-site path.
  if (/^\/\//.test(url)) return '#';

  // Any other scheme — javascript:, data:, vbscript:, file: — is refused.
  // A colon after a leading run of scheme-legal characters is a scheme.
  if (/^[a-z][a-z0-9+.\-]*:/i.test(url)) return '#';

  // What's left must look like a path: "/about", "/bellevue-farmers-market".
  // The character classes exclude whitespace and control characters, so
  // "java\nscript:alert(1)" cannot sneak through by breaking up the scheme.
  if (/^[\w\-./]+(\?[^\s<>"']*)?(#[^\s<>"']*)?$/.test(url)) return escHtml(url);

  return '#';
}

// ── Fetch + cache ────────────────────────────────────────────────────────────

// Exactly the columns the public client renders — nothing more.
//
// This used to be `select=*`, which meant the anon key could pull EVERY column
// of every published row straight from the REST endpoint, `admin_notes`
// included. The site never renders that field, so it was invisible in the UI,
// but the submission form offers it as a private note to the reviewer — the
// natural place for someone to type a phone number. It is excluded here on
// purpose: do not go back to `select=*`.
//
// `contact_info` is deliberately absent despite _transformRow reading it: it
// is not a real column and never has been, so the read has always been
// undefined. Naming it here would make PostgREST reject the whole request and
// blank every page.
//
// Also excluded, simply because the public client never touches them: `id`,
// `status`, `created_at`, `published_at`, `admin_notes`. `status`,
// `opportunity_type` and `event_date` are used in the query's filters, which
// work regardless of the select list — the latter two stay because the
// renderer reads them as well.
const PUBLIC_COLUMNS = [
  'name', 'description', 'long_description', 'category',
  'age_display', 'age_min', 'age_condition', 'age_filter',
  'when', 'where', 'address', 'lat', 'lng', 'approx',
  'signup_link', 'signup_label', 'signup_steps', 'section', 'slug',
  'live_url', 'card_note', 'website', 'contact_email', 'contact_phone',
  'schedule', 'opportunity_type', 'event_date',
  'cover_image_url', 'gallery_image_urls', 'photo_credit',
].join(',');

// Caches the in-flight PROMISE, not the resolved rows.
//
// Caching the result only helps callers that arrive after the first fetch has
// finished. The homepage has two that arrive in the same tick — renderCards()
// and renderAllMiniMap(), both fired from the one DOMContentLoaded handler — so
// both saw a null cache and both issued the request. Every homepage visit made
// two identical 37KB queries instead of one, for the whole life of this file.
// Confirmed against production, not theorised: two entries in
// performance.getEntriesByType('resource') for the REST endpoint.
//
// A rejected promise must not be cached, or one failed load would poison every
// later retry for the life of the page — hence the reset in the catch.
let _oppPromise = null;

async function fetchOpportunities() {
  if (_oppPromise) return _oppPromise;
  _oppPromise = _fetchOpportunitiesUncached().catch(err => {
    _oppPromise = null;
    throw err;
  });
  return _oppPromise;
}

async function _fetchOpportunitiesUncached() {

  // "recurring rows, OR one-time rows whose date hasn't passed" — a published
  // one-time row with a past date is expected to stay in the database and
  // simply stop being served here.
  const todayIso = _todayIso();
  const res = await fetch(
    SUPABASE_URL + 'Opportunities?status=eq.published&select=' + PUBLIC_COLUMNS + '&order=name.asc' +
    '&or=(opportunity_type.eq.recurring,event_date.gte.' + todayIso + ')',
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    }
  );

  if (!res.ok) throw new Error('Could not load opportunities (' + res.status + ')');

  const rows = await res.json();
  return rows.map(_transformRow);
}

// The Bellevue calendar day as YYYY-MM-DD - must match middleware.js's
// pacificToday() and api/sitemap.js's todayIso() exactly, or a card shows for a
// listing whose own URL 404s. Pinned to Pacific rather than the viewer's clock
// so a visitor in another timezone sees the same set the server serves.
function _todayIso() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch (_) {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
}

// Maps a Supabase row to the shape expected by map.html, mini-map.js,
// and the dynamic card renderer in index.html.
//
// Columns used beyond your listed schema:
//   slug         — kebab-case page name, e.g. "food-lifeline"
//                  (falls back to auto-derived from name if absent)
//   approx       — boolean; true when coordinates are a general area, not a fixed address
//   live_url     — event-calendar link shown for approx entries in the map sidebar
//   age_condition — range string like "10-15"; triggers yellow phrase highlight
//   age_filter   — raw data-age value ("all", "14+", "16-17", "varies")
//                  (falls back to age_min + "+" if absent)
//   card_note    — optional note shown below signup steps on the main-page card
//   signup_label — button label, e.g. "Browse events →" (defaults to "Sign up →")
function _transformRow(row) {
  const slug = row.slug || _nameToSlug(row.name);

  // Normalize category: split on · or ,, sort alphabetically, rejoin with ·
  const normalizedCategory = (row.category || '')
    .split(/\s*[·,]\s*/)
    .map(c => c.trim())
    .filter(Boolean)
    .sort()
    .join(' · ');

  // data-tags: lowercase, · replaced by space, for filter matching
  const tags = normalizedCategory.toLowerCase().replace(/\s*·\s*/g, ' ').trim();

  // data-age: prefer explicit age_filter column, fall back to age_min
  let dataAge = 'all';
  if (row.age_filter) {
    dataAge = row.age_filter;
  } else if (row.age_min) {
    dataAge = row.age_min + '+';
  }

  // Wrap the parenthetical part of age_display in the highlight span when a
  // condition range is set, so the yellow-highlight feature keeps working.
  // _ageHtml is the one field rendered without escaping at the call site,
  // precisely because it carries this span — so the escaping happens here,
  // before the markup is added.
  let ageHtml = escHtml(row.age_display || 'All ages');
  if (row.age_condition) {
    ageHtml = ageHtml.replace(/\(([^)]+)\)/, '(<span class="age-cond-phrase">$1</span>)');
  }

  return {
    // ── Fields used by map.html and mini-map.js ──────────────────────────
    name:    row.name,
    tag:     normalizedCategory,
    slug:    slug,
    link:    '/' + slug,
    address: row.address    || '',
    lat:     parseFloat(row.lat),
    lng:     parseFloat(row.lng),
    approx:  row.approx     || false,
    liveUrl: row.live_url   || null,
    desc:       row.description        || '',
    _detailDesc: row.long_description || row.description || '',

    // ── Fields used only by the index.html card renderer ─────────────────
    _tags:         tags,
    _dataAge:      dataAge,
    _ageCondition: row.age_condition  || null,
    _ageHtml:      ageHtml,
    _when:         row.when           || '',
    _opportunityType: row.opportunity_type || 'recurring',
    _eventDate:       row.event_date       || null,
    _schedule:     row.schedule ? _scheduleFromStructured(row.schedule) : _parseSchedule(row.when),
    _where:        row.where          || '',
    _signupLink:   row.signup_link    || '#',
    _signupLabel:  row.signup_label   || 'Sign up →',
    _steps:        (() => {
                     const v = row.signup_steps;
                     if (!v) return [];
                     if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
                     const s = String(v).trim();
                     // Some early rows stored a JSON array in the text column;
                     // render those as steps rather than as one line of JSON.
                     if (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']') {
                       try {
                         const parsed = JSON.parse(s);
                         if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean);
                       } catch (e) { /* not JSON — fall through */ }
                     }
                     return s.split('|').map(x => x.trim()).filter(Boolean);
                   })(),
    _section:      (row.section       || 'online').toLowerCase(),
    _note:         row.card_note      || null,
    _contactInfo:  row.contact_info   || null,
    _website:      row.website        || null,
    _contactEmail: row.contact_email  || null,
    _contactPhone: row.contact_phone  || null,
    _coverImageUrl:  row.cover_image_url || null,
    _galleryImageUrls: Array.isArray(row.gallery_image_urls) ? row.gallery_image_urls : [],
    _photoCredit:  row.photo_credit   || null,
  };
}

function _parseSchedule(when) {
  const w = (when || '').toLowerCase();
  const days = [];
  const times = [];

  if (/monday|tuesday|wednesday|thursday|friday|\bweekday|\bmon\b|\btue\b|\bwed\b|\bthu\b|\bfri\b/.test(w))
    days.push('weekdays');
  if (/saturday|sunday|\bweekend|\bsat\b|\bsun\b/.test(w))
    days.push('weekends');
  if (!days.length) { days.push('weekdays'); days.push('weekends'); }

  if (/\bmorning\b|\b(8|9|10|11)\s*am\b/.test(w)) times.push('morning');
  if (/\bafternoon\b|\bnoon\b|\b(12|1|2|3|4)\s*pm\b/.test(w)) times.push('afternoon');
  if (/\bevening\b|\b(5|6|7|8|9|10|11)\s*pm\b/.test(w)) times.push('evening');

  // Handle "X–Ypm" ranges: detect the start time's slot too
  const ranges = w.match(/\b(\d{1,2})\s*[–\-]\s*\d{1,2}\s*pm\b/g) || [];
  ranges.forEach(function(r) {
    const s = parseInt(r);
    if (s >= 8 && s <= 11 && times.indexOf('morning') === -1)                     times.push('morning');
    else if ((s === 12 || (s >= 1 && s <= 4)) && times.indexOf('afternoon') === -1) times.push('afternoon');
    else if (s >= 5 && s <= 9 && times.indexOf('evening') === -1)                  times.push('evening');
  });

  if (!times.length) { times.push('morning'); times.push('afternoon'); times.push('evening'); }

  return { days: days, times: times };
}

// Derives the {days, times} shape used by the timing filter from the
// structured per-day-of-week schedule set on the submit form, e.g.
// { monday: ['morning'], saturday: ['afternoon','evening'] }.
// This is authoritative (submitter-picked), unlike _parseSchedule's
// free-text guessing, so no "if empty, assume all" padding is applied —
// an explicitly unselected day/slot means "not offered then."
function _scheduleFromStructured(schedule) {
  const WEEKDAY_KEYS = ['monday','tuesday','wednesday','thursday','friday'];
  const WEEKEND_KEYS = ['saturday','sunday'];

  const days = [];
  if (WEEKDAY_KEYS.some(d => (schedule[d] || []).length)) days.push('weekdays');
  if (WEEKEND_KEYS.some(d => (schedule[d] || []).length)) days.push('weekends');

  const timesSet = new Set();
  Object.keys(schedule).forEach(day => {
    (schedule[day] || []).forEach(slot => timesSet.add(slot));
  });

  return { days: days, times: Array.from(timesSet) };
}

// Formats a "YYYY-MM-DD" event_date for display, e.g. "Sat, Sep 20, 2026".
// Parses the pieces manually rather than `new Date(iso)` — the latter treats
// a bare date string as UTC midnight, which can print as the previous day in
// timezones behind UTC (all of the continental US).
function formatEventDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function _nameToSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function opportunitySlug(opp) {
  return opp.slug;
}

// ── Map marker icon ──────────────────────────────────────────────────────────
// Inline SVG so the fill is an exact hex color.

const MARKER_COLOR = '#FF2A00';
const MARKER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41">' +
    '<path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="' + MARKER_COLOR + '" stroke="#ffffff" stroke-width="1.5"/>' +
    '<circle cx="12.5" cy="12.5" r="5" fill="#ffffff" opacity="0.9"/>' +
  '</svg>';
const MARKER_ICON_URL = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(MARKER_SVG);

function makeMarkerIcon(height, withShadow) {
  const width = Math.round(height * 25 / 41);
  const options = {
    iconUrl:     MARKER_ICON_URL,
    iconSize:    [width, height],
    iconAnchor:  [Math.round(width / 2), height],
    popupAnchor: [0, -height]
  };
  if (withShadow) {
    options.shadowUrl  = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';
    options.shadowSize = [height, height];
  }
  return L.icon(options);
}

// ── Photo upload (submission form + admin edit) ─────────────────────────────
//
// Uploads go straight from the browser to Supabase Storage, using the same
// public anon key already embedded above for reads — not through a Vercel
// function. A single 5MB photo already exceeds Vercel's serverless function
// request body limit (~4.5MB, unconfigurable, applies to every plan), so
// proxying the bytes through /api/submit or /api/admin was never viable for
// this feature. Only the resulting public URL — a short string — travels
// through the normal JSON payload those endpoints already accept. Size and
// MIME type are enforced again independently, server-side, by the bucket's
// own file_size_limit/allowed_mime_types (see the migration) — this
// client-side check is for fast feedback, not the actual gate.
const STORAGE_ROOT = SUPABASE_URL.replace(/rest\/v1\/$/, '');
const IMAGE_BUCKET = 'opportunity-images';
const ALLOWED_IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_GALLERY_IMAGES = 8;

function _uuidV4() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.random() * 16 | 0;
    const v = ch === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ── Photo metadata stripping ────────────────────────────────────────────────
//
// Photos used to be stored byte-for-byte, so a phone photo published its GPS
// position (and camera model, timestamps, editing software) to anyone who
// downloaded it. This rewrites the file's container — JPEG segments, PNG
// chunks, WebP chunks — dropping every metadata block, without decoding or
// re-encoding the pixels: no quality loss, and the image data is copied
// through verbatim. Kept: what decoding and colour need (JPEG APP0 JFIF, APP2
// ICC_PROFILE, APP14 Adobe; PNG iCCP/gAMA/etc.; WebP ICCP), plus, only when a
// photo relies on it to display upright, a new minimal EXIF block holding
// nothing but the Orientation tag. Anything unexpected throws, and the caller
// refuses the upload rather than falling back to the original file.
//
// Pure (bytes in, bytes out, no DOM) so the same code can be run under Node
// to clean files already in the bucket.
function stripImageMetadata(bytes, mime) {
  const fail = why => { const e = new Error('Unreadable image: ' + why); e.unreadableImage = true; throw e; };
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // Orientation from an Exif TIFF block (no "Exif\0\0" prefix). 1 when absent
  // or out of range, so "not 1" always means a real rotation/flip.
  function orientationOf(t) {
    if (t.length < 8) return 1;
    const le = t[0] === 0x49 && t[1] === 0x49;
    if (!le && !(t[0] === 0x4D && t[1] === 0x4D)) return 1;
    const r16 = o => le ? t[o] | t[o + 1] << 8 : t[o] << 8 | t[o + 1];
    const r32 = o => le ? (t[o] | t[o + 1] << 8 | t[o + 2] << 16 | t[o + 3] << 24) >>> 0
                        : (t[o] << 24 | t[o + 1] << 16 | t[o + 2] << 8 | t[o + 3]) >>> 0;
    if (r16(2) !== 42) return 1;
    const ifd = r32(4);
    if (ifd + 2 > t.length) return 1;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.length) return 1;
      if (r16(e) === 0x0112 && r16(e + 2) === 3) {
        const v = r16(e + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
    return 1;
  }
  // Minimal big-endian TIFF: IFD0 with one entry, Orientation (SHORT).
  function orientationTiff(v) {
    return new Uint8Array([0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
                           0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
                           0x00, v, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }
  const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const startsWith = (a, off, sig) => sig.every((b, i) => a[off + i] === b);
  const ascii = s => Array.from(s, c => c.charCodeAt(0));
  function concat(parts) {
    let len = 0; parts.forEach(p => { len += p.length; });
    const out = new Uint8Array(len); let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  if (mime === 'image/jpeg') {
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) fail('not a JPEG');
    const out = [u8.subarray(0, 2)];
    let orientation = 1, orientationSlot = -1, pos = 2, sawEOI = false;
    const KEEP_APP = { 0xE0: true, 0xEE: true }; // APP0 JFIF, APP14 Adobe
    const ICC = ascii('ICC_PROFILE\0');
    while (pos < u8.length) {
      if (u8[pos] !== 0xFF) fail('bad marker at ' + pos);
      let m = u8[pos + 1];
      if (m === 0xFF) { pos++; continue; }                 // fill byte
      if (m === 0xD9) { out.push(u8.subarray(pos, pos + 2)); sawEOI = true; break; }
      if (m === 0x01 || m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) fail('stray marker');
      if (pos + 4 > u8.length) fail('truncated segment');
      const len = u8[pos + 2] << 8 | u8[pos + 3];
      if (len < 2 || pos + 2 + len > u8.length) fail('bad segment length');
      const seg = u8.subarray(pos, pos + 2 + len);
      const body = pos + 4;
      if (m >= 0xE0 && m <= 0xEF) {
        const isIcc = m === 0xE2 && startsWith(u8, body, ICC);
        if (m === 0xE1 && startsWith(u8, body, EXIF_HEADER) && orientationSlot === -1) {
          orientation = orientationOf(u8.subarray(body + 6, pos + 2 + len));
          orientationSlot = out.length;                      // same place as the original
          out.push(new Uint8Array(0));
        }
        if (KEEP_APP[m] || isIcc) out.push(seg);             // everything else dropped
      } else if (m === 0xFE) {
        // COM: dropped
      } else {
        out.push(seg);
      }
      pos += 2 + len;
      if (m === 0xDA) {
        // Entropy-coded data runs to the next marker that isn't byte stuffing
        // (FF00) or a restart (FFD0-D7). Copied verbatim. A progressive JPEG
        // has more segments and scans after this; the loop picks them up.
        const start = pos;
        while (pos < u8.length) {
          if (u8[pos] === 0xFF) {
            const n = u8[pos + 1];
            if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { pos += 2; continue; }
            if (n === 0xFF) { pos++; continue; }
            break;
          }
          pos++;
        }
        if (pos >= u8.length) fail('scan data never ends');
        out.push(u8.subarray(start, pos));
      }
    }
    // Anything after EOI (phones append depth maps and HDR gain maps there,
    // each with its own Exif block) is dropped with the rest.
    if (!sawEOI) fail('no end-of-image marker');
    if (orientation !== 1) {
      const tiff = orientationTiff(orientation);
      const len = 2 + EXIF_HEADER.length + tiff.length;
      out[orientationSlot] = concat([new Uint8Array([0xFF, 0xE1, len >> 8, len & 0xFF]),
                                     new Uint8Array(EXIF_HEADER), tiff]);
    }
    return concat(out);
  }

  if (mime === 'image/png') {
    const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (!startsWith(u8, 0, SIG)) fail('not a PNG');
    const DROP = { eXIf: true, tEXt: true, iTXt: true, zTXt: true, tIME: true };
    const out = [u8.subarray(0, 8)];
    let pos = 8, sawIEND = false;
    while (pos + 12 <= u8.length) {
      const len = (u8[pos] << 24 | u8[pos + 1] << 16 | u8[pos + 2] << 8 | u8[pos + 3]) >>> 0;
      const type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
      if (!/^[A-Za-z]{4}$/.test(type) || pos + 12 + len > u8.length) fail('bad PNG chunk');
      const chunk = u8.subarray(pos, pos + 12 + len);
      if (type === 'eXIf') {
        const o = orientationOf(u8.subarray(pos + 8, pos + 8 + len));
        if (o !== 1) out.push(pngChunk('eXIf', orientationTiff(o)));
      } else if (!DROP[type]) {
        out.push(chunk);
      }
      pos += 12 + len;
      if (type === 'IEND') { sawIEND = true; break; }
    }
    if (!sawIEND) fail('no IEND chunk');
    return concat(out);
  }

  if (mime === 'image/webp') {
    if (!startsWith(u8, 0, ascii('RIFF')) || !startsWith(u8, 8, ascii('WEBP'))) fail('not a WebP');
    const riffLen = (u8[4] | u8[5] << 8 | u8[6] << 16 | u8[7] << 24) >>> 0;
    if (riffLen + 8 > u8.length || riffLen < 4) fail('bad RIFF size');
    const end = riffLen + 8;
    const out = [];
    let pos = 12, vp8xIndex = -1, orientation = 1;
    while (pos + 8 <= end) {
      const fourcc = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
      const len = (u8[pos + 4] | u8[pos + 5] << 8 | u8[pos + 6] << 16 | u8[pos + 7] << 24) >>> 0;
      const padded = len + (len & 1);
      if (pos + 8 + len > end) fail('bad WebP chunk');
      const chunk = u8.slice(pos, Math.min(pos + 8 + padded, end));
      if (fourcc === 'EXIF') {
        let t = u8.subarray(pos + 8, pos + 8 + len);
        if (startsWith(t, 0, EXIF_HEADER)) t = t.subarray(6);  // some writers add the JPEG prefix
        orientation = orientationOf(t);
      } else if (fourcc !== 'XMP ') {
        if (fourcc === 'VP8X') vp8xIndex = out.length;
        out.push(chunk);
      }
      pos += 8 + padded;
    }
    if (vp8xIndex !== -1) {
      const flags = out[vp8xIndex];
      flags[8] &= ~(0x08 | 0x04);                              // EXIF and XMP flags
      if (orientation !== 1) flags[8] |= 0x08;
    }
    if (orientation !== 1 && vp8xIndex !== -1) {
      // Chunk order: VP8X, ICCP, ANIM, image, then EXIF, XMP at the end.
      const tiff = orientationTiff(orientation);
      const hdr = new Uint8Array([0x45, 0x58, 0x49, 0x46, tiff.length, 0, 0, 0]);
      out.push(concat([hdr, tiff]));
    }
    const body = concat(out);
    const size = body.length + 4;
    return concat([new Uint8Array([0x52, 0x49, 0x46, 0x46, size & 0xFF, size >> 8 & 0xFF, size >> 16 & 0xFF, size >>> 24]),
                   new Uint8Array(ascii('WEBP')), body]);
  }

  fail('unsupported type ' + mime);

  function pngChunk(type, data) {
    const t = new Uint8Array(ascii(type));
    const len = data.length;
    const crcInput = concat([t, data]);
    let c = 0xFFFFFFFF;
    for (let i = 0; i < crcInput.length; i++) {
      c ^= crcInput[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    c = (c ^ 0xFFFFFFFF) >>> 0;
    return concat([new Uint8Array([len >>> 24, len >> 16 & 0xFF, len >> 8 & 0xFF, len & 0xFF]), t, data,
                   new Uint8Array([c >>> 24, c >> 16 & 0xFF, c >> 8 & 0xFF, c & 0xFF])]);
  }
}
// ── end photo metadata stripping ──

// Never trusts file.name for the stored path — only its declared MIME type,
// checked against an allowlist, to pick an extension. Throws a message
// that's safe to show the submitter directly. Every photo is stripped of its
// metadata first (stripImageMetadata above); one that can't be parsed is
// refused rather than uploaded as-is.
async function uploadOpportunityImage(file) {
  const ext = ALLOWED_IMAGE_EXT[file.type];
  if (!ext) throw new Error('Please choose a JPG, PNG, or WEBP image.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('That image is larger than 5MB. Please choose a smaller file.');

  let cleaned;
  try {
    cleaned = stripImageMetadata(new Uint8Array(await file.arrayBuffer()), file.type);
  } catch (err) {
    console.error('Image metadata strip failed:', err);
    throw new Error("We couldn't read that image. Please try a different photo.");
  }
  if (cleaned.length > MAX_IMAGE_BYTES) throw new Error('That image is larger than 5MB. Please choose a smaller file.');

  const path = 'uploads/' + _uuidV4() + '.' + ext;
  const res = await fetch(STORAGE_ROOT + 'storage/v1/object/' + IMAGE_BUCKET + '/' + path, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_ANON_KEY,
      Authorization:  'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': file.type,
    },
    body: new Blob([cleaned], { type: file.type }),
  });
  if (!res.ok) {
    console.error('Image upload failed:', res.status, await res.text().catch(() => ''));
    throw new Error('Upload failed. Please try again.');
  }
  return STORAGE_ROOT + 'storage/v1/object/public/' + IMAGE_BUCKET + '/' + path;
}

// ── Category fallback icon ───────────────────────────────────────────────────
//
// Shown in place of a cover photo when a listing has none. One simple
// line-art icon per category tag actually in use in production (checked
// directly against the live table on 2026-09-26 — not assumed: community,
// environment, food, animals), plus one generic catch-all for anything else
// or an unrecognized first tag on a multi-category listing. Drawn in the same
// hand-drawn line-art language and accent palette as the wordmark's own
// torch/sparkle marks (logos/elpys-logo-full.html: #d9662f, #e8935f, #f2a03d,
// #2b2420) rather than a stock photo — licensing risk, and misleading
// specificity for a listing that isn't the org shown.
const CATEGORY_ICON_BG = '#F3F4F6'; // var(--surface)

const CATEGORY_ICON_PATHS = {
  community:
    '<circle cx="37" cy="35" r="10" fill="none" stroke="#d9662f" stroke-width="3"/>' +
    '<path d="M19 67c0-10 8-18 18-18s18 8 18 18" fill="none" stroke="#d9662f" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="63" cy="31" r="8" fill="none" stroke="#e8935f" stroke-width="3"/>' +
    '<path d="M50 63c0-8 6-14 13-14s13 6 13 14" fill="none" stroke="#e8935f" stroke-width="3" stroke-linecap="round"/>',
  environment:
    '<path d="M48 20C66 30 70 50 48 68C26 50 30 30 48 20Z" fill="none" stroke="#d9662f" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M48 27v34" fill="none" stroke="#2b2420" stroke-width="2" stroke-linecap="round" opacity="0.5"/>',
  food:
    '<path d="M30 20v18M34 20v14M38 20v18" fill="none" stroke="#d9662f" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M34 34v30" fill="none" stroke="#d9662f" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M63 20c5 6 5 15 0 19-1.5 1.5-3.5 1.5-5 0V20c1.5-1.5 3.5-1.5 5 0z" fill="#e8935f"/>' +
    '<path d="M60 41v23" fill="none" stroke="#e8935f" stroke-width="3" stroke-linecap="round"/>',
  animals:
    '<ellipse cx="48" cy="59" rx="16" ry="11" fill="none" stroke="#d9662f" stroke-width="3"/>' +
    '<ellipse cx="29" cy="35" rx="6.5" ry="8.5" fill="none" stroke="#d9662f" stroke-width="3"/>' +
    '<ellipse cx="48" cy="27" rx="6.5" ry="8.5" fill="none" stroke="#d9662f" stroke-width="3"/>' +
    '<ellipse cx="67" cy="35" rx="6.5" ry="8.5" fill="none" stroke="#d9662f" stroke-width="3"/>',
  __generic:
    '<path d="M46 28c0 8 0 8 8 10.5-8 2.5-8 2.5-8 10.5-0-8 0-8-8-10.5 8-2.5 8-2.5 8-10.5z" fill="#d9662f"/>' +
    '<path d="M68 46c0 5 0 5 5 6.5-5 1.5-5 1.5-5 6.5 0-5 0-5-5-6.5 5-1.5 5-1.5 5-6.5z" fill="#e8935f"/>' +
    '<path d="M28 50c0 5 0 5 5 6.5-5 1.5-5 1.5-5 6.5 0-5 0-5-5-6.5 5-1.5 5-1.5 5-6.5z" fill="#f2a03d"/>',
};

// tagString is the already-normalized "community · food" shape (see
// _transformRow's `tag`), or the raw comma/·-joined category column.
function categoryFallbackIconHtml(tagString) {
  const firstTag = String(tagString || '').toLowerCase().split(/[·,]/)[0].trim();
  const inner = CATEGORY_ICON_PATHS[firstTag] || CATEGORY_ICON_PATHS.__generic;
  return '<svg viewBox="0 0 96 96" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true" focusable="false">' +
    '<rect width="96" height="96" fill="' + CATEGORY_ICON_BG + '"/>' + inner +
  '</svg>';
}
