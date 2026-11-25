import { ChevronDown, ChevronUp, Cpu, Calendar } from 'lucide-react';

/**
 * Returns display badge styling for the active LLM or deterministic fallback provider.
 * @param {string | undefined} provider
 * @returns {{ label: string, colorClass: string, dotColor: string }}
 */
export function getProviderBadge(provider) {
  if (provider && provider.startsWith('gemini')) {
    return {
      label: 'Gemini 2.5 Flash',
      colorClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      dotColor: 'bg-blue-400',
    };
  }
  if (provider === 'groq_failover' || (provider && provider.includes('groq'))) {
    return {
      label: 'Groq Failover',
      colorClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      dotColor: 'bg-amber-400',
    };
  }
  if (provider === 'deterministic_fallback') {
    return {
      label: 'Deterministic Engine',
      colorClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      dotColor: 'bg-emerald-400',
    };
  }
  return {
    label: 'Dual-LLM Ready',
    colorClass: 'bg-white/10 text-slate-300 border-white/15',
    dotColor: 'bg-slate-400',
  };
}

function FormattedMessage({ content }) {
  if (!content) return null;

  const renderInline = (str) => {
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  const lines = content.split('\n');
  const renderedElements = [];
  let currentBullets = [];

  const flushBullets = () => {
    if (currentBullets.length > 0) {
      renderedElements.push(
        <ul
          key={`ul-${renderedElements.length}`}
          className="my-1.5 space-y-1 pl-4 list-disc marker:text-cobalt text-xs text-slate-200"
        >
          {currentBullets.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      currentBullets = [];
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBullets();
      return;
    }
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentBullets.push(trimmed.slice(2));
    } else {
      flushBullets();
      renderedElements.push(
        <p key={`p-${idx}`} className="leading-relaxed my-1">
          {renderInline(trimmed)}
        </p>
      );
    }
  });

  flushBullets();
  return <div className="space-y-1 text-xs text-slate-200">{renderedElements}</div>;
}

/**
 * Renders a single user or assistant chat message with optional Glass-Box tool trace and schedule card.
 * @param {{
 *   msg: { id: string, role: string, content: string, provider_used?: string, tool_trace?: Array<object>, schedule?: object | null, timestamp: string },
 *   isTraceExpanded: boolean,
 *   onToggleTrace: (id: string) => void,
 * }} props
 */
export default function AgentMessage({ msg, isTraceExpanded, onToggleTrace }) {
  const isUser = msg.role === 'user';
  const hasTools = Array.isArray(msg.tool_trace) && msg.tool_trace.length > 0;
  const msgBadge = getProviderBadge(msg.provider_used);

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-cobalt px-4 py-2.5 text-xs font-medium text-white shadow-md">
          <p className="leading-relaxed">{msg.content}</p>
          <span className="mt-1 block text-right font-mono text-[9px] text-blue-200">{msg.timestamp}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div className="w-full max-w-[95%] space-y-2.5">
        {hasTools && (
          <div className="overflow-hidden rounded-xl border border-glass bg-white/[0.02]">
            <button
              type="button"
              onClick={() => onToggleTrace(msg.id)}
              aria-expanded={isTraceExpanded}
              className="flex w-full items-center justify-between px-3.5 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-cobalt" />
                <span className="font-mono text-[11px] font-semibold text-white">
                  Live Tool-Call Trace ({msg.tool_trace.length} tool
                  {msg.tool_trace.length > 1 ? 's' : ''} executed)
                </span>
              </div>
              {isTraceExpanded ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>

            {isTraceExpanded && (
              <div className="divide-y divide-glass border-t border-glass px-3.5 py-2.5 space-y-2 bg-[#09090C]/80">
                {msg.tool_trace.map((t, idx) => (
                  <div key={idx} className="pt-2 first:pt-0 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-emerald">{t.tool_name}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                        {t.latency_ms} ms
                      </span>
                    </div>
                    {t.arguments && Object.keys(t.arguments).length > 0 && (
                      <div className="rounded bg-black/40 p-1.5 font-mono text-[10px] text-slate-400 overflow-x-auto">
                        <span className="text-slate-500 font-sans">args: </span>
                        {JSON.stringify(t.arguments)}
                      </div>
                    )}
                    {t.result_summary && (
                      <div className="rounded bg-black/40 p-1.5 font-mono text-[10px] text-slate-300 overflow-x-auto">
                        <span className="text-slate-500 font-sans">output: </span>
                        {JSON.stringify(t.result_summary)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="glass-surface rounded-2xl rounded-tl-none p-4 text-xs leading-relaxed text-slate-200 border border-glass">
          <FormattedMessage content={msg.content} />

          {msg.schedule && Array.isArray(msg.schedule.scheduled_tasks) && (
            <div className="mt-3.5 rounded-xl border border-amber/30 bg-amber/[0.05] p-3 text-xs">
              <div className="flex items-center justify-between border-b border-amber/20 pb-2">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-amber" />
                  <span className="font-semibold text-white">Optimized Day Timeline</span>
                </div>
                <span className="font-mono font-bold text-amber">{msg.schedule.total_savings_pct}% Saved</span>
              </div>

              <div className="mt-2.5 divide-y divide-amber/10 space-y-2">
                {msg.schedule.scheduled_tasks.map((task, sIdx) => (
                  <div key={sIdx} className="pt-2 first:pt-0 flex items-center justify-between text-[11px]">
                    <div>
                      <div className="flex items-center gap-1.5 font-medium text-white">
                        <span className="font-mono text-cobalt">
                          {task.start_time} - {task.end_time}
                        </span>
                        <span>•</span>
                        <span>{task.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 capitalize">
                        Activity: {task.activity} | Mask: {task.mask}
                      </span>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-emerald font-semibold">{task.inhaled_dose_ug} µg</span>
                      <span className="block text-[9px] text-slate-400">{task.savings_pct}% cut</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2.5 border-t border-amber/20 pt-2 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>
                  Optimized Dose: <strong className="text-white">{msg.schedule.total_optimized_dose_ug} µg</strong>
                </span>
                <span>
                  Naive Dose: <strong className="text-slate-300">{msg.schedule.baseline_naive_dose_ug} µg</strong>
                </span>
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-glass/40 pt-1.5 text-[9px] font-mono text-slate-400">
            <span className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${msgBadge.dotColor}`} />
              {msgBadge.label}
            </span>
            <span>{msg.timestamp}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
