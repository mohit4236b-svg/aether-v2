import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const pm25 = payload.find((p) => p.dataKey === 'pm25')?.value ?? 0;
  const blh = payload.find((p) => p.dataKey === 'blh')?.value ?? 0;
  const wind = payload[0]?.payload?.wind ?? 8.0;

  const vi = Math.round(blh * (wind / 3.6));
  let status = 'Dispersed';
  let statusColor = 'text-emerald border-emerald/30 bg-emerald/10';
  if (vi < 1200) {
    status = 'Trapped';
    statusColor = 'text-crimson border-crimson/30 bg-crimson/10';
  } else if (vi <= 3000) {
    status = 'Lifting';
    statusColor = 'text-amber border-amber/30 bg-amber/10';
  }

  return (
    <div className="glass-surface rounded-xl p-3 shadow-2xl backdrop-blur-2xl border border-glass text-xs space-y-1.5 min-w-[180px]">
      <div className="flex items-center justify-between border-b border-glass pb-1 text-slate-300">
        <span className="font-mono font-semibold text-white">{label}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${statusColor}`}>
          {status}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">PM2.5:</span>
        <span className="font-mono font-bold text-cobalt tabular-nums">{pm25.toFixed(1)} µg/m³</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">BLH Height:</span>
        <span className="font-mono text-slate-200 tabular-nums">{Math.round(blh)} m</span>
      </div>
      <div className="flex items-center justify-between border-t border-glass/40 pt-1 text-[11px]">
        <span className="text-slate-400">Ventilation Index:</span>
        <span className="font-mono font-medium text-white tabular-nums">{vi} m²/s</span>
      </div>
    </div>
  );
}

export default function TimelineChart({ atmosphere, loading }) {
  if (loading || !atmosphere) {
    return <div className="glass-surface h-72 rounded-2xl animate-pulse" />;
  }

  const aqHourly = atmosphere.forecast?.air_quality?.hourly || {};
  const weatherHourly = atmosphere.forecast?.weather?.hourly || {};

  const times = aqHourly.time || [];
  const pm25List = aqHourly.pm2_5 || [];
  const blhList = weatherHourly.boundary_layer_height || [];
  const windList = weatherHourly.wind_speed_10m || [];

  // Assemble 24-hour data points
  const chartData = times.slice(0, 24).map((t, idx) => {
    let formattedHour = `${idx}:00`;
    if (t.includes('T')) {
      formattedHour = t.split('T')[1].slice(0, 5);
    } else if (t.includes(':')) {
      formattedHour = t.slice(0, 5);
    }

    return {
      time: formattedHour,
      pm25: Number(pm25List[idx] ?? 0),
      blh: Number(blhList[idx] ?? 500),
      wind: Number(windList[idx] ?? 8.0),
    };
  });

  return (
    <div className="glass-surface rounded-2xl p-5 border border-glass">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-white">
            24-Hour Diurnal Atmosphere & Boundary Layer Dynamics
          </h3>
          <p className="text-xs text-slate-400">
            Real-time CAMS particulate concentration vs ECMWF atmospheric boundary layer mixing height
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cobalt" />
            <span className="text-slate-300">PM2.5 (µg/m³)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-slate-400 border-t border-dashed border-slate-400" />
            <span className="text-slate-400">BLH Height (m)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-emerald-500" />
            <span className="text-emerald-400">WHO 15 µg/m³ Guideline</span>
          </div>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="pm25Gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#64748B"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255, 255, 255, 0.08)' }}
            />
            <YAxis
              yAxisId="left"
              stroke="#64748B"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#64748B"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}m`}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* WHO Guideline Reference Line */}
            <ReferenceLine
              yAxisId="left"
              y={15}
              stroke="#10B981"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="pm25"
              stroke="#3B82F6"
              strokeWidth={2}
              fill="url(#pm25Gradient)"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="blh"
              stroke="#94A3B8"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
