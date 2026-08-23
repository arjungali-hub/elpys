// Small, non-interactive Leaflet previews used on opportunity detail pages
// and on the main page. Requires supabase-client.js to already be loaded
// (for fetchOpportunities(), makeMarkerIcon(), opportunitySlug()).

// Fallback view for when there is nothing to fit bounds around.
const BELLEVUE_CENTRE = [47.6101, -122.2015];

function miniPinIcon(big) {
  return makeMarkerIcon(big ? 30 : 18, false);
}

function staticMiniMap(containerId) {
  return L.map(containerId, {
    zoomControl:        false,
    attributionControl: false,
    dragging:           false,
    scrollWheelZoom:    false,
    doubleClickZoom:    false,
    boxZoom:            false,
    keyboard:           false,
    tap:                false
  });
}

function addMiniTiles(map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
}

// Renders a single opportunity's location on a detail page. Clicking the
// preview navigates to the full map already focused on that opportunity.
async function renderSingleMiniMap(containerId, slug, mapPageUrl) {
  const opportunities = await fetchOpportunities();
  const opp = opportunities.find(o => opportunitySlug(o) === slug);
  if (!opp) return;

  const map = staticMiniMap(containerId);
  addMiniTiles(map);
  const located = isFinite(opp.lat) && isFinite(opp.lng);
  map.setView(located ? [opp.lat, opp.lng] : BELLEVUE_CENTRE, located ? 13 : 11);
  if (located) L.marker([opp.lat, opp.lng], { icon: miniPinIcon(true) }).addTo(map);

  const wrap = document.getElementById(containerId).closest('.mini-map-wrap');
  if (wrap) {
    wrap.addEventListener('click', () => {
      window.location.href = mapPageUrl + '?select=' + encodeURIComponent(slug);
    });
  }
}

// Renders every opportunity as a small pin, used as the hero preview on the
// main page. Clicking is handled by the caller (navigates to map.html).
async function renderAllMiniMap(containerId) {
  const opportunities = await fetchOpportunities();

  const map = staticMiniMap(containerId);
  addMiniTiles(map);

  // Rows missing coordinates would place a marker at NaN and make fitBounds
  // throw, taking the whole render down with it.
  const located = opportunities.filter(o => isFinite(o.lat) && isFinite(o.lng));
  located.forEach(opp => {
    L.marker([opp.lat, opp.lng], { icon: miniPinIcon(false) }).addTo(map);
  });

  if (located.length) {
    map.fitBounds(located.map(o => [o.lat, o.lng]), { padding: [16, 16] });
  } else {
    map.setView(BELLEVUE_CENTRE, 11);
  }
}
