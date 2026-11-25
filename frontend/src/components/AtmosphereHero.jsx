import React from 'react';
import {
  Wind,
  ShieldAlert,
  AlertTriangle,
  Clock,
  Layers,
  Sparkles,
  Home,
  CheckCircle2,
  Info,
} from 'lucide-react';

function calculateAqi(pm25) {
  if (pm25 == null || isNaN(pm25)) return { aqi: 0, label: 'Unknown', color: 'slate' };
  const val = Number(pm25);
  if (val <= 12.0) {
    return { aqi: Math.round((50 / 12.0) * val), label: 'Good', color: 'emerald' };
  } else if (val <= 35.4) {
    return {
      aqi: Math.round(((100 - 51) / (35.4 - 12.1)) * (val - 12.1) + 51),
      label: 'Moderate',
      color: 'amber',
    };
  } else if (val <= 55.4) {
    return {
      aqi: Math.round(((150 - 101) / (55.4 - 35.5)) * (val - 35.5) + 101),
      label: 'Sensitive Groups',
      color: 'amber',
    };
  } else if (val <= 150.4) {
    return {
      aqi: Math.round(((200 - 151) / (150.4 - 55.5)) * (val - 55.5) + 151),
      label: 'Unhealthy',
      color: 'crimson',
    };
  } else if (val <= 250.4) {
    return {
      aqi: Math.round(((300 - 201) / (250.4 - 150.5)) * (val - 150.5) + 201),
      label: 'Very Unhealthy',
      color: 'crimson',
    };
  } else {
    return {
      aqi: Math.min(500, Math.round(((500 - 301) / (500.0 - 250.5)) * (val - 250.5) + 301)),
      label: 'Hazardous',
      color: 'crimson',
    };
  }
}

function formatReadableTime(isoStr) {
  if (!isoStr) return null;
  try {
    const timePart = isoStr.includes('T') ? isoStr.split('T')[1].slice(0, 5) : isoStr;
    const [hStr, mStr] = timePart.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr || '00';
    if (isNaN(h)) return isoStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  } catch (e) {
    return isoStr;
  }
}

export default function AtmosphereHero({
  atmosphere,
  activePersona,
  hasHepa,
  onToggleHepa,
  loading,
}) {
  if (loading || !atmosphere) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 animate-pulse">
        <div className="glass-surface h-52 rounded-2xl lg:col-span-4" />
        <div className="glass-surface h-52 rounded-2xl lg:col-span-4" />
        <div className="glass-surface h-52 rounded-2xl lg:col-span-4" />
      </div>
    );
  }

  const { forecast, inversion, openaq_calibration, ventilation_window, current_index } = atmosphere;
  const aqHourly = forecast?.air_quality?.hourly || {};
  const weatherHourly = forecast?.weather?.hourly || {};

  const curIdx = current_index ?? 0;
  const currentPm25 = aqHourly.pm2_5?.[curIdx] ?? aqHourly.pm2_5?.[0] ?? 0;
  const currentNo2 = aqHourly.nitrogen_dioxide?.[curIdx] ?? aqHourly.nitrogen_dioxide?.[0] ?? 0;
  const currentO3 = aqHourly.ozone?.[curIdx] ?? aqHourly.ozone?.[0] ?? 0;
  const currentBlh = weatherHourly.boundary_layer_height?.[curIdx] ?? weatherHourly.boundary_layer_height?.[0] ?? 0;
  const currentWind = weatherHourly.wind_speed_10m?.[curIdx] ?? weatherHourly.wind_speed_10m?.[0] ?? 0;

  const aqiInfo = calculateAqi(currentPm25);

  // Inversion Status styling
  const invStatus = inversion?.status || 'trapped';
  const viVal = inversion?.ventilation_index_m2_s ?? (currentBlh * (currentWind / 3.6));
  const liftHour = formatReadableTime(inversion?.lift_hour_iso);
  const displayExplanation = inversion?.explanation?.replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g, (m) => {
    return formatReadableTime(m) || m;
  });

  // OpenAQ Calibration
  const isCalibrated = openaq_calibration?.available === true;
  const delta = openaq_calibration?.calibration_delta_ug_m3;
  const groundPm25 = openaq_calibration?.ground_pm25_ug_m3;

  // Persona Alerts
  const personaThresholds = {
    healthy_adult: { no2: 40, o3: 100, pm25: 15 },
    asthma_copd: { no2: 25, o3: 80, pm25: 10 },
    child_commute: { no2: 25, o3: 85, pm25: 10 },
    endurance_athlete: { no2: 35, o3: 95, pm25: 15 },
    elderly_cardio: { no2: 30, o3: 90, pm25: 10 },
  };
  const activeThresh = personaThresholds[activePersona] || personaThresholds.healthy_adult;

  const triggeredAlerts = [];
  if (currentNo2 > activeThresh.no2) {
    triggeredAlerts.push({
      type: 'NO2',
      val: currentNo2,
      thresh: activeThresh.no2,
      msg: `NO2 (${currentNo2.toFixed(1)} µg/m³) exceeds clinical safety threshold (${activeThresh.no2} µg/m³): High risk of airway hyperresponsiveness and bronchoconstriction.`,
    });
  }
  if (currentO3 > activeThresh.o3) {
    triggeredAlerts.push({
      type: 'O3',
      val: currentO3,
      thresh: activeThresh.o3,
      msg: `O3 (${currentO3.toFixed(1)} µg/m³) exceeds clinical safety threshold (${activeThresh.o3} µg/m³): Risk of oxidative airway epithelial irritation.`,
    });
  }
  if (currentPm25 > activeThresh.pm25 * 3) {
    triggeredAlerts.push({
      type: 'PM2.5',
      val: currentPm25,
      thresh: activeThresh.pm25,
      msg: `PM2.5 (${currentPm25.toFixed(1)} µg/m³) is substantially elevated relative to active persona threshold (${activeThresh.pm25} µg/m³). Avoid strenuous outdoor exertion.`,
    });
  }

  return (
    <div className="space-y-4">
      {/* High-Priority Clinical Alert Banner if thresholds breached */}
      {triggeredAlerts.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-xl border border-crimson/30 bg-crimson/10 p-3.5 text-xs text-rose-200 backdrop-blur-md"
        >
          {triggeredAlerts.map((alt, idx) => (
            <div key={idx} className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-crimson" />
              <div>
                <span className="font-semibold uppercase tracking-wider text-crimson mr-1.5">
                  [{alt.type} Clinical Alert]
                </span>
                <span>{alt.msg}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3 Core Hero Cards Grid */}
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

          {/* Sub-pollutants breakdown */}
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

          {/* OpenAQ Ground Truth Badge */}
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

          {/* Meteorological Metrics */}
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

          {/* Clinical summary */}
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
                  {formatReadableTime(ventilation_window?.best_start_hour_iso) || '1:00 PM'}
                </span>
                <span className="text-xs font-medium text-slate-400">Optimal 1h Window</span>
              </div>
            </div>

            {/* HEPA filter toggle */}
            <button
              type="button"
              onClick={onToggleHepa}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] ${
                hasHepa
                  ? 'border-emerald/40 bg-emerald/15 text-emerald'
                  : 'border-glass bg-surface text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>HEPA {hasHepa ? 'Active' : 'Off'}</span>
            </button>
          </div>

          {/* Infiltration Comparison */}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-glass pt-3">
            <div className="rounded-lg bg-white/[0.02] p-2 border border-glass/30">
              <p className="text-[10px] text-slate-400">Closed Envelope</p>
              <p className="font-mono text-sm font-semibold text-emerald tabular-nums">
                {ventilation_window?.indoor_pm25_closed ?? 0} <span className="text-[10px] font-normal text-slate-400">µg/m³</span>
              </p>
            </div>
            <div className="rounded-lg bg-white/[0.02] p-2 border border-glass/30">
              <p className="text-[10px] text-slate-400">Window Open</p>
              <p className="font-mono text-sm font-semibold text-amber tabular-nums">
                {ventilation_window?.indoor_pm25_open ?? 0} <span className="text-[10px] font-normal text-slate-400">µg/m³</span>
              </p>
            </div>
          </div>

          {/* Actionable recommendation */}
          <div className="mt-3 rounded-lg bg-white/[0.02] p-2 text-[11px] leading-relaxed text-slate-300 border border-glass/40">
            {ventilation_window?.recommendation || 'Awaiting atmospheric forecast...'}
          </div>
        </div>
      </div>
    </div>
  );
}
