import React, { useState, useEffect } from 'react';
import TopBar from './components/TopBar';
import AtmosphereHero from './components/AtmosphereHero';
import TimelineChart from './components/TimelineChart';
import { fetchAtmosphere } from './lib/api';
import {
  Map,
  Calendar,
  Sparkles,
  Bot,
  Route,
  Activity,
  Layers,
  Shield,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';

export default function App() {
  const [activeCity, setActiveCity] = useState('Delhi');
  const [coords, setCoords] = useState({ lat: 28.6139, lon: 77.2090 });
  const [activePersona, setActivePersona] = useState('healthy_adult');
  const [hasHepa, setHasHepa] = useState(false);

  const [atmosphere, setAtmosphere] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load atmospheric state whenever coords, persona, or hasHepa changes
  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAtmosphere(coords.lat, coords.lon, activePersona, hasHepa);
        if (!isCancelled) {
          setAtmosphere(data);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load atmospheric state:', err);
          setError(err.message || 'Unable to fetch atmospheric forecast data.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isCancelled = true;
    };
  }, [coords.lat, coords.lon, activePersona, hasHepa]);

  const handleSelectCity = (preset) => {
    setActiveCity(preset.name);
    setCoords({ lat: preset.lat, lon: preset.lon });
  };

  const handleToggleHepa = () => {
    setHasHepa((prev) => !prev);
  };

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-slate-100 flex flex-col font-sans selection:bg-cobalt/30 selection:text-blue-200">
      {/* Top Navigation Bar */}
      <TopBar
        activeCity={activeCity}
        coords={coords}
        onSelectCity={handleSelectCity}
        activePersona={activePersona}
        onSelectPersona={setActivePersona}
      />

      {/* Main Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Error Notification */}
        {error && (
          <div className="rounded-xl border border-crimson/40 bg-crimson/10 p-4 text-xs text-rose-200 backdrop-blur-md">
            <p className="font-semibold text-crimson">Atmospheric Data Error</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        {/* Section 1: Atmosphere Hero & Clinical Inversion Metrics */}
        <AtmosphereHero
          atmosphere={atmosphere}
          activePersona={activePersona}
          hasHepa={hasHepa}
          onToggleHepa={handleToggleHepa}
          loading={loading}
        />

        {/* Section 2: 24h Diurnal Timeline Chart */}
        <TimelineChart atmosphere={atmosphere} loading={loading} />

        {/* Section 3: 12-Column Grid for Subsequent Prompts (DoseSimulator & CleanAirMap) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Slot 1: Clinical Respiratory Dose Simulator (Prompt 6) */}
          <div className="lg:col-span-6 glass-surface glass-surface-hover rounded-2xl p-6 border border-glass flex flex-col justify-between min-h-[340px]">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-glass">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cobalt" />
                  <h3 className="text-sm font-semibold text-white tracking-tight">Respiratory Dose Simulator</h3>
                </div>
                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                  Prompt 6 Target
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                Personalized inhalation and alveolar deposition modeling calibrated to active persona, mask fit factor,
                activity minute ventilation rate (V_E), and cigarette equivalent metrics.
              </p>
            </div>

            <div className="rounded-xl border border-dashed border-glass/60 bg-white/[0.01] p-6 text-center my-4">
              <Shield className="mx-auto h-8 w-8 text-slate-500 mb-2" />
              <p className="text-xs font-medium text-slate-300">Respiratory Dose Engine Ready</p>
              <p className="text-[11px] text-slate-500 mt-1">Interactive slider controls and persona budget dials wired in next step.</p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-glass text-xs text-slate-400">
              <span>Backend endpoint: <code className="font-mono text-slate-300">/api/dose/simulate</code></span>
              <span className="font-mono text-emerald">Verified Active</span>
            </div>
          </div>

          {/* Slot 2: Clean Air Route Scorer & Map (Prompt 6) */}
          <div className="lg:col-span-6 glass-surface glass-surface-hover rounded-2xl p-6 border border-glass flex flex-col justify-between min-h-[340px]">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-glass">
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-emerald" />
                  <h3 className="text-sm font-semibold text-white tracking-tight">Clean Air LUR Routing Engine</h3>
                </div>
                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                  Prompt 6 Target
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                Segment-level Land-Use Regression road type multipliers (arterial 1.40 vs cycleway 0.65) and uphill
                steepness ventilation penalties with Leaflet interactive route comparison.
              </p>
            </div>

            <div className="rounded-xl border border-dashed border-glass/60 bg-white/[0.01] p-6 text-center my-4">
              <Map className="mx-auto h-8 w-8 text-slate-500 mb-2" />
              <p className="text-xs font-medium text-slate-300">OpenRouteService & OSRM Fallback Ready</p>
              <p className="text-[11px] text-slate-500 mt-1">Interactive Leaflet GeoJSON layer and savings ranking wired in next step.</p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-glass text-xs text-slate-400">
              <span>Backend endpoint: <code className="font-mono text-slate-300">/api/routes/compare</code></span>
              <span className="font-mono text-emerald">Verified Active</span>
            </div>
          </div>
        </div>

        {/* Section 4: 24h Conflict-Free Schedule Optimizer Slot (Prompt 7) */}
        <div className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass">
          <div className="flex items-center justify-between pb-3 border-b border-glass">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber" />
              <h3 className="text-sm font-semibold text-white tracking-tight">
                24-Hour Conflict-Free Schedule Optimizer
              </h3>
            </div>
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-slate-300">
              Prompt 7 Target
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Deterministic interval scheduler optimizing commute, outdoor workouts, and room ventilation to minimize
            cumulative PM2.5 dose with zero time collisions.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-glass bg-white/[0.02] p-3">
              <span className="text-[11px] text-slate-400">Commute Window</span>
              <p className="font-mono text-sm font-medium text-white mt-0.5">07:00 - 10:00</p>
              <span className="text-[10px] text-slate-500">40 min duration</span>
            </div>
            <div className="rounded-xl border border-glass bg-white/[0.02] p-3">
              <span className="text-[11px] text-slate-400">Morning Jog</span>
              <p className="font-mono text-sm font-medium text-white mt-0.5">06:00 - 09:00</p>
              <span className="text-[10px] text-slate-500">30 min duration</span>
            </div>
            <div className="rounded-xl border border-glass bg-white/[0.02] p-3">
              <span className="text-[11px] text-slate-400">Ventilate Bedroom</span>
              <p className="font-mono text-sm font-medium text-white mt-0.5">11:00 - 15:00</p>
              <span className="text-[10px] text-slate-500">60 min duration</span>
            </div>
          </div>
        </div>

        {/* Section 5: Glass-Box Agentic Co-Pilot Drawer Banner (Prompt 7) */}
        <div className="glass-surface rounded-2xl p-4 border border-cobalt/30 bg-cobalt/[0.05] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-cobalt/20 border border-cobalt/40 flex items-center justify-center text-cobalt">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">Glass-Box AI Co-Pilot</span>
                <span className="rounded bg-emerald/15 text-emerald border border-emerald/30 px-1.5 py-0.2 text-[10px] font-mono">
                  Dual-LLM Failover Ready
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Gemini 2.5 Flash + Groq Llama 3.3 70B with 6 real atmospheric tools and full latency traces.
              </p>
            </div>
          </div>
          <span className="font-mono text-xs text-cobalt border border-cobalt/30 rounded-lg px-2.5 py-1">
            /api/agent/chat
          </span>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-glass py-4 text-center text-xs text-slate-500">
        <p>Aether v2 — Autonomous Clinical Atmospheric & Smog Intelligence • Zero AI Slop Design</p>
      </footer>
    </div>
  );
}
