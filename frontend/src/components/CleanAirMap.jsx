import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Route, Navigation, Zap } from 'lucide-react';
import { compareRoutes } from '../lib/api';
import RouteComparisonStrip, { SAMPLE_COMMUTES } from './RouteComparisonStrip';

function createMarkerIcon(label, colorBg) {
  return L.divIcon({
    className: 'custom-map-marker',
    html: `<div class="flex items-center justify-center w-6 h-6 rounded-full text-white font-mono text-xs font-bold shadow-lg border-2 border-white/80 ${colorBg}">${label}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const originMarkerIcon = createMarkerIcon('A', 'bg-blue-600');
const destMarkerIcon = createMarkerIcon('B', 'bg-emerald-600');

function MapClickHandler({ onSelectPoint }) {
  useMapEvents({
    click(e) {
      onSelectPoint(e.latlng);
    },
  });
  return null;
}

function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
      map.setView([center.lat, center.lon], 13);
    }
  }, [center, map]);
  return null;
}

/**
 * Interactive Leaflet map for comparing Land-Use Regression (LUR) clean-air commute routes.
 * @param {{
 *   coords: { lat: number, lon: number },
 *   activeCity: string,
 *   atmosphere: object | null,
 *   activePersona: string,
 * }} props
 */
export default function CleanAirMap({ coords, activeCity, atmosphere, activePersona }) {
  const cityKey = `${(activeCity || '').toLowerCase()}:${coords?.lat ?? ''}:${coords?.lon ?? ''}`;
  const [selection, setSelection] = useState({ key: null, origin: null, destination: null, results: null });
  const [travelMode, setTravelMode] = useState('walking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const defaultSample = useMemo(() => {
    const nameKey = (activeCity || '').toLowerCase();
    const safeLat = Number.isFinite(coords?.lat) ? coords.lat : 28.6139;
    const safeLon = Number.isFinite(coords?.lon) ? coords.lon : 77.2090;
    return (
      SAMPLE_COMMUTES[nameKey] || {
        origin: { lat: safeLat, lon: safeLon, label: `${activeCity} Origin` },
        destination: { lat: safeLat + 0.025, lon: safeLon + 0.025, label: `${activeCity} Dest` },
      }
    );
  }, [activeCity, coords?.lat, coords?.lon]);

  const isCustomForCity = selection.key === cityKey;
  const origin = isCustomForCity ? selection.origin : defaultSample.origin;
  const destination = isCustomForCity ? selection.destination : defaultSample.destination;
  const routingResults = isCustomForCity ? selection.results : null;

  const handleMapClick = (latlng) => {
    if (!origin || (origin && destination)) {
      setSelection({
        key: cityKey,
        origin: { lat: latlng.lat, lon: latlng.lng, label: 'Selected Origin (A)' },
        destination: null,
        results: null,
      });
    } else {
      setSelection((prev) => ({
        key: cityKey,
        origin: prev.key === cityKey ? prev.origin : origin,
        destination: { lat: latlng.lat, lon: latlng.lng, label: 'Selected Dest (B)' },
        results: null,
      }));
    }
  };

  const handleCompareRoutes = async (orig = origin, dest = destination) => {
    if (!orig || !dest) return;
    setLoading(true);
    setError(null);
    const currentPm25 = atmosphere?.forecast?.air_quality?.hourly?.pm2_5?.[0] ?? 100.0;

    try {
      const res = await compareRoutes({
        origin: [orig.lat, orig.lon],
        destination: [dest.lat, dest.lon],
        mode: travelMode,
        background_pm25: currentPm25,
        persona: activePersona,
        mask: 'none',
        mask_fit: 'sealed',
      });
      setSelection({ key: cityKey, origin: orig, destination: dest, results: res });
    } catch (err) {
      console.error('Route scoring failed:', err);
      setError(err.message || 'Unable to compute clean air route alternatives.');
    } finally {
      setLoading(false);
    }
  };

  const routesToRender = (routingResults?.routes || []).map((r, idx) => {
    let positions = [];
    if (r.geometry && Array.isArray(r.geometry.coordinates)) {
      positions = r.geometry.coordinates.map((pt) => [pt[1], pt[0]]);
    } else if (origin && destination) {
      positions = [
        [origin.lat, origin.lon],
        [destination.lat, destination.lon],
      ];
    }
    const isCleanest = r.is_cleanest || idx === 0;
    return {
      ...r,
      positions,
      color: isCleanest ? '#10B981' : idx === 1 ? '#F59E0B' : '#EF4444',
      weight: isCleanest ? 5 : 3,
      dashArray: isCleanest ? undefined : '5, 8',
      isCleanest,
    };
  });

  return (
    <div className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass flex flex-col justify-between">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-glass pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald/15 border border-emerald/30 text-emerald">
              <Route className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Clean Air LUR Routing Engine</h3>
              <p className="text-[11px] text-slate-400">
                Land-Use Regression road type (Arterial 1.40 vs Cycleway 0.65) + steepness ventilation penalty
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleCompareRoutes(defaultSample.origin, defaultSample.destination)}
            className="flex items-center gap-1.5 rounded-lg border border-cobalt/40 bg-cobalt/15 px-3 py-1.5 text-xs font-medium text-cobalt transition-all hover:bg-cobalt/25 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Test Sample Commute</span>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Travel mode"
            className="flex items-center gap-1 rounded-xl bg-white/[0.03] p-1 border border-glass"
          >
            {['walking', 'cycling', 'driving'].map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={travelMode === mode}
                onClick={() => setTravelMode(mode)}
                className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  travelMode === mode
                    ? 'bg-cobalt text-white shadow-glowCobalt'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">
              {origin && destination
                ? 'Points A & B locked'
                : origin
                ? 'Click map for Destination (B)'
                : 'Click map for Origin (A)'}
            </span>
            <button
              type="button"
              disabled={loading || !origin || !destination}
              onClick={() => handleCompareRoutes()}
              className="flex items-center gap-1.5 rounded-lg bg-emerald px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-all shadow-glowEmerald hover:bg-emerald/90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Navigation className="h-3.5 w-3.5" />
              <span>{loading ? 'Scoring...' : 'Compare Cleanest Route'}</span>
            </button>
          </div>
        </div>

        <div
          role="region"
          aria-label="Interactive clean air commute route map"
          className="relative mt-4 h-72 w-full overflow-hidden rounded-xl border border-glass"
        >
          <MapContainer
            center={[
              Number.isFinite(coords?.lat) ? coords.lat : 28.6139,
              Number.isFinite(coords?.lon) ? coords.lon : 77.2090,
            ]}
            zoom={13}
            scrollWheelZoom={false}
            className="h-full w-full z-10"
            style={{ background: '#0D0D0F' }}
          >
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapRecenter center={coords} />
            <MapClickHandler onSelectPoint={handleMapClick} />

            {origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lon) && (
              <Marker position={[origin.lat, origin.lon]} icon={originMarkerIcon}>
                <Popup className="text-xs font-sans">
                  <strong>Origin A:</strong> {origin.label || `${origin.lat.toFixed(3)}, ${origin.lon.toFixed(3)}`}
                </Popup>
              </Marker>
            )}

            {destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lon) && (
              <Marker position={[destination.lat, destination.lon]} icon={destMarkerIcon}>
                <Popup className="text-xs font-sans">
                  <strong>Destination B:</strong>{' '}
                  {destination.label || `${destination.lat.toFixed(3)}, ${destination.lon.toFixed(3)}`}
                </Popup>
              </Marker>
            )}

            {routesToRender.map((route, i) => (
              <Polyline
                key={`route-poly-${route.route_id || i}`}
                positions={route.positions}
                pathOptions={{ color: route.color, weight: route.weight, dashArray: route.dashArray, opacity: 0.9 }}
              >
                <Popup className="text-xs font-sans">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">{route.name}</p>
                    <p>Duration: {route.duration_minutes} min</p>
                    <p>LUR PM2.5: {route.effective_pm25} µg/m³</p>
                    <p>Inhaled Dose: {route.inhaled_dose_ug} µg</p>
                  </div>
                </Popup>
              </Polyline>
            ))}
          </MapContainer>
        </div>
      </div>

      <RouteComparisonStrip routesToRender={routesToRender} routingResults={routingResults} error={error} />
    </div>
  );
}
