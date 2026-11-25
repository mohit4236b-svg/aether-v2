import { TrendingDown } from 'lucide-react';

/** Pre-configured sample commute endpoints for instant demo testing. */
export const SAMPLE_COMMUTES = {
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

/**
 * Renders the LUR route comparison summary banner, error state, and per-route metric cards.
 * @param {{
 *   routesToRender: Array<object>,
 *   routingResults: { max_savings_pct?: number } | null,
 *   error: string | null,
 * }} props
 */
export default function RouteComparisonStrip({ routesToRender, routingResults, error }) {
  const cleanestRoute = routesToRender.find((r) => r.isCleanest);
  const fastestRoute = routesToRender.find((r) => r.is_fastest);

  let savingsBanner = null;
  if (cleanestRoute && fastestRoute) {
    const extraMinutes = Math.max(
      0,
      Math.round((cleanestRoute.duration_minutes - fastestRoute.duration_minutes) * 10) / 10
    );
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
    <div className="mt-4 space-y-3">
      {error && (
        <p role="alert" className="text-xs text-crimson font-medium bg-crimson/10 border border-crimson/30 rounded-lg p-2.5">
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
                r.isCleanest ? 'border-emerald/40 bg-emerald/10 shadow-sm' : 'border-glass bg-white/[0.02]'
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
                  <span className="font-mono font-medium text-white tabular-nums">{r.duration_minutes}m</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Effective PM</span>
                  <span className="font-mono font-medium text-slate-200 tabular-nums">{r.effective_pm25}</span>
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
  );
}
