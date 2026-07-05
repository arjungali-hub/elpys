// Small, non-interactive Leaflet previews used on opportunity detail pages
// and on the main page. Requires opportunities-data.js to already be
// loaded (for the `opportunities` array and `opportunitySlug()` helper).

function miniPinIcon(big) {
  return makeMarkerIcon(big ? 30 : 18, false);
}

function staticMiniMap(containerId) {
  return L.map(containerId, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false
  });
}

function addMiniTiles(map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
}

// Renders a single opportunity's location, pin shown enlarged, on a detail
// page. Clicking anywhere on the preview opens the full map already
// focused on that opportunity.
function renderSingleMiniMap(containerId, slug, mapPageUrl) {
  const opp = opportunities.find(o => opportunitySlug(o) === slug);
  if (!opp) return;

  const map = staticMiniMap(containerId);
  addMiniTiles(map);
  map.setView([opp.lat, opp.lng], 13);
  L.marker([opp.lat, opp.lng], { icon: miniPinIcon(true) }).addTo(map);

  const wrap = document.getElementById(containerId).closest('.mini-map-wrap');
  if (wrap) {
    wrap.addEventListener('click', () => {
      window.location.href = mapPageUrl + '?select=' + encodeURIComponent(slug);
    });
  }
}

// Renders every opportunity as a small dot, used as a preview/launcher next
// to the main page's title. Clicking it is handled by the caller (it opens
// the map popup), not here.
function renderAllMiniMap(containerId) {
  const map = staticMiniMap(containerId);
  addMiniTiles(map);

  const bounds = opportunities.map(o => [o.lat, o.lng]);
  opportunities.forEach(opp => {
    L.marker([opp.lat, opp.lng], { icon: miniPinIcon(false) }).addTo(map);
  });
  map.fitBounds(bounds, { padding: [16, 16] });
}
