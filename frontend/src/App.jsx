import React, { useState, useEffect } from 'react';
import TopBar from './components/TopBar';
import AtmosphereHero from './components/AtmosphereHero';
import TimelineChart from './components/TimelineChart';
import DoseSimulator from './components/DoseSimulator';
import CleanAirMap from './components/CleanAirMap';
import AgentDrawer from './components/AgentDrawer';
import { fetchAtmosphere, optimizeSchedule } from './lib/api';
import {
  Calendar,
  Bot,
  Sparkles,
} from 'lucide-react';

const DEFAULT_TASKS = [
  { name: 'Commute Window', activity: 'walking', duration_minutes: 40, earliest_hour: 7, latest_hour: 10 },
  { name: 'Morning Jog', activity: 'running', duration_minutes: 30, earliest_hour: 6, latest_hour: 9 },
  { name: 'Ventilate Bedroom', activity: 'ventilate_room', duration_minutes: 60, earliest_hour: 11, latest_hour: 15 },
];

export default function App() {
  const [activeCity, setActiveCity] = useState('Delhi');
  const [coords, setCoords] = useState({ lat: 28.6139, lon: 77.2090 });
  const [activePersona, setActivePersona] = useState('healthy_adult');
  const [hasHepa, setHasHepa] = useState(false);
  const [isAgentDrawerOpen, setIsAgentDrawerOpen] = useState(false);

  const [atmosphere, setAtmosphere] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);

  // Load atmospheric state ONLY whenever coordinates change (0 ms lag on persona switch)
  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAtmosphere(coords.lat, coords.lon, 'healthy_adult', hasHepa);
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
  }, [coords.lat, coords.lon, hasHepa]);

  // Compute live conflict-free schedule whenever atmosphere or persona changes
  useEffect(() => {
    if (!atmosphere?.forecast) return;
    let isCancelled = false;

    async function loadSchedule() {
      try {
        const res = await optimizeSchedule({
          tasks: DEFAULT_TASKS,
          lat: coords.lat,
          lon: coords.lon,
          persona: activePersona,
          forecast: atmosphere.forecast,
        });
        if (!isCancelled) {
          setScheduleData(res);
        }
      } catch (err) {
        console.warn('Live schedule optimization warning:', err);
      }
    }

    loadSchedule();

    return () => {
      isCancelled = true;
    };
  }, [atmosphere, activePersona, coords.lat, coords.lon]);

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

        {/* Section 3: 12-Column Responsive Grid (DoseSimulator & CleanAirMap) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Dose Simulator Component */}
          <div className="lg:col-span-6 flex flex-col">
            <DoseSimulator atmosphere={atmosphere} activePersona={activePersona} />
          </div>

          {/* Clean Air Map Component */}
          <div className="lg:col-span-6 flex flex-col">
            <CleanAirMap
              coords={coords}
              activeCity={activeCity}
              atmosphere={atmosphere}
              activePersona={activePersona}
            />
          </div>
        </div>

        {/* Section 4: 24h Conflict-Free Schedule Optimizer Slot */}
        <div className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-glass">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber" />
              <h3 className="text-sm font-semibold text-white tracking-tight">
                24-Hour Conflict-Free Schedule Optimizer
              </h3>
              {scheduleData && (
                <span className="rounded-full bg-emerald/15 text-emerald border border-emerald/30 px-2 py-0.5 text-[10px] font-mono font-medium">
                  {scheduleData.total_savings_pct.toFixed(1)}% Saved ({(scheduleData.baseline_naive_dose_ug - scheduleData.total_optimized_dose_ug).toFixed(1)} µg cut)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsAgentDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1 text-xs font-medium text-amber hover:bg-amber/20 transition-all active:scale-[0.97]"
            >
              <Sparkles className="h-3 w-3" />
              <span>Optimize with Co-Pilot</span>
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Deterministic interval scheduler optimizing commute, outdoor workouts, and room ventilation to minimize
            cumulative PM2.5 dose with zero time collisions.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {scheduleData?.scheduled_tasks?.length ? (
              scheduleData.scheduled_tasks.map((task, idx) => (
                <div key={idx} className="rounded-xl border border-glass bg-white/[0.02] p-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">{task.name}</span>
                      <span className="text-[10px] font-mono text-emerald font-medium">
                        {task.savings_pct.toFixed(0)}% cut
                      </span>
                    </div>
                    <p className="font-mono text-sm font-medium text-white mt-1">
                      {task.start_time} - {task.end_time}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-glass/40 pt-1.5">
                    <span>{task.duration_minutes} min duration</span>
                    <span className="text-slate-300">{task.inhaled_dose_ug.toFixed(1)} µg dose</span>
                  </div>
                </div>
              ))
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Section 5: Glass-Box Agentic Co-Pilot Banner & Trigger */}
        <div
          onClick={() => setIsAgentDrawerOpen(true)}
          className="glass-surface glass-surface-hover rounded-2xl p-4 border border-cobalt/30 bg-cobalt/[0.05] flex flex-wrap items-center justify-between gap-3 cursor-pointer group transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-cobalt/20 border border-cobalt/40 flex items-center justify-center text-cobalt group-hover:scale-105 transition-transform">
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
                Gemini 2.5 Flash + Automatic Groq Failover with 6 real atmospheric tools and full latency traces.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-1.5 text-xs font-semibold text-white shadow-glowCobalt group-hover:bg-cobalt/90 active:scale-[0.97]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Launch Co-Pilot</span>
          </button>
        </div>
      </main>

      {/* Floating Action Button for Co-Pilot */}
      <button
        type="button"
        onClick={() => setIsAgentDrawerOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-cobalt/40 bg-cobalt px-4 py-2.5 text-xs font-semibold text-white shadow-glowCobalt transition-all hover:bg-cobalt/90 active:scale-[0.95]"
      >
        <Bot className="h-4 w-4" />
        <span>Aether Co-Pilot</span>
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
      </button>

      {/* Slide-Over Glass-Box Agent Drawer */}
      <AgentDrawer
        isOpen={isAgentDrawerOpen}
        onClose={() => setIsAgentDrawerOpen(false)}
        activeCity={activeCity}
        coords={coords}
        activePersona={activePersona}
      />

      {/* Footer */}
      <footer className="mt-auto border-t border-glass py-4 text-center text-xs text-slate-500">
        <p>Aether v2.0 · Clinical Atmospheric Intelligence · Open-Meteo CAMS, ECMWF IFS HRES & OpenRouteService</p>
      </footer>
    </div>
  );
}
