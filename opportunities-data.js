// Shared opportunity location data, used by map.html and the small map
// preview on each opportunities/*.html detail page. Coordinates are
// geocoded (via OpenStreetMap Nominatim) against each address where one
// exists. Opportunities with no single fixed address (multiple sites, or a
// city-only listing) are pinned at a representative point instead — those
// are flagged "approx" and noted in their popup.
const opportunities = [
  {
    name: "Bellevue Farmers Market",
    tag: "Community · Food",
    link: "opportunities/bellevue-farmers-market.html",
    address: "1717 Bellevue Way NE, Bellevue, WA",
    lat: 47.6263840, lng: -122.2053766,
    approx: false,
    desc: "Help set up tents and tables, assist shoppers at the info booth, or support vendors during the weekly farmers market. One-time or recurring shifts available."
  },
  {
    name: "City of Sammamish — Park Volunteer Events",
    tag: "Environment",
    link: "opportunities/sammamish-park-events.html",
    address: "Sammamish, WA",
    lat: 47.6017554, lng: -122.0416844,
    approx: true,
    liveUrl: "https://sammamish.galaxydigital.com/need/",
    desc: "Help restore local parks by removing invasive plants, adding native plantings, building trails, and restoring wetlands. Frequent one-time events with water, snacks, gloves, and tools provided."
  },
  {
    name: "EarthCorps",
    tag: "Environment",
    link: "opportunities/earthcorps.html",
    address: "Eastside, WA",
    lat: 47.6144219, lng: -122.1923370,
    approx: true,
    liveUrl: "https://www.earthcorps.org/volunteer/calendar/",
    desc: "Remove invasive plants and restore forests and parks across the Puget Sound region. Tools, gloves, and snacks provided. No experience needed."
  },
  {
    name: "Food Lifeline",
    tag: "Food",
    link: "opportunities/food-lifeline.html",
    address: "815 S 96th St, Seattle, WA",
    lat: 47.5194, lng: -122.3212,
    approx: false,
    liveUrl: "https://foodlifeline.org/volunteer",
    desc: "Sort and repack donated food at a large warehouse that distributes meals to 300+ food banks across Western Washington. Fast-paced, action-packed 2-hour shifts."
  },
  {
    name: "KidVantage",
    tag: "Community",
    link: "opportunities/kidvantage.html",
    address: "Issaquah, WA",
    lat: 47.5348778, lng: -122.0432970,
    approx: true,
    liveUrl: "https://kidvantagenw.volunteerhub.com/vv2/",
    desc: "Sort donated clothing, shoes, diapers, and baby gear, and pack weekly orders of essentials for kids across the Eastside. Pick a shift that works for you and show up."
  },
  {
    name: "King County Parks",
    tag: "Environment",
    link: "opportunities/king-county-parks.html",
    address: "Eastside parks, King County, WA",
    lat: 47.6144219, lng: -122.1923370,
    approx: true,
    liveUrl: "https://parksvolunteer.kingcounty.gov/",
    desc: "Help keep local parks healthy by weeding, spreading wood chips, planting trees, and picking up litter. Tools and instruction provided — no experience needed."
  },
  {
    name: "tBUG — The Bellevue Urban Garden",
    tag: "Food · Environment",
    link: "opportunities/tbug.html",
    address: "1608 156th Pl NE, Bellevue, WA",
    lat: 47.6136953, lng: -122.1318321,
    approx: false,
    desc: "Help at a 3-acre urban farm by harvesting, planting, weeding, watering, and building. A volunteer-run farm in the heart of Bellevue growing food for those in need."
  },
  {
    name: "The Sophia Way — Donation Center",
    tag: "Community",
    link: "opportunities/sophia-way.html",
    address: "Bellevue, WA",
    lat: 47.6144219, lng: -122.1923370,
    approx: true,
    liveUrl: "https://volunteer.bloomerang.co/JE/uxxmhf89pf6yta",
    desc: "Sort and organize donated clothing and household items at the donation center for The Sophia Way, which provides shelter and support to women experiencing homelessness on the Eastside."
  },
  {
    name: "Washington Trails Association",
    tag: "Environment",
    link: "opportunities/wta.html",
    address: "Eastside trails, WA",
    lat: 47.4982923, lng: -122.0445279,
    approx: true,
    liveUrl: "https://www.wta.org/volunteer",
    desc: "Maintain hiking trails across Washington — clearing brush, improving drainage, and doing the physical work that keeps trails open and safe. No experience needed."
  },
  {
    name: "Bellevue Botanical Garden",
    tag: "Environment",
    link: "opportunities/bellevue-botanical-garden.html",
    address: "12001 Main St, Bellevue, WA",
    lat: 47.6066417, lng: -122.1774825,
    approx: false,
    desc: "Help maintain a 53-acre public garden as a Garden Assistant, or support youth workshops and events. Tools and training provided in one of the most peaceful settings on this list."
  },
  {
    name: "Hopelink Food Market",
    tag: "Food · Community",
    link: "opportunities/hopelink.html",
    address: "Bellevue, WA",
    lat: 47.6144219, lng: -122.1923370,
    approx: true,
    liveUrl: "https://hopelink.volunteerhub.com",
    desc: "Help run Hopelink's grocery-style food markets, where families shop for free and choose items that fit their needs. Stock shelves, check in shoppers, and sort donations."
  },
  {
    name: "Jubilee REACH Thrift Store",
    tag: "Community",
    link: "opportunities/jubilee-reach.html",
    address: "2301 148th Ave NE, Bellevue, WA",
    lat: 47.6306616, lng: -122.1441930,
    approx: false,
    desc: "Sort and process donations, hang clothes, organize shelving, and help keep the floor stocked at a Bellevue thrift store. Proceeds fund Jubilee REACH's programs for local families."
  },
  {
    name: "Renewal Food Bank",
    tag: "Food",
    link: "opportunities/renewal-food-bank.html",
    address: "15022 Bel-Red Road, Bellevue, WA",
    lat: 47.6275854, lng: -122.1396116,
    approx: false,
    desc: "Help stock shelves, assist shoppers, and keep a community food bank running for hundreds of families in East King County every week."
  },
  {
    name: "Kelsey Creek Farm",
    tag: "Animals · Environment",
    link: "opportunities/kelsey-creek-farm.html",
    address: "410 130th Pl SE, Bellevue, WA",
    lat: 47.6055545, lng: -122.1655511,
    approx: false,
    desc: "Help care for farm animals, clean barns, and assist at events at Bellevue's historic educational farm. Earn community service hours while learning about animal care."
  },
  {
    name: "Sammamish Animal Sanctuary",
    tag: "Animals",
    link: "opportunities/sammamish-animal-sanctuary.html",
    address: "16515 SE May Valley Road, Renton, WA",
    lat: 47.5022389, lng: -122.1206534,
    approx: false,
    desc: "Help care for rescued barnyard animals — goats, pigs, cows, and chickens — through daily feeding, cleaning, and sanctuary upkeep. Training included on your first shift."
  },
  {
    name: "Mercer Island Parks",
    tag: "Environment",
    link: "opportunities/mercer-island-parks.html",
    address: "Mercer Island, WA",
    lat: 47.5766324, lng: -122.2276378,
    approx: true,
    liveUrl: "https://www.mercerisland.gov/parksrec/page/volunteer-mercer-island-parks",
    desc: "Restore Mercer Island's parks and forests — removing invasive ivy and blackberry, planting natives, spreading mulch, and light trail work. No experience needed."
  },
  {
    name: "FamilyWorks",
    tag: "Food · Community",
    link: "opportunities/familyworks.html",
    address: "1501 N 45th St, Seattle, WA",
    lat: 47.6613, lng: -122.3376,
    approx: false,
    desc: "Help fight hunger in North Seattle. At monthly Supermarket Saturday food drives, hand out flyers and collect donations at the Wallingford QFC."
  },
  {
    name: "Treehouse Store",
    tag: "Community",
    link: "opportunities/treehouse.html",
    address: "2100 24th Ave S, Seattle, WA",
    lat: 47.5841884, lng: -122.3012530,
    approx: false,
    desc: "Support kids in foster care at the Treehouse Store, a free shopping space where foster youth pick out clothes, shoes, and supplies. Sort and tag donations and restock shelves."
  }
];

function opportunitySlug(opp) {
  return opp.link.split('/').pop().replace('.html', '');
}

// A classic map-pin shape (same silhouette as Leaflet's default marker),
// drawn as inline SVG so the fill is an exact hex color rather than a
// filter approximation over a pre-colored image. `height` controls
// overall size; the width is derived from the marker's native 25:41
// aspect ratio so it never looks stretched.
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
    iconUrl: MARKER_ICON_URL,
    iconSize: [width, height],
    iconAnchor: [Math.round(width / 2), height],
    popupAnchor: [0, -height]
  };
  if (withShadow) {
    options.shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';
    options.shadowSize = [height, height];
  }
  return L.icon(options);
}
