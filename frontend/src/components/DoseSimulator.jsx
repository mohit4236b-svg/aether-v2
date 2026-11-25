import { useState, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { calculateDose } from '../lib/physics';
import DoseReadouts from './DoseReadouts';

/**
 * Interactive Respiratory Dose Simulator computing inhaled and alveolar-deposited PM2.5.
 * @param {{
 *   atmosphere: { forecast?: { air_quality?: { hourly?: { pm2_5?: Array<number|null> } } } } | null,
 *   activePersona: string,
 * }} props
 */
export default function DoseSimulator({ atmosphere, activePersona }) {
  const [activity, setActivity] = useState('walking');
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [mask, setMask] = useState('none');
  const [maskFit, setMaskFit] = useState('sealed');
  const [departureHour, setDepartureHour] = useState(8);

  const hourlyPm25 = useMemo(() => {
    const series = atmosphere?.forecast?.air_quality?.hourly?.pm2_5;
    if (Array.isArray(series) && series.length > 0) {
      return series.map((v) => (v != null ? Number(v) : 50.0));
    }
    return Array(24).fill(100.0);
  }, [atmosphere]);

  const activePm25 = hourlyPm25[departureHour] ?? 100.0;

  const doseCalculation = useMemo(
    () =>
      calculateDose({
        pm25: activePm25,
        activity,
        durationMinutes,
        mask,
        maskFit,
        persona: activePersona,
      }),
    [activity, durationMinutes, mask, maskFit, activePm25, activePersona]
  );

  const departureTimeStr = `${String(departureHour).padStart(2, '0')}:00`;

  return (
    <div className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass flex flex-col justify-between">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-glass pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt/15 border border-cobalt/30 text-cobalt">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Respiratory Dose Simulator</h3>
              <p className="text-[11px] text-slate-400">Clinical particulate inhalation & alveolar deposition</p>
            </div>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-mono font-medium border ${
              doseCalculation.isOronasal
                ? 'bg-crimson/15 text-crimson border-crimson/30'
                : 'bg-emerald/15 text-emerald border-emerald/30'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>
              {doseCalculation.isOronasal ? 'Oronasal Switch (>35 L/min)' : 'Nasal Breathing (DF 45%)'}
            </span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-medium">Physical Activity:</span>
              <span className="font-mono text-slate-300 text-[11px]">
                V_E = {doseCalculation.veEffective} m³/hr
              </span>
            </div>
            <div
              role="tablist"
              aria-label="Physical activity level"
              className="grid grid-cols-4 gap-1.5 rounded-xl bg-white/[0.03] p-1 border border-glass"
            >
              {['resting', 'walking', 'cycling', 'running'].map((act) => (
                <button
                  key={act}
                  type="button"
                  role="tab"
                  aria-selected={activity === act}
                  onClick={() => setActivity(act)}
                  className={`rounded-lg py-1.5 text-xs font-medium capitalize transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    activity === act
                      ? 'bg-cobalt text-white shadow-glowCobalt'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {act}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label htmlFor="dose-duration-slider" className="text-slate-400 font-medium">
                Exertion Duration:
              </label>
              <span className="font-mono text-white font-semibold text-xs tabular-nums">
                {durationMinutes} minutes ({Math.round((durationMinutes / 60) * 10) / 10}h)
              </span>
            </div>
            <input
              id="dose-duration-slider"
              type="range"
              min={10}
              max={120}
              step={5}
              value={durationMinutes}
              aria-valuetext={`${durationMinutes} minutes`}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full accent-cobalt cursor-pointer bg-white/10 rounded-lg h-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-slate-400 font-medium block mb-1.5">Mask Filtration:</span>
              <div
                role="tablist"
                aria-label="Mask filtration type"
                className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.03] p-1 border border-glass"
              >
                {['none', 'cloth', 'surgical', 'n95'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mask === m}
                    onClick={() => setMask(m)}
                    className={`rounded-lg py-1 text-xs font-medium capitalize transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      mask === m
                        ? 'bg-cobalt text-white shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-400 font-medium block mb-1.5">Mask Fit Quality:</span>
              <div
                role="tablist"
                aria-label="Mask fit quality"
                className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.03] p-1 border border-glass"
              >
                {['sealed', 'loose'].map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    role="tab"
                    aria-selected={maskFit === fit}
                    disabled={mask === 'none'}
                    onClick={() => setMaskFit(fit)}
                    className={`rounded-lg py-1 text-xs font-medium capitalize transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      mask === 'none'
                        ? 'text-slate-600 cursor-not-allowed'
                        : maskFit === fit
                        ? 'bg-cobalt text-white shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {fit} ({fit === 'sealed' ? '100%' : '72%'})
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label htmlFor="dose-departure-slider" className="text-slate-400 font-medium">
                Departure Hour (24h Diurnal Forecast):
              </label>
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-white font-semibold">{departureTimeStr}</span>
                <span className="text-slate-500">•</span>
                <span className="text-cobalt font-semibold tabular-nums">{activePm25.toFixed(1)} µg/m³</span>
              </div>
            </div>
            <input
              id="dose-departure-slider"
              type="range"
              min={0}
              max={23}
              step={1}
              value={departureHour}
              aria-valuetext={`${departureTimeStr}, ${activePm25.toFixed(1)} micrograms per cubic meter PM2.5`}
              onChange={(e) => setDepartureHour(Number(e.target.value))}
              className="w-full accent-cobalt cursor-pointer bg-white/10 rounded-lg h-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
              <span>00:00</span>
              <span>06:00 (Rush)</span>
              <span>12:00 (Midday)</span>
              <span>18:00 (Evening)</span>
              <span>23:00</span>
            </div>
          </div>
        </div>
      </div>

      <DoseReadouts doseCalculation={doseCalculation} />
    </div>
  );
}
