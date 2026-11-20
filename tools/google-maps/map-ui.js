/*
 * Interactive map picker: draggable pin + Overview / Satellite / Hybrid layers.
 */

import { isValidCoords, loadMapsApi } from './location.js';

export const MAP_LAYERS = [
  { id: 'overview', label: 'Overview', mapTypeId: 'roadmap' },
  { id: 'satellite', label: 'Satellite', mapTypeId: 'satellite' },
  { id: 'hybrid', label: 'Hybrid', mapTypeId: 'hybrid' },
];

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 2;
const PIN_ZOOM = 15;

/**
 * Create an interactive Google Map with a droppable / draggable pin.
 * @param {HTMLElement} container Map host element
 * @param {object} options
 * @param {string} options.apiKey Google Maps API key
 * @param {(coords: { lat: number, lng: number }) => void} options.onPinChange
 * @param {string} [options.layer] Initial layer id
 */
export async function createMapPicker(container, {
  apiKey,
  onPinChange,
  layer = 'overview',
} = {}) {
  const maps = await loadMapsApi(apiKey);
  const initial = MAP_LAYERS.find((item) => item.id === layer) || MAP_LAYERS[0];

  const map = new maps.Map(container, {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    mapTypeId: initial.mapTypeId,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'greedy',
    clickableIcons: false,
  });

  const marker = new maps.Marker({
    map,
    draggable: true,
    visible: false,
    title: 'Drag to adjust the pin',
  });

  let suppressMove = false;
  let currentLayer = initial.id;

  function emitPin() {
    const position = marker.getPosition();
    if (!position || !marker.getVisible()) return;
    onPinChange?.({
      lat: position.lat(),
      lng: position.lng(),
    });
  }

  function dropPin(lat, lng, { pan = true, zoom = true } = {}) {
    if (!isValidCoords(lat, lng)) return;
    const position = { lat: Number(lat), lng: Number(lng) };
    suppressMove = true;
    marker.setPosition(position);
    marker.setVisible(true);
    if (pan) map.panTo(position);
    if (zoom && map.getZoom() < PIN_ZOOM) map.setZoom(PIN_ZOOM);
    requestAnimationFrame(() => { suppressMove = false; });
  }

  function clearPin() {
    marker.setVisible(false);
  }

  function setLayer(id) {
    const next = MAP_LAYERS.find((item) => item.id === id);
    if (!next) return currentLayer;
    currentLayer = next.id;
    map.setMapTypeId(next.mapTypeId);
    return currentLayer;
  }

  function getLayer() {
    return currentLayer;
  }

  marker.addListener('dragend', () => {
    if (!suppressMove) emitPin();
  });

  map.addListener('click', (event) => {
    if (!event.latLng) return;
    dropPin(event.latLng.lat(), event.latLng.lng(), { pan: false, zoom: false });
    emitPin();
  });

  // Ensure tiles layout correctly inside the narrow plugin panel.
  maps.event.addListenerOnce(map, 'idle', () => {
    maps.event.trigger(map, 'resize');
  });

  return {
    map,
    marker,
    dropPin,
    clearPin,
    setLayer,
    getLayer,
    resize() {
      maps.event.trigger(map, 'resize');
      const position = marker.getPosition();
      if (position && marker.getVisible()) map.panTo(position);
    },
  };
}
