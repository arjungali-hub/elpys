// Turns a street address into coordinates, so a listing gets a map pin to
// confirm rather than a blank pair of boxes to fill in by hand.
//
// Shared by /api/submit (geocodes a new submission before inserting it) and
// /api/admin (re-geocodes when an admin edits the address of an existing row).
//
// Never throws and never blocks the caller: a vague address, a slow response or
// an outage all resolve to nulls with a reason attached, which the admin panel
// surfaces as "could not locate this" so coordinates can be entered by hand.
// Nominatim's usage policy asks for an identifying User-Agent, so one is sent.
async function geocodeAddress(address) {
  const query = String(address || '').trim();
  if (!query) return { lat: null, lng: null, error: 'No address provided.' };

  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
            + encodeURIComponent(query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Elpys/1.0 (https://elpys.vercel.app; elpysnotifications@gmail.com)',
      },
      signal: controller.signal,
    });
    if (!r.ok) return { lat: null, lng: null, error: 'Geocoder returned HTTP ' + r.status + '.' };

    const matches = await r.json();
    if (!Array.isArray(matches) || !matches.length) {
      return { lat: null, lng: null, error: 'No match found for this address.' };
    }
    const lat = parseFloat(matches[0].lat);
    const lng = parseFloat(matches[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) {
      return { lat: null, lng: null, error: 'Geocoder returned unusable coordinates.' };
    }
    return { lat: lat, lng: lng, error: null };
  } catch (err) {
    const detail = err && err.name === 'AbortError' ? 'timed out after 8s' : (err && err.message) || String(err);
    console.error('Geocoding failed for', JSON.stringify(query), '-', detail);
    return { lat: null, lng: null, error: 'Could not reach the geocoder (' + detail + ').' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { geocodeAddress };
