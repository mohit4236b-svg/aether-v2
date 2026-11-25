import { Calendar, Bot, Sparkles } from 'lucide-react';

/**
 * Displays the 24-hour conflict-free schedule optimizer cards and the Co-Pilot launch banner.
 * @param {{
 *   scheduleData: { total_savings_pct: number, baseline_naive_dose_ug: number, total_optimized_dose_ug: number, scheduled_tasks?: Array<object> } | null,
 *   onOpenDrawer: () => void,
 * }} props
 */
export default function ScheduleSection({ scheduleData, onOpenDrawer }) {
  return (
    <>
      {/* Section 4: 24h Conflict-Free Schedule Optimizer Slot */}
      <section
        aria-label="24-Hour Conflict-Free Schedule Optimizer"
        className="glass-surface glass-surface-hover rounded-2xl p-6 border border-glass"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-glass">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber" />
            <h3 className="text-sm font-semibold text-white tracking-tight">
              24-Hour Conflict-Free Schedule Optimizer
            </h3>
            {scheduleData && (
              <span className="rounded-full bg-emerald/15 text-emerald border border-emerald/30 px-2 py-0.5 text-[10px] font-mono font-medium">
                {scheduleData.total_savings_pct.toFixed(1)}% Saved (
                {(scheduleData.baseline_naive_dose_ug - scheduleData.total_optimized_dose_ug).toFixed(1)} µg cut)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenDrawer}
            className="flex items-center gap-1.5 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1 text-xs font-medium text-amber hover:bg-amber/20 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
              <div
                key={idx}
                className="rounded-xl border border-glass bg-white/[0.02] p-3 flex flex-col justify-between"
              >
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
      </section>

      {/* Section 5: Glass-Box Agentic Co-Pilot Banner & Trigger */}
      <div className="glass-surface glass-surface-hover rounded-2xl p-4 border border-cobalt/30 bg-cobalt/[0.05] flex flex-wrap items-center justify-between gap-3 transition-all">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-cobalt/20 border border-cobalt/40 flex items-center justify-center text-cobalt">
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
          onClick={onOpenDrawer}
          className="flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-1.5 text-xs font-semibold text-white shadow-glowCobalt hover:bg-cobalt/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Launch Co-Pilot</span>
        </button>
      </div>
    </>
  );
}
