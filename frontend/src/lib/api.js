/**
 * Aether v2 API Client
 * Typed fetch wrappers for atmospheric data, dose simulation, route scoring,
 * schedule optimization, and Glass-Box Agent co-pilot.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const message = errBody.detail || `API error ${res.status}: ${res.statusText}`;
      throw new Error(message);
    }
    return await res.json();
  } catch (err) {
    console.error(`Request to ${endpoint} failed:`, err);
    throw err;
  }
}

/**
 * Health check & provider status
 */
export async function fetchHealth() {
  return request('/api/health');
}

/**
 * Built-in demo cities
 */
export async function fetchPresets() {
  return request('/api/presets');
}

/**
 * Geocode search query
 */
export async function geocodeCity(q) {
  if (!q || !q.trim()) return [];
  const res = await request(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
  return res.results || [];
}

/**
 * Comprehensive atmospheric state for coordinates
 */
export async function fetchAtmosphere(lat, lon, persona = 'healthy_adult', hasHepa = false) {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    persona,
    has_hepa: hasHepa ? 'true' : 'false',
  });
  return request(`/api/atmosphere?${params.toString()}`);
}

/**
 * Clinical respiratory dose simulation
 */
export async function simulateDose(payload) {
  return request('/api/dose/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Clean air routing with LUR and steepness multipliers
 */
export async function compareRoutes(payload) {
  return request('/api/routes/compare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * 24h deterministic schedule solver
 */
export async function optimizeSchedule(payload) {
  return request('/api/schedule/optimize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Glass-Box Agentic Co-pilot chat
 */
export async function sendChatMessage(message, cityOrCoords = 'Delhi', persona = 'healthy_adult', history = []) {
  return request('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      city_or_coords: cityOrCoords,
      persona,
      history,
    }),
  });
}
