import React, { useState, useMemo } from 'react';
import {
  Activity,
  Shield,
  Clock,
  Cigarette,
  AlertCircle,
  Sparkles,
  Info,
  CheckCircle2,
  Wind,
} from 'lucide-react';

const BASELINE_VENTILATION = {
  resting: 0.48,
  walking: 1.20,
  cycling: 2.70,
  running: 3.20,
};

const PERSONA_PROFILES = {
  healthy_adult: { ve_mult: 1.0, who_pm25_24h: 15.0 },
  asthma_copd: { ve_mult: 1.0, who_pm25_24h: 10.0 },
  child_commute: { ve_mult: 1.35, who_pm25_24h: 10.0 },
  endurance_athlete: { ve_mult: 1.25, who_pm25_24h: 15.0 },
  elderly_cardio: { ve_mult: 0.95, who_pm25_24h: 10.0 },
};

const MASK_EFFICIENCY = {
  none: 0.0,
  cloth: 0.30,
  surgical: 0.65,
  n95: 0.95,
};

const FIT_FACTOR = {
  sealed: 1.0,
  loose: 0.72,
};

export default function DoseSimulator({ atmosphere, activePersona }) {
  const [activity, setActivity] = useState('walking');
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [mask, setMask] = useState('none');
  const [maskFit, setMaskFit] = useState('sealed');
  const [departureHour, setDepartureHour] = useState(8);

  // Extract hourly PM2.5 from atmosphere forecast or default to 100 µg/m³
  const hourlyPm25 = useMemo(() => {
    const series = atmosphere?.forecast?.air_quality?.hourly?.pm2_5;
    if (Array.isArray(series) && series.length > 0) {
      return series.map((v) => (v != null ? Number(v) : 50.0));
    }
    return Array(24).fill(100.0);
  }, [atmosphere]);

  const activePm25 = hourlyPm25[departureHour] ?? 100.0;

  // Real-time client-side calculation matching dose_engine.py verbatim
  const doseCalculation = useMemo(() => {
    const personaCfg = PERSONA_PROFILES[activePersona] || PERSONA_PROFILES.healthy_adult;
    const baseVe = BASELINE_VENTILATION[activity] || 1.20;
    const veEffective = baseVe * personaCfg.ve_mult;

    // Oronasal breathing switch: >= 2.1 m³/hr (35 L/min)
    const isOronasal = veEffective >= 2.1;
    const breathingMode = isOronasal ? 'oronasal' : 'nasal';
    const depositionFraction = isOronasal ? 0.65 : 0.45;

    const eMask = MASK_EFFICIENCY[mask] || 0.0;
    const fFit = FIT_FACTOR[maskFit] || 1.0;
    const effectiveMask = eMask * fFit;

    const durationHours = durationMinutes / 60.0;

    // Inhaled dose: pm25 * V_E * hours * (1 - mask)
    const inhaledDoseUg = activePm25 * veEffective * durationHours * (1.0 - effectiveMask);

    // Alveolar deposited dose: inhaled * DF
    const depositedDoseUg = inhaledDoseUg * depositionFraction;

    // WHO Daily reference intake: who_pm25 * 0.48 * 24h
    const whoDailyBudgetUg = personaCfg.who_pm25_24h * 0.48 * 24.0;
    const whoBudgetPct = Math.round((inhaledDoseUg / whoDailyBudgetUg) * 1000) / 10;

    // Berkeley Earth rule of thumb: 1 cigarette = 22 µg/m³ for 24h (528 µg/day inhaled)
    const cigaretteEquivalent =
      Math.round(((activePm25 * (1.0 - effectiveMask) * durationHours) / (22.0 * 24.0)) * 1000) / 1000;

    return {
      veEffective: Math.round(veEffective * 100) / 100,
      breathingMode,
      isOronasal,
      depositionFraction,
      effectiveMask: Math.round(effectiveMask * 100),
      inhaledDoseUg: Math.round(inhaledDoseUg * 10) / 10,
      depositedDoseUg: Math.round(depositedDoseUg * 10) / 10,
      whoBudgetPct,
      cigaretteEquivalent,
    };
  }, [activity, durationMinutes, mask, maskFit, departureHour, activePm25, activePersona]);

  // Formatted departure time string
  const departureTimeStr = `${String(departureHour).padStart(2, '0')}:00`;

  return (
    <div className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass flex flex-col justify-between">
      <div>
        {/* Header & Breathing Mode Badge */}
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

          {/* Oronasal Switch Indicator */}
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

        {/* 4 Interactive Control Sliders/Selectors */}
        <div className="mt-5 space-y-4">
          {/* 1. Activity Segmented Control */}
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
                  className={`rounded-lg py-1.5 text-xs font-medium capitalize transition-all active:scale-[0.97] ${
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

          {/* 2. Duration Slider */}
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
              className="w-full accent-cobalt cursor-pointer bg-white/10 rounded-lg h-2"
            />
          </div>

          {/* 3. Mask Selection & Fit Factor Toggle */}
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
                    className={`rounded-lg py-1 text-xs font-medium capitalize transition-all active:scale-[0.97] ${
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
                    className={`rounded-lg py-1 text-xs font-medium capitalize transition-all active:scale-[0.97] ${
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

          {/* 4. Departure Hour Slider using live 24h PM2.5 */}
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
              className="w-full accent-cobalt cursor-pointer bg-white/10 rounded-lg h-2"
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

      {/* 4 Crisp Monospace Readouts */}
      <div className="mt-6 border-t border-glass pt-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {/* Readout 1: Inhaled Dose */}
          <div className="rounded-xl bg-white/[0.02] border border-glass p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Inhaled Dose</span>
            <span className="font-mono text-xl font-bold text-white tabular-nums mt-1 block">
              {doseCalculation.inhaledDoseUg}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">µg PM2.5</span>
          </div>

          {/* Readout 2: Alveolar Deposited */}
          <div className="rounded-xl bg-white/[0.02] border border-glass p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Alveolar Deposited</span>
            <span className="font-mono text-xl font-bold text-amber tabular-nums mt-1 block">
              {doseCalculation.depositedDoseUg}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">µg Deep Lung</span>
          </div>

          {/* Readout 3: WHO Daily Budget % */}
          <div className="rounded-xl bg-white/[0.02] border border-glass p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">WHO 24h Budget</span>
            <span
              className={`font-mono text-xl font-bold tabular-nums mt-1 block ${
                doseCalculation.whoBudgetPct > 100
                  ? 'text-crimson'
                  : doseCalculation.whoBudgetPct > 50
                  ? 'text-amber'
                  : 'text-emerald'
              }`}
            >
              {doseCalculation.whoBudgetPct}%
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Intake Consumed</span>
          </div>

          {/* Readout 4: Cigarette Equivalent */}
          <div className="rounded-xl bg-white/[0.02] border border-glass p-3 relative group">
            <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
              <span>Cigarette Equiv</span>
              <Info className="h-3 w-3 text-slate-500" />
            </div>
            <span className="font-mono text-xl font-bold text-rose-300 tabular-nums mt-1 block">
              {doseCalculation.cigaretteEquivalent}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Smoked Equivalent</span>

            {/* Berkeley Earth Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg border border-glass bg-[#18181C] p-2 text-[10px] text-slate-300 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
              Berkeley Earth model: 1 cigarette ≈ 22 µg/m³ for 24h exposure (528 µg PM2.5 inhaled).
            </div>
          </div>
        </div>

        {/* Animated WHO Budget Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1 text-slate-400">
            <span>WHO 2021 Reference Budget (15 µg/m³ 24h)</span>
            <span className="font-mono font-medium text-white">{doseCalculation.whoBudgetPct}% consumed</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06] border border-glass/40">
            <div
              className={`h-full transition-all duration-300 ${
                doseCalculation.whoBudgetPct > 100
                  ? 'bg-crimson shadow-glowCrimson'
                  : doseCalculation.whoBudgetPct > 50
                  ? 'bg-amber shadow-glowAmber'
                  : 'bg-emerald shadow-glowEmerald'
              }`}
              style={{ width: `${Math.min(100, doseCalculation.whoBudgetPct)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
