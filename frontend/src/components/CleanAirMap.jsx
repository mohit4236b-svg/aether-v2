import React, { useState, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  MapPin,
  Route,
  Navigation,
  Compass,
  Sparkles,
  ArrowRight,
  TrendingDown,
  Layers,
  Zap,
} from 'lucide-react';
import { compareRoutes } from '../lib/api';

const SAMPLE_COMMUTES = {
  delhi: {
    origin: { lat: 28.6139, lon: 77.2090, label: 'Connaught Place' },
    destination: { lat: 28.5355, lon: 77.2600, label: 'South Delhi Arterial' },
  },
  baddi: {
    origin: { lat: 30.9578, lon: 76.7914, label: 'Baddi Industrial Area' },
    destination: { lat: 30.9300, lon: 76.8400, label: 'Nalagarh Road' },
  },
  london: {
    origin: { lat: 51.5072, lon: -0.1276, label: 'Trafalgar Square' },
    destination: { lat: 51.5150, lon: -0.0900, label: 'City of London' },
  },
  beijing: {
    origin: { lat: 39.9042, lon: 116.4074, label: 'Tiananmen Core' },
    destination: { lat: 39.9400, lon: 116.4400, label: 'Chaoyang Arterial' },
  },
  'san francisco': {
    origin: { lat: 37.7749, lon: -122.4194, label: 'Market Street' },
    destination: { lat: 37.7900, lon: -122.4000, label: 'Financial District' },
  },
};

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
    if (center && center.lat && center.lon) {
      map.setView([center.lat, center.lon], 13);
    }
  }, [center, map]);
  return null;
}

export default function CleanAirMap({ coords, activeCity, atmosphere, activePersona }) {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [travelMode, setTravelMode] = useState('walking');
  const [routingResults, setRoutingResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Set default sample commute for active city
  useEffect(() => {
    const cityKey = (activeCity || '').toLowerCase();
    const sample = SAMPLE_COMMUTES[cityKey] || {
      origin: { lat: coords.lat, lon: coords.lon, label: `${activeCity} Origin` },
      destination: { lat: coords.lat + 0.025, lon: coords.lon + 0.025, label: `${activeCity} Dest` },
    };
    setOrigin(sample.origin);
    setDestination(sample.destination);
    setRoutingResults(null);
  }, [activeCity, coords.lat, coords.lon]);

  // Click map handler: sets A, then B, then resets
  const handleMapClick = (latlng) => {
    if (!origin || (origin && destination)) {
      setOrigin({ lat: latlng.lat, lon: latlng.lng, label: 'Selected Origin (A)' });
      setDestination(null);
      setRoutingResults(null);
    } else {
      setDestination({ lat: latlng.lat, lon: latlng.lng, label: 'Selected Dest (B)' });
    }
  };

  const handleTestSampleCommute = () => {
    const cityKey = (activeCity || '').toLowerCase();
    const sample = SAMPLE_COMMUTES[cityKey] || {
      origin: { lat: coords.lat, lon: coords.lon, label: `${activeCity} Center` },
      destination: { lat: coords.lat + 0.03, lon: coords.lon + 0.03, label: `${activeCity} East` },
    };
    setOrigin(sample.origin);
    setDestination(sample.destination);
    handleCompareRoutes(sample.origin, sample.destination);
  };

  const handleCompareRoutes = async (orig = origin, dest = destination) => {
    if (!orig || !dest) return;
    setLoading(true);
    setError(null);

    const currentPm25 =
      atmosphere?.forecast?.air_quality?.hourly?.pm2_5?.[0] ?? 100.0;

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
      setRoutingResults(res);
    } catch (err) {
      console.error('Route scoring failed:', err);
      setError(err.message || 'Unable to compute clean air route alternatives.');
    } finally {
      setLoading(false);
    }
  };

  // Extract polylines from routing results
  const routesToRender = (routingResults?.routes || []).map((r, idx) => {
    let positions = [];
    if (r.geometry && Array.isArray(r.geometry.coordinates)) {
      positions = r.geometry.coordinates.map((pt) => [pt[1], pt[0]]);
    } else if (origin && destination) {
      // Direct chord fallback if geojson coords unavailable
      positions = [
        [origin.lat, origin.lon],
        [destination.lat, destination.lon],
      ];
    }

    const isCleanest = r.is_cleanest || idx === 0;
    const color = isCleanest ? '#10B981' : idx === 1 ? '#F59E0B' : '#EF4444';
    const weight = isCleanest ? 5 : 3;
    const dashArray = isCleanest ? undefined : '5, 8';

    return {
      ...r,
      positions,
      color,
      weight,
      dashArray,
      isCleanest,
    };
  });

  // Calculate bold savings callout
  const cleanestRoute = routesToRender.find((r) => r.isCleanest);
  const fastestRoute = routesToRender.find((r) => r.is_fastest);

  let savingsBanner = null;
  if (cleanestRoute && fastestRoute) {
    const extraMinutes = Math.max(0, Math.round((cleanestRoute.duration_minutes - fastestRoute.duration_minutes) * 10) / 10);
    const savingsPct = cleanestRoute.savings_pct || routingResults?.max_savings_pct || 0;
    savingsBanner = (
      <div className="flex items-center justify-between rounded-xl border border-emerald/40 bg-emerald/10 p-3 text-xs text-emerald-300">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 shrink-0 text-emerald" />
          <span>
            <strong className="text-white font-semibold">{cleanestRoute.name || 'Cleanest Route'}</strong>
            {extraMinutes > 0 ? ` adds +${extraMinutes} min but ` : ' '}
            cuts cumulative inhaled PM2.5 by <strong className="text-emerald font-bold">{savingsPct}%</strong> vs fastest route.
          </span>
        </div>
        <span className="font-mono text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
          LUR Optimized
        </span>
      </div>
    );
  }

  return (
    <div className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass flex flex-col justify-between">
      <div>
        {/* Header & Controls */}
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

          {/* Quick Test Sample Commute Button for judges */}
          <button
            type="button"
            onClick={handleTestSampleCommute}
            className="flex items-center gap-1.5 rounded-lg border border-cobalt/40 bg-cobalt/15 px-3 py-1.5 text-xs font-medium text-cobalt transition-all hover:bg-cobalt/25 active:scale-[0.97]"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Test Sample Commute</span>
          </button>
        </div>

        {/* Travel Mode Toggle & Action Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-white/[0.03] p-1 border border-glass">
            {['walking', 'cycling', 'driving'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTravelMode(mode)}
                className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition-all active:scale-[0.97] ${
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
              className="flex items-center gap-1.5 rounded-lg bg-emerald px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-all shadow-glowEmerald hover:bg-emerald/90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Navigation className="h-3.5 w-3.5" />
              <span>{loading ? 'Scoring...' : 'Compare Cleanest Route'}</span>
            </button>
          </div>
        </div>

        {/* Leaflet Dark Map Canvas */}
        <div className="relative mt-4 h-72 w-full overflow-hidden rounded-xl border border-glass">
          <MapContainer
            center={[coords.lat, coords.lon]}
            zoom={13}
            scrollWheelZoom={false}
            className="h-full w-full z-10"
            style={{ background: '#0D0D0F' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <MapRecenter center={coords} />
            <MapClickHandler onSelectPoint={handleMapClick} />

            {/* Origin Marker A */}
            {origin && (
              <Marker position={[origin.lat, origin.lon]} icon={originMarkerIcon}>
                <Popup className="text-xs font-sans">
                  <strong>Origin A:</strong> {origin.label || `${origin.lat.toFixed(3)}, ${origin.lon.toFixed(3)}`}
                </Popup>
              </Marker>
            )}

            {/* Destination Marker B */}
            {destination && (
              <Marker position={[destination.lat, destination.lon]} icon={destMarkerIcon}>
                <Popup className="text-xs font-sans">
                  <strong>Destination B:</strong> {destination.label || `${destination.lat.toFixed(3)}, ${destination.lon.toFixed(3)}`}
                </Popup>
              </Marker>
            )}

            {/* Render Route Polylines */}
            {routesToRender.map((route, i) => (
              <Polyline
                key={`route-poly-${route.route_id || i}`}
                positions={route.positions}
                pathOptions={{
                  color: route.color,
                  weight: route.weight,
                  dashArray: route.dashArray,
                  opacity: 0.9,
                }}
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

      {/* Route Comparison Strip Underneath */}
      <div className="mt-4 space-y-3">
        {error && (
          <p className="text-xs text-crimson font-medium bg-crimson/10 border border-crimson/30 rounded-lg p-2.5">
            {error}
          </p>
        )}

        {savingsBanner}

        {routingResults && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {routesToRender.map((r, i) => (
              <div
                key={`strip-${r.route_id || i}`}
                className={`rounded-xl p-3 border text-xs transition-all ${
                  r.isCleanest
                    ? 'border-emerald/40 bg-emerald/10 shadow-sm'
                    : 'border-glass bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-glass/40">
                  <span className="font-semibold text-white">{r.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono uppercase font-medium ${
                      r.isCleanest
                        ? 'bg-emerald text-slate-950'
                        : r.is_fastest
                        ? 'bg-cobalt/20 text-cobalt'
                        : 'bg-white/10 text-slate-400'
                    }`}
                  >
                    {r.isCleanest ? 'Cleanest' : r.is_fastest ? 'Fastest' : 'Alternative'}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Duration</span>
                    <span className="font-mono font-medium text-white tabular-nums">
                      {r.duration_minutes}m
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Effective PM</span>
                    <span className="font-mono font-medium text-slate-200 tabular-nums">
                      {r.effective_pm25}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Inhaled Dose</span>
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        r.isCleanest ? 'text-emerald' : 'text-slate-300'
                      }`}
                    >
                      {r.inhaled_dose_ug}µg
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
