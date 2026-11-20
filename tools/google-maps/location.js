/*
 * Resolve places and build insertable HTML for Google Maps locations.
 */

export const FORMATS = [
  { id: 'address', label: 'Address' },
  { id: 'coordinates', label: 'Coordinates' },
  { id: 'link', label: 'Link' },
  { id: 'qr', label: 'QR code' },
];

const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roundCoord(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

export function isValidCoords(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function parseCoords(text) {
  const match = COORD_RE.exec(text || '');
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!isValidCoords(lat, lng)) return null;
  return { lat, lng };
}

/**
 * Pull coordinates / query / place id out of a pasted Google Maps URL.
 */
export function parseMapsUrl(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.[^/]+$/i.test(url.hostname) && url.hostname !== 'maps.app.goo.gl') {
    return null;
  }

  const at = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at && isValidCoords(at[1], at[2])) {
    return {
      lat: Number(at[1]),
      lng: Number(at[2]),
      query: url.searchParams.get('q') || '',
      placeId: url.searchParams.get('query_place_id') || '',
      mapsUrl: raw,
    };
  }

  const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
  const coords = parseCoords(q);
  if (coords) {
    return {
      ...coords,
      query: q,
      placeId: url.searchParams.get('query_place_id') || '',
      mapsUrl: raw,
    };
  }

  const data = url.searchParams.get('data') || '';
  const dataCoords = data.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataCoords && isValidCoords(dataCoords[1], dataCoords[2])) {
    return {
      lat: Number(dataCoords[1]),
      lng: Number(dataCoords[2]),
      query: q,
      placeId: '',
      mapsUrl: raw,
    };
  }

  if (q || url.searchParams.get('place_id')) {
    return {
      lat: null,
      lng: null,
      query: q,
      placeId: url.searchParams.get('place_id') || url.searchParams.get('query_place_id') || '',
      mapsUrl: raw,
    };
  }

  return {
    lat: null,
    lng: null,
    query: '',
    placeId: '',
    mapsUrl: raw,
  };
}

/**
 * Share / QR / panel link. When coordinates exist (dropped pin), always open
 * Google Maps at that exact lat/lng — never re-resolve via address or place id.
 */
export function mapsLink(location) {
  if (isValidCoords(location.lat, location.lng)) {
    const lat = roundCoord(location.lat);
    const lng = roundCoord(location.lng);
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
  if (location.placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(location.placeId)}`;
  }
  if (location.mapsUrl) return location.mapsUrl;
  if (location.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
  }
  return '';
}

export function locationLabel(location) {
  return location.address
    || location.name
    || (isValidCoords(location.lat, location.lng)
      ? `${roundCoord(location.lat)}, ${roundCoord(location.lng)}`
      : 'Selected location');
}

function addressHtml(location) {
  const text = location.address || location.name || locationLabel(location);
  return `<p>${escapeHtml(text)}</p>`;
}

function coordinatesHtml(location) {
  if (!isValidCoords(location.lat, location.lng)) {
    throw new Error('This location has no coordinates yet. Search again or enter latitude and longitude.');
  }
  return `<p>${roundCoord(location.lat)}, ${roundCoord(location.lng)}</p>`;
}

function linkHtml(location) {
  const href = mapsLink(location);
  if (!href) throw new Error('Could not build a Google Maps link for this location.');
  const label = locationLabel(location);
  return `<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
}

async function qrDataUrl(text) {
  // eslint-disable-next-line import/no-unresolved
  const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
  const QRCode = mod.default || mod;
  return QRCode.toDataURL(text, {
    width: 256,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}

async function qrHtml(location) {
  const href = mapsLink(location);
  if (!href) throw new Error('Could not build a Google Maps link for the QR code.');
  const src = await qrDataUrl(href);
  const label = locationLabel(location);
  return `<p><img src="${src}" alt="QR code for ${escapeHtml(label)}" width="256" height="256"></p>
<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
}

/** Build the HTML snippet that will be inserted into the document. */
export async function buildInsertHtml(location, format) {
  switch (format) {
    case 'address':
      return addressHtml(location);
    case 'coordinates':
      return coordinatesHtml(location);
    case 'link':
      return linkHtml(location);
    case 'qr':
      return qrHtml(location);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export function formatSummary(location, format) {
  const label = locationLabel(location);
  const titles = {
    address: `Address: ${label}`,
    coordinates: isValidCoords(location.lat, location.lng)
      ? `Coordinates: ${roundCoord(location.lat)}, ${roundCoord(location.lng)}`
      : `Coordinates unavailable for ${label}`,
    link: `Link: ${label}`,
    qr: `QR code → ${label}`,
  };
  return titles[format] || label;
}

/**
 * Load the Maps JavaScript API (Places) once for the given key.
 */
export function loadMapsApi(apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return Promise.reject(new Error('Add a Google Maps API key in Settings.'));
  if (window.google?.maps?.places) return Promise.resolve(window.google.maps);

  if (!loadMapsApi.pending) {
    loadMapsApi.pending = new Promise((resolve, reject) => {
      const previous = window.gm_authFailure;
      window.gm_authFailure = () => {
        loadMapsApi.pending = null;
        if (typeof previous === 'function') previous();
        reject(new Error('Google Maps rejected the API key. Check the key, billing, and HTTP referrer restrictions.'));
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
      script.async = true;
      script.onload = () => {
        const start = Date.now();
        const wait = () => {
          if (window.google?.maps?.places) {
            resolve(window.google.maps);
            return;
          }
          if (Date.now() - start > 10000) {
            loadMapsApi.pending = null;
            reject(new Error('Google Maps loaded but Places is unavailable.'));
            return;
          }
          requestAnimationFrame(wait);
        };
        wait();
      };
      script.onerror = () => {
        loadMapsApi.pending = null;
        reject(new Error('Could not load the Google Maps JavaScript API.'));
      };
      document.head.append(script);
    }).then((maps) => {
      loadMapsApi.pending = Promise.resolve(maps);
      return maps;
    });
  }
  return loadMapsApi.pending;
}

loadMapsApi.pending = null;

/** Geocode a free-text query with the Maps JS Geocoder. */
export async function geocodeQuery(apiKey, query) {
  const maps = await loadMapsApi(apiKey);
  const geocoder = new maps.Geocoder();
  const response = await geocoder.geocode({ address: query });
  const result = response.results?.[0];
  if (!result) throw new Error('No results for that address.');
  return {
    name: result.address_components?.[0]?.long_name || '',
    address: result.formatted_address || query,
    lat: result.geometry.location.lat(),
    lng: result.geometry.location.lng(),
    placeId: result.place_id || '',
    mapsUrl: '',
  };
}

/** Reverse-geocode coordinates. */
export async function reverseGeocode(apiKey, lat, lng) {
  if (!isValidCoords(lat, lng)) throw new Error('Enter a valid latitude and longitude.');
  const maps = await loadMapsApi(apiKey);
  const geocoder = new maps.Geocoder();
  const response = await geocoder.geocode({ location: { lat: Number(lat), lng: Number(lng) } });
  const result = response.results?.[0];
  return {
    name: '',
    address: result?.formatted_address || `${roundCoord(lat)}, ${roundCoord(lng)}`,
    lat: Number(lat),
    lng: Number(lng),
    placeId: result?.place_id || '',
    mapsUrl: '',
  };
}

/** Turn a Place result from Autocomplete into our location shape. */
export function placeToLocation(place) {
  const loc = place.geometry?.location;
  return {
    name: place.name || '',
    address: place.formatted_address || place.name || '',
    lat: loc ? loc.lat() : null,
    lng: loc ? loc.lng() : null,
    placeId: place.place_id || '',
    // Prefer geometry coordinates for share links; do not keep place.url
    // (it can open a different venue than the pin).
    mapsUrl: '',
  };
}
