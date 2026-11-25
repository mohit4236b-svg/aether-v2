import { MapPin, Activity, ShieldCheck, HeartPulse, Baby, Dumbbell, UserCheck } from 'lucide-react';
import CitySearch from './CitySearch';

const PRESETS = [
  { name: 'Delhi', lat: 28.6139, lon: 77.2090, tag: 'Inversion Hotspot' },
  { name: 'Baddi', lat: 30.9578, lon: 76.7914, tag: 'Valley Basin' },
  { name: 'London', lat: 51.5072, lon: -0.1276, tag: 'Maritime' },
  { name: 'Beijing', lat: 39.9042, lon: 116.4074, tag: 'Basin Stagnation' },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, tag: 'Coastal Advection' },
];

const PERSONAS = [
  { id: 'healthy_adult', label: 'Healthy Adult', icon: UserCheck, desc: '15 µg/m³ WHO baseline' },
  { id: 'asthma_copd', label: 'Asthma / COPD', icon: HeartPulse, desc: 'Bronchoconstriction threshold 10 µg/m³' },
  { id: 'child_commute', label: 'Child Commute', icon: Baby, desc: '+35% minute ventilation rate' },
  { id: 'endurance_athlete', label: 'Endurance Athlete', icon: Dumbbell, desc: '+25% minute ventilation, oronasal switch' },
  { id: 'elderly_cardio', label: 'Elderly Cardio', icon: ShieldCheck, desc: 'Cardiovascular susceptibility' },
];

/**
 * Sticky top navigation bar with brand mark, city search, preset pills, and persona selector.
 * @param {{
 *   activeCity: string,
 *   onSelectCity: (city: { name: string, lat: number, lon: number }) => void,
 *   activePersona: string,
 *   onSelectPersona: (personaId: string) => void,
 * }} props
 */
export default function TopBar({ activeCity, onSelectCity, activePersona, onSelectPersona }) {
  return (
    <header className="sticky top-0 z-40 border-b border-glass bg-[#0D0D0F]/80 backdrop-blur-glass transition-colors">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt/15 border border-cobalt/30 text-cobalt">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold tracking-tight text-white">Aether</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono tracking-wider text-slate-300">
                  v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Clinical Atmospheric Health & Smog Navigation</p>
            </div>
          </div>

          <CitySearch onSelectCity={onSelectCity} />

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 mr-1 hidden lg:inline">Presets:</span>
            {PRESETS.map((preset) => {
              const isActive = activeCity.toLowerCase() === preset.name.toLowerCase();
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onSelectCity(preset)}
                  aria-pressed={isActive}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isActive
                      ? 'bg-cobalt text-white shadow-glowCobalt'
                      : 'border border-glass bg-surface text-slate-300 hover:border-glassHover hover:bg-surfaceHover hover:text-white'
                  }`}
                >
                  <MapPin className="h-3 w-3" />
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-glass/40 pt-2.5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mr-1 shrink-0">
              Clinical Persona:
            </span>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Clinical persona selector">
              {PERSONAS.map((p) => {
                const Icon = p.icon;
                const isSelected = activePersona === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => onSelectPersona(p.id)}
                    title={p.desc}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isSelected
                        ? 'border-cobalt/60 bg-cobalt/15 text-white shadow-sm ring-1 ring-cobalt/40'
                        : 'border-glass bg-surface text-slate-300 hover:border-glassHover hover:bg-surfaceHover hover:text-white'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-cobalt' : 'text-slate-400'}`} />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
