import { Info } from 'lucide-react';

/**
 * Displays the 4 respiratory dose metrics and the WHO 24-hour budget progress bar.
 * @param {{
 *   doseCalculation: {
 *     inhaledDoseUg: number,
 *     depositedDoseUg: number,
 *     whoBudgetPct: number,
 *     cigaretteEquivalent: number,
 *   },
 * }} props
 */
export default function DoseReadouts({ doseCalculation }) {
  const { inhaledDoseUg, depositedDoseUg, whoBudgetPct, cigaretteEquivalent } = doseCalculation;

  return (
    <div className="mt-6 border-t border-glass pt-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div className="rounded-xl bg-white/[0.02] border border-glass p-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Inhaled Dose</span>
          <span className="font-mono text-xl font-bold text-white tabular-nums mt-1 block">
            {inhaledDoseUg}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">µg PM2.5</span>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-glass p-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Alveolar Deposited</span>
          <span className="font-mono text-xl font-bold text-amber tabular-nums mt-1 block">
            {depositedDoseUg}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">µg Deep Lung</span>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-glass p-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 block">WHO 24h Budget</span>
          <span
            className={`font-mono text-xl font-bold tabular-nums mt-1 block ${
              whoBudgetPct > 100
                ? 'text-crimson'
                : whoBudgetPct > 50
                ? 'text-amber'
                : 'text-emerald'
            }`}
          >
            {whoBudgetPct}%
          </span>
          <span className="text-[10px] text-slate-500 font-mono">Intake Consumed</span>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-glass p-3 relative group">
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <span>Cigarette Equiv</span>
            <Info className="h-3 w-3 text-slate-500" />
          </div>
          <span className="font-mono text-xl font-bold text-rose-300 tabular-nums mt-1 block">
            {cigaretteEquivalent}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">Smoked Equivalent</span>

          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg border border-glass bg-[#18181C] p-2 text-[10px] text-slate-300 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
            Berkeley Earth model: 1 cigarette ≈ 22 µg/m³ for 24h exposure (528 µg PM2.5 inhaled).
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-[11px] mb-1 text-slate-400">
          <span>WHO 2021 Reference Budget (15 µg/m³ 24h)</span>
          <span className="font-mono font-medium text-white">{whoBudgetPct}% consumed</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06] border border-glass/40">
          <div
            className={`h-full transition-all duration-300 ${
              whoBudgetPct > 100
                ? 'bg-crimson shadow-glowCrimson'
                : whoBudgetPct > 50
                ? 'bg-amber shadow-glowAmber'
                : 'bg-emerald shadow-glowEmerald'
            }`}
            style={{ width: `${Math.min(100, whoBudgetPct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
