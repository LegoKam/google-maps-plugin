// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  FORMATS,
  buildInsertHtml,
  embedSrc,
  formatSummary,
  geocodeQuery,
  isValidCoords,
  loadMapsApi,
  locationLabel,
  mapsLink,
  parseCoords,
  parseMapsUrl,
  placeToLocation,
  reverseGeocode,
} from './location.js';
import { loadSettings, saveSettings } from './secrets.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([name, value]) => {
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (value === true) node.setAttribute(name, '');
    else if (value !== false && value != null) node.setAttribute(name, value);
  });
  node.append(...children.filter((child) => child != null));
  return node;
}

function field(label, control, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control, hint);
}

function setStatus(node, message = '', type = 'info') {
  node.textContent = message;
  node.dataset.type = type;
  node.hidden = !message;
}

(async function init() {
  const sdk = await DA_SDK;
  const { context, actions } = sdk;
  const { org } = context;
  let { token } = sdk;
  window.addEventListener('message', (e) => {
    if (e.data?.token) token = e.data.token;
  });

  const state = {
    settings: { apiKey: '' },
    location: null,
    format: 'link',
    selection: '',
    result: '',
    resultMeta: null,
    loadFailed: false,
    autocompleteReady: false,
  };

  /* ---------- Main view ---------- */

  const notice = el('p', { class: 'notice', hidden: true });
  const searchInput = el('input', {
    type: 'search',
    id: 'place-search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Search for a place or paste a Maps URL',
  });
  const latInput = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Latitude',
  });
  const lngInput = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Longitude',
  });
  const resolveBtn = el('button', { type: 'button' }, 'Look up');
  const formatChips = el('div', { class: 'chips' });
  const locationCard = el('div', { class: 'location-card empty' });
  const mapPreview = el('iframe', {
    class: 'map-preview',
    title: 'Map preview',
    loading: 'lazy',
    referrerpolicy: 'strict-origin-when-cross-origin',
    hidden: true,
  });
  const insertBtn = el('button', { type: 'button', class: 'primary', disabled: true }, 'Insert');
  const status = el('p', { class: 'status', role: 'status', hidden: true });
  const resultPreview = el('div', { class: 'result-preview' });
  const resultActions = el('div', { class: 'actions' });
  const resultSection = el('section', { class: 'result', hidden: true }, el('h2', {}, 'Ready'), resultPreview, resultActions);

  function applyResult(mode) {
    const { result, resultMeta } = state;
    if (!result) return;
    if (mode === 'replace') {
      actions.sendHTML(result);
      setStatus(status, 'Replaced the current selection.', 'success');
      return;
    }
    if (mode === 'insert-after') {
      actions.sendHTML(`${resultMeta?.selectionHtml || ''}${result}`);
      setStatus(status, 'Inserted after the selection.', 'success');
      return;
    }
    actions.sendHTML(result);
    setStatus(status, 'Inserted at the cursor.', 'success');
  }

  function renderResultActions() {
    const hasSelection = !!state.selection;
    resultActions.replaceChildren(
      el('button', {
        type: 'button',
        class: 'primary',
        onclick: () => applyResult(hasSelection ? 'replace' : 'insert'),
      }, hasSelection ? 'Replace selection' : 'Insert at cursor'),
      hasSelection
        ? el('button', {
          type: 'button',
          onclick: () => applyResult('insert-after'),
        }, 'Insert after selection')
        : null,
    );
  }

  async function prepareInsert() {
    if (!state.location) return;
    insertBtn.disabled = true;
    setStatus(status, 'Preparing…');
    try {
      const html = await buildInsertHtml(state.location, state.format, {
        apiKey: state.settings.apiKey,
      });
      state.result = html;
      state.resultMeta = {
        format: state.format,
        selectionHtml: state.selection,
      };
      resultPreview.textContent = formatSummary(state.location, state.format);
      renderResultActions();
      resultSection.hidden = false;
      setStatus(status);
    } catch (error) {
      state.result = '';
      resultSection.hidden = true;
      setStatus(status, error.message, 'error');
    } finally {
      insertBtn.disabled = !state.location;
    }
  }

  function renderFormats() {
    formatChips.replaceChildren(...FORMATS.map(({ id, label }) => el('button', {
      type: 'button',
      class: `chip${state.format === id ? ' is-active' : ''}`,
      onclick: () => {
        state.format = id;
        renderFormats();
        if (state.location) prepareInsert();
      },
    }, label)));
  }

  function renderLocation() {
    const { location } = state;
    locationCard.classList.toggle('empty', !location);
    if (!location) {
      locationCard.replaceChildren(el(
        'p',
        {},
        'No place selected yet. Search, enter coordinates, or paste a Google Maps link.',
      ));
      mapPreview.hidden = true;
      mapPreview.removeAttribute('src');
      insertBtn.disabled = true;
      return;
    }

    const bits = [];
    if (location.address) bits.push(location.address);
    if (isValidCoords(location.lat, location.lng)) {
      bits.push(`${location.lat}, ${location.lng}`);
    }
    locationCard.replaceChildren(
      el('div', { class: 'location-name' }, locationLabel(location)),
      el('div', { class: 'location-meta' }, bits.filter((b, i, arr) => arr.indexOf(b) === i).join(' · ')),
      location.mapsUrl || mapsLink(location)
        ? el('a', {
          href: location.mapsUrl || mapsLink(location),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'Open in Google Maps')
        : null,
    );

    const previewSrc = embedSrc(location, state.settings.apiKey);
    if (previewSrc) {
      mapPreview.src = previewSrc;
      mapPreview.hidden = false;
    } else {
      mapPreview.hidden = true;
      mapPreview.removeAttribute('src');
    }
    insertBtn.disabled = false;
  }

  function setLocation(location) {
    state.location = location;
    state.result = '';
    state.resultMeta = null;
    resultSection.hidden = true;
    if (location && isValidCoords(location.lat, location.lng)) {
      latInput.value = String(location.lat);
      lngInput.value = String(location.lng);
    }
    if (location?.address && !searchInput.value.trim()) {
      searchInput.value = location.address;
    }
    renderLocation();
  }

  async function refreshSelection() {
    try {
      state.selection = await actions.getSelection();
    } catch {
      state.selection = '';
    }
    if (state.result) renderResultActions();
  }

  async function resolveFromCoords() {
    const lat = latInput.value.trim();
    const lng = lngInput.value.trim();
    if (!isValidCoords(lat, lng)) {
      setStatus(status, 'Enter a valid latitude (−90 to 90) and longitude (−180 to 180).', 'error');
      return;
    }
    if (!state.settings.apiKey) {
      setLocation({
        name: '',
        address: '',
        lat: Number(lat),
        lng: Number(lng),
        placeId: '',
        mapsUrl: '',
      });
      setStatus(status);
      await prepareInsert();
      return;
    }
    setStatus(status, 'Looking up coordinates…');
    try {
      setLocation(await reverseGeocode(state.settings.apiKey, lat, lng));
      setStatus(status);
      await prepareInsert();
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  }

  async function resolveFromSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      setStatus(status, 'Enter an address, place name, or Google Maps URL.', 'error');
      searchInput.focus();
      return;
    }

    const fromUrl = parseMapsUrl(query);
    if (fromUrl) {
      setStatus(status, 'Resolving Maps URL…');
      try {
        if (state.settings.apiKey && (fromUrl.lat == null || !fromUrl.address)) {
          if (isValidCoords(fromUrl.lat, fromUrl.lng)) {
            const resolved = await reverseGeocode(state.settings.apiKey, fromUrl.lat, fromUrl.lng);
            setLocation({ ...resolved, mapsUrl: fromUrl.mapsUrl || resolved.mapsUrl });
          } else if (fromUrl.query) {
            const resolved = await geocodeQuery(state.settings.apiKey, fromUrl.query);
            setLocation({ ...resolved, mapsUrl: fromUrl.mapsUrl || resolved.mapsUrl });
          } else {
            setLocation({
              name: '',
              address: fromUrl.query || '',
              lat: fromUrl.lat,
              lng: fromUrl.lng,
              placeId: fromUrl.placeId,
              mapsUrl: fromUrl.mapsUrl,
            });
          }
        } else {
          setLocation({
            name: '',
            address: fromUrl.query || '',
            lat: fromUrl.lat,
            lng: fromUrl.lng,
            placeId: fromUrl.placeId,
            mapsUrl: fromUrl.mapsUrl,
          });
        }
        setStatus(status);
        await prepareInsert();
      } catch (error) {
        setStatus(status, error.message, 'error');
      }
      return;
    }

    const coords = parseCoords(query);
    if (coords) {
      latInput.value = String(coords.lat);
      lngInput.value = String(coords.lng);
      await resolveFromCoords();
      return;
    }

    if (!state.settings.apiKey) {
      setLocation({
        name: '',
        address: query,
        lat: null,
        lng: null,
        placeId: '',
        mapsUrl: '',
      });
      setStatus(status, 'Saved as an address. Add an API key in Settings to geocode and autocomplete.', 'info');
      await prepareInsert();
      return;
    }

    setStatus(status, 'Looking up address…');
    try {
      setLocation(await geocodeQuery(state.settings.apiKey, query));
      setStatus(status);
      await prepareInsert();
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  }

  async function setupAutocomplete() {
    if (!state.settings.apiKey || state.autocompleteReady) return;
    try {
      const maps = await loadMapsApi(state.settings.apiKey);
      const autocomplete = new maps.places.Autocomplete(searchInput, {
        fields: ['formatted_address', 'geometry', 'name', 'place_id', 'url'],
      });
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place?.geometry) {
          setStatus(status, 'Pick a suggestion from the list, or press Look up.', 'error');
          return;
        }
        setLocation(placeToLocation(place));
        setStatus(status);
        prepareInsert();
      });
      state.autocompleteReady = true;
      notice.hidden = true;
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  }

  function renderConfigured() {
    const hasKey = !!state.settings.apiKey;
    notice.hidden = hasKey || state.loadFailed;
    notice.textContent = hasKey
      ? ''
      : 'No Google Maps API key yet. You can still paste a Maps URL or enter coordinates. Open Settings to enable place search and Embed API maps.';
    if (hasKey) setupAutocomplete();
  }

  resolveBtn.addEventListener('click', resolveFromSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      resolveFromSearch();
    }
  });
  insertBtn.addEventListener('click', prepareInsert);

  const settingsView = el('main', { class: 'view', hidden: true });
  const mainView = el(
    'main',
    { class: 'view' },
    el(
      'header',
      {},
      el('h1', {}, 'Google Maps'),
      el('button', {
        type: 'button',
        class: 'quiet',
        onclick: () => {
          mainView.hidden = true;
          settingsView.hidden = false;
        },
      }, 'Settings'),
    ),
    notice,
    el(
      'section',
      {},
      el('label', { class: 'field-label', for: 'place-search' }, 'Find a place'),
      searchInput,
      el('p', { class: 'hint' }, 'Address, place name, lat/lng, or a Google Maps link.'),
      el('div', { class: 'coord-row' }, latInput, lngInput),
      el('div', { class: 'actions' }, resolveBtn, el('button', {
        type: 'button',
        onclick: resolveFromCoords,
      }, 'Use coordinates')),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Selected location'),
      locationCard,
      mapPreview,
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Insert as'),
      formatChips,
      el('p', { class: 'hint' }, 'Address text, coordinates, Maps link, QR code, or an embedded map.'),
    ),
    insertBtn,
    status,
    resultSection,
  );

  /* ---------- Settings view ---------- */

  const keyInput = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
  const saveBtn = el('button', { type: 'submit', class: 'primary' }, 'Save');
  const testBtn = el('button', { type: 'button' }, 'Test key');
  const settingsStatus = el('p', { class: 'status', role: 'status', hidden: true });

  function fillForm() {
    keyInput.value = '';
    keyInput.placeholder = state.settings.apiKey
      ? 'Saved. Leave blank to keep it.'
      : 'Paste your Google Maps API key';
  }

  function readForm() {
    const entered = keyInput.value.trim();
    return {
      apiKey: entered || state.settings.apiKey,
    };
  }

  async function withBusy(button, label, task) {
    const original = button.textContent;
    saveBtn.disabled = true;
    testBtn.disabled = true;
    button.textContent = label;
    try {
      await task();
    } catch (error) {
      setStatus(settingsStatus, error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      testBtn.disabled = false;
      button.textContent = original;
    }
  }

  function onSave(e) {
    e.preventDefault();
    const settings = readForm();
    if (!settings.apiKey) {
      setStatus(settingsStatus, 'Paste an API key before saving.', 'error');
      return;
    }
    withBusy(saveBtn, 'Saving…', async () => {
      state.settings = await saveSettings({ org, token, settings });
      state.loadFailed = false;
      state.autocompleteReady = false;
      fillForm();
      renderConfigured();
      setStatus(settingsStatus, `Saved for everyone in ${org}.`, 'success');
    });
  }

  function onTest() {
    const settings = readForm();
    if (!settings.apiKey) {
      setStatus(settingsStatus, 'Paste an API key to test.', 'error');
      return;
    }
    withBusy(testBtn, 'Testing…', async () => {
      setStatus(settingsStatus, 'Loading Google Maps…');
      state.autocompleteReady = false;
      loadMapsApi.pending = null;
      await loadMapsApi(settings.apiKey);
      const place = await geocodeQuery(settings.apiKey, 'Adobe San Jose');
      setStatus(
        settingsStatus,
        `Connected. Geocoded sample: ${place.address}`,
        'success',
      );
    });
  }

  testBtn.addEventListener('click', onTest);

  settingsView.append(
    el(
      'header',
      {},
      el('h1', {}, 'Settings'),
      el('button', {
        type: 'button',
        class: 'quiet',
        onclick: () => {
          settingsView.hidden = true;
          mainView.hidden = false;
        },
      }, 'Back'),
    ),
    el(
      'p',
      { class: 'hint' },
      `This API key applies to everyone in ${org}. It is stored in the "secrets" sheet of the organisation's da.live config. Enable Maps JavaScript API, Places API, Geocoding API, and Maps Embed API. Prefer HTTP-referrer restrictions that allow da.live and your site.`,
    ),
    el(
      'form',
      { onsubmit: onSave },
      field('Google Maps API key', keyInput),
      el('div', { class: 'actions' }, saveBtn, testBtn),
      settingsStatus,
    ),
  );

  /* ---------- Start ---------- */

  renderFormats();
  renderLocation();
  document.body.append(mainView, settingsView);
  document.documentElement.addEventListener('pointerenter', refreshSelection);
  refreshSelection();

  try {
    state.settings = await loadSettings({ org, token });
  } catch (error) {
    state.loadFailed = true;
    setStatus(status, error.message, 'error');
  }
  fillForm();
  renderConfigured();
}());
