import { useState, useEffect } from 'react';
import { Bot } from 'lucide-react';
import TopBar from './components/TopBar';
import AtmosphereHero from './components/AtmosphereHero';
import TimelineChart from './components/TimelineChart';
import DoseSimulator from './components/DoseSimulator';
import CleanAirMap from './components/CleanAirMap';
import AgentDrawer from './components/AgentDrawer';
import ErrorBoundary from './components/ErrorBoundary';
import ScheduleSection from './components/ScheduleSection';
import { fetchAtmosphere, optimizeSchedule } from './lib/api';

const DEFAULT_TASKS = [
  { name: 'Commute Window', activity: 'walking', duration_minutes: 40, earliest_hour: 7, latest_hour: 10 },
  { name: 'Morning Jog', activity: 'running', duration_minutes: 30, earliest_hour: 6, latest_hour: 9 },
  { name: 'Ventilate Bedroom', activity: 'ventilate_room', duration_minutes: 60, earliest_hour: 11, latest_hour: 15 },
];

/**
 * Main Aether v2 Dashboard orchestrating city state, clinical persona, and live telemetry.
 */
function Dashboard() {
  const [activeCity, setActiveCity] = useState('Delhi');
  const [coords, setCoords] = useState({ lat: 28.6139, lon: 77.2090 });
  const [activePersona, setActivePersona] = useState('healthy_adult');
  const [hasHepa, setHasHepa] = useState(false);
  const [isAgentDrawerOpen, setIsAgentDrawerOpen] = useState(false);

  const [atmosphere, setAtmosphere] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      const lat = Number(coords?.lat);
      const lon = Number(coords?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      setLoading(true);
      setError(null);
      try {
        const data = await fetchAtmosphere(lat, lon, 'healthy_adult', hasHepa);
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
  }, [coords?.lat, coords?.lon, hasHepa]);

  useEffect(() => {
    if (!atmosphere?.forecast) return;
    let isCancelled = false;

    async function loadSchedule() {
      const lat = Number(coords?.lat);
      const lon = Number(coords?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      try {
        const res = await optimizeSchedule({
          tasks: DEFAULT_TASKS,
          lat,
          lon,
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
  }, [atmosphere, activePersona, coords?.lat, coords?.lon]);

  const handleSelectCity = (preset) => {
    if (!preset) return;
    const lat = Number(preset.lat ?? preset.latitude);
    const lon = Number(preset.lon ?? preset.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn('handleSelectCity called with invalid coordinates:', preset);
      return;
    }
    setActiveCity(preset.name || 'Selected City');
    setCoords({ lat, lon });
  };

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-slate-100 flex flex-col font-sans selection:bg-cobalt/30 selection:text-blue-200">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-cobalt focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Skip to main content
      </a>

      <TopBar
        activeCity={activeCity}
        onSelectCity={handleSelectCity}
        activePersona={activePersona}
        onSelectPersona={setActivePersona}
      />

      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 space-y-6"
      >
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-crimson/40 bg-crimson/10 p-4 text-xs text-rose-200 backdrop-blur-md"
          >
            <p className="font-semibold text-crimson">Atmospheric Data Error</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        <AtmosphereHero
          atmosphere={atmosphere}
          activePersona={activePersona}
          hasHepa={hasHepa}
          onToggleHepa={() => setHasHepa((prev) => !prev)}
          loading={loading}
        />

        <TimelineChart atmosphere={atmosphere} loading={loading} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6 flex flex-col">
            <DoseSimulator atmosphere={atmosphere} activePersona={activePersona} />
          </div>
          <div className="lg:col-span-6 flex flex-col">
            <CleanAirMap
              coords={coords}
              activeCity={activeCity}
              atmosphere={atmosphere}
              activePersona={activePersona}
            />
          </div>
        </div>

        <ScheduleSection
          scheduleData={scheduleData}
          onOpenDrawer={() => setIsAgentDrawerOpen(true)}
        />
      </main>

      <button
        type="button"
        onClick={() => setIsAgentDrawerOpen(true)}
        aria-label="Open Aether Co-Pilot"
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-cobalt/40 bg-cobalt px-4 py-2.5 text-xs font-semibold text-white shadow-glowCobalt transition-all hover:bg-cobalt/90 active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Bot className="h-4 w-4" />
        <span>Aether Co-Pilot</span>
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
      </button>

      <AgentDrawer
        isOpen={isAgentDrawerOpen}
        onClose={() => setIsAgentDrawerOpen(false)}
        activeCity={activeCity}
        coords={coords}
        activePersona={activePersona}
      />

      <footer className="mt-auto border-t border-glass py-4 text-center text-xs text-slate-500">
        <p>Aether v2.0 · Clinical Atmospheric Intelligence · Open-Meteo CAMS, ECMWF IFS HRES & OpenRouteService</p>
      </footer>
    </div>
  );
}

/**
 * Root application component wrapped in ErrorBoundary.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}
