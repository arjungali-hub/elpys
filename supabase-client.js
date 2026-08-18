// Supabase connection — replace with your real project URL and anon key
const SUPABASE_URL     = 'https://ukrykzmehvghedrvmkjj.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcnlrem1laHZnaGVkcnZta2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODc4NzgsImV4cCI6MjA5ODk2Mzg3OH0.J1J4p3lTbQKMc3GvWVlBxAZZV1jGYPIU4Jj_ePLndgM';

// ── Fetch + cache ────────────────────────────────────────────────────────────

let _oppCache = null;

async function fetchOpportunities() {
  if (_oppCache) return _oppCache;

  const res = await fetch(
    SUPABASE_URL + 'Opportunities?status=eq.published&select=*&order=name.asc',
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    }
  );

  if (!res.ok) throw new Error('Could not load opportunities (' + res.status + ')');

  const rows = await res.json();
  _oppCache = rows.map(_transformRow);
  return _oppCache;
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
  let ageHtml = row.age_display || 'All ages';
  if (row.age_condition) {
    ageHtml = ageHtml.replace(/\(([^)]+)\)/, '(<span class="age-cond-phrase">$1</span>)');
  }

  return {
    // ── Fields used by map.html and mini-map.js ──────────────────────────
    name:    row.name,
    tag:     normalizedCategory,
    slug:    slug,
    link:    'opportunities-detail.html?slug=' + slug,
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
