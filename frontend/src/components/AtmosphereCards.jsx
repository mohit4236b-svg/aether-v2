import { Sparkles, CheckCircle2, Info } from 'lucide-react';

/**
 * Formats an ISO timestamp or HH:MM string into 12-hour readable time.
 * @param {string | null | undefined} isoStr
 * @returns {string | null}
 */
export function formatReadableTime(isoStr) {
  if (!isoStr) return null;
  try {
    const timePart = isoStr.includes('T') ? isoStr.split('T')[1].slice(0, 5) : isoStr;
    const [hStr, mStr] = timePart.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr || '00';
    if (Number.isNaN(h)) return isoStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  } catch {
    return isoStr;
  }
}

/**
 * Renders the 3 core atmospheric telemetry hero cards: Ambient Air Quality,
 * Boundary Layer Inversion, and Bedroom Ventilation.
 * @param {{
 *   currentPm25: number,
 *   currentNo2: number,
 *   currentO3: number,
 *   currentWind: number,
 *   currentBlh: number,
 *   aqiInfo: { aqi: number, label: string, color: string },
 *   isCalibrated: boolean,
 *   delta: number | null | undefined,
 *   invStatus: string,
 *   viVal: number,
 *   liftHour: string | null,
 *   displayExplanation: string | undefined,
 *   ventilationWindow: object | undefined,
 *   hasHepa: boolean,
 *   onToggleHepa: () => void,
 * }} props
 */
export default function AtmosphereCards({
  currentPm25,
  currentNo2,
  currentO3,
  currentWind,
  currentBlh,
  aqiInfo,
  isCalibrated,
  delta,
  invStatus,
  viVal,
  liftHour,
  displayExplanation,
  ventilationWindow,
  hasHepa,
  onToggleHepa,
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Card 1: Ambient PM2.5 & AQI */}
      <div className="glass-surface glass-surface-hover flex flex-col justify-between rounded-2xl p-5 lg:col-span-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Ambient Air Quality</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold tracking-tight text-white tabular-nums">
                {currentPm25.toFixed(1)}
              </span>
              <span className="text-xs font-medium text-slate-400">µg/m³ PM2.5</span>
            </div>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              aqiInfo.color === 'emerald'
                ? 'bg-emerald/15 text-emerald border border-emerald/30'
                : aqiInfo.color === 'amber'
                ? 'bg-amber/15 text-amber border border-amber/30'
                : 'bg-crimson/15 text-crimson border border-crimson/30'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
            <span>AQI {aqiInfo.aqi} • {aqiInfo.label}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-glass pt-3 text-center">
          <div className="rounded-lg bg-white/[0.02] p-1.5">
            <p className="text-[10px] text-slate-400">NO2</p>
            <p className="font-mono text-xs font-medium text-slate-200 tabular-nums">
              {currentNo2.toFixed(1)} <span className="text-[9px] text-slate-400">µg/m³</span>
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.02] p-1.5">
            <p className="text-[10px] text-slate-400">O3</p>
            <p className="font-mono text-xs font-medium text-slate-200 tabular-nums">
              {currentO3.toFixed(1)} <span className="text-[9px] text-slate-400">µg/m³</span>
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.02] p-1.5">
            <p className="text-[10px] text-slate-400">Wind</p>
            <p className="font-mono text-xs font-medium text-slate-200 tabular-nums">
              {currentWind.toFixed(1)} <span className="text-[9px] text-slate-400">km/h</span>
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-glass/60 pt-2.5 text-[11px]">
          <span className="text-slate-400">Sensor Calibration:</span>
          {isCalibrated ? (
            <span className="flex items-center gap-1 font-mono font-medium text-emerald">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>
                {delta > 0 ? `+${delta.toFixed(1)}` : delta?.toFixed(1)} µg/m³ Ground Sensor
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Info className="h-3.5 w-3.5" />
              <span>Model-only (CAMS 45km)</span>
            </span>
          )}
        </div>
      </div>

      {/* Card 2: Smog Trap & Thermal Inversion Detector */}
      <div className="glass-surface glass-surface-hover flex flex-col justify-between rounded-2xl p-5 lg:col-span-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Boundary Layer Inversion</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold tracking-tight text-white tabular-nums">
                {Math.round(viVal)}
              </span>
              <span className="text-xs font-medium text-slate-400">m²/s Ventilation Index</span>
            </div>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
              invStatus === 'trapped'
                ? 'bg-crimson/15 text-crimson border border-crimson/30 shadow-glowCrimson'
                : invStatus === 'lifting'
                ? 'bg-amber/15 text-amber border border-amber/30 shadow-glowAmber'
                : 'bg-emerald/15 text-emerald border border-emerald/30 shadow-glowEmerald'
            }`}
          >
            {invStatus}
          </span>
        </div>

        <div className="mt-4 space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Boundary Layer Height (BLH):</span>
            <span className="font-mono font-medium text-white tabular-nums">{Math.round(currentBlh)} m</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Atmospheric Clearance Lift:</span>
            <span className="font-mono font-medium text-white">
              {liftHour ? `Projected ~${liftHour}` : 'Persistent Trapping'}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-slate-300 border border-glass/40">
          {displayExplanation ||
            (invStatus === 'trapped'
              ? 'Thermal capping prevents vertical mixing; particulates accumulate at ground level.'
              : 'Turbulent boundary advection facilitates rapid airborne particulate dispersion.')}
        </div>
      </div>

      {/* Card 3: Smart Window Ventilation Window */}
      <div className="glass-surface glass-surface-hover flex flex-col justify-between rounded-2xl p-5 lg:col-span-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Bedroom Ventilation</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tracking-tight text-white">
                {formatReadableTime(ventilationWindow?.best_start_hour_iso) || '1:00 PM'}
              </span>
              <span className="text-xs font-medium text-slate-400">Optimal 1h Window</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleHepa}
            aria-pressed={hasHepa}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              hasHepa
                ? 'border-emerald/40 bg-emerald/15 text-emerald'
                : 'border-glass bg-surface text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            <span>HEPA {hasHepa ? 'Active' : 'Off'}</span>
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-glass pt-3">
          <div className="rounded-lg bg-white/[0.02] p-2 border border-glass/30">
            <p className="text-[10px] text-slate-400">Closed Envelope</p>
            <p className="font-mono text-sm font-semibold text-emerald tabular-nums">
              {ventilationWindow?.indoor_pm25_closed ?? 0}{' '}
              <span className="text-[10px] font-normal text-slate-400">µg/m³</span>
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.02] p-2 border border-glass/30">
            <p className="text-[10px] text-slate-400">Window Open</p>
            <p className="font-mono text-sm font-semibold text-amber tabular-nums">
              {ventilationWindow?.indoor_pm25_open ?? 0}{' '}
              <span className="text-[10px] font-normal text-slate-400">µg/m³</span>
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-white/[0.02] p-2 text-[11px] leading-relaxed text-slate-300 border border-glass/40">
          {ventilationWindow?.recommendation || 'Awaiting atmospheric forecast...'}
        </div>
      </div>
    </div>
  );
}
