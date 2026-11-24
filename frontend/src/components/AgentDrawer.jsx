import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  X,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Cpu,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Shield,
  Layers,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { sendChatMessage } from '../lib/api';

const STARTER_PROMPTS = [
  'I need to commute 40 mins, jog 30 mins, and ventilate my bedroom today.',
  'When will the smog trap lift, and is it safe to run at 7 AM?',
  'Compare a 30-min unmasked jog now vs. N95 masked at 4 PM.',
];

function getProviderBadge(provider) {
  if (provider && provider.startsWith('gemini')) {
    return {
      label: 'Gemini 2.5 Flash',
      colorClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      dotColor: 'bg-blue-400',
    };
  } else if (provider === 'groq_failover' || (provider && provider.includes('groq'))) {
    return {
      label: 'Groq Failover',
      colorClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      dotColor: 'bg-amber-400',
    };
  } else if (provider === 'deterministic_fallback') {
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
        <ul key={`ul-${renderedElements.length}`} className="my-1.5 space-y-1 pl-4 list-disc marker:text-cobalt text-xs text-slate-200">
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

export default function AgentDrawer({
  isOpen,
  onClose,
  activeCity,
  coords,
  activePersona,
}) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hello, I am your Aether Atmospheric Co-Pilot. I evaluate boundary layer inversions, clinical inhaled doses, Land-Use Regression routes, and conflict-free daily schedules citing exact physical tool figures. How can I protect your respiratory health today?',
      provider_used: 'deterministic_fallback',
      tool_trace: [],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedTraces, setExpandedTraces] = useState(new Set(['welcome']));

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const toggleTrace = (id) => {
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSendMessage = async (textToSend) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isLoading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    const historyPayload = messages
      .filter((m) => m.id !== 'welcome')
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await sendChatMessage({
        message: text,
        cityName: activeCity,
        lat: coords?.lat,
        lon: coords?.lon,
        persona: activePersona,
        history: historyPayload,
      });

      const assistantMsgId = `assistant-${Date.now()}`;
      const assistantMsg = {
        id: assistantMsgId,
        role: 'assistant',
        content: res.reply || 'Analysis complete.',
        provider_used: res.provider_used || 'deterministic_fallback',
        tool_trace: res.tool_trace || [],
        schedule: res.schedule || null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      // Auto-expand trace for the newest assistant response
      setExpandedTraces((prev) => new Set(prev).add(assistantMsgId));
    } catch (err) {
      console.error('Co-Pilot request failed:', err);
      setError(err.message || 'Unable to connect to Aether Co-Pilot backend.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const latestProvider =
    messages[messages.length - 1]?.provider_used || 'deterministic_fallback';
  const badgeInfo = getProviderBadge(latestProvider);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300">
      {/* Slide-Over Drawer Container */}
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-glass bg-[#0D0D0F] shadow-2xl backdrop-blur-2xl transition-transform duration-300 sm:w-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt/15 border border-cobalt/30 text-cobalt">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-white">Aether Co-Pilot</h2>
                <span
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono font-medium ${badgeInfo.colorClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${badgeInfo.dotColor}`} />
                  {badgeInfo.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Active City: <span className="text-slate-200 font-medium">{activeCity}</span> • Persona:{' '}
                <span className="text-slate-200 font-medium capitalize">
                  {activePersona.replace('_', ' ')}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            const hasTools = Array.isArray(msg.tool_trace) && msg.tool_trace.length > 0;
            const isTraceExpanded = expandedTraces.has(msg.id);
            const msgBadge = getProviderBadge(msg.provider_used);

            return (
              <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                {/* User Message */}
                {isUser ? (
                  <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-cobalt px-4 py-2.5 text-xs font-medium text-white shadow-md">
                    <p className="leading-relaxed">{msg.content}</p>
                    <span className="mt-1 block text-right font-mono text-[9px] text-blue-200">
                      {msg.timestamp}
                    </span>
                  </div>
                ) : (
                  <div className="w-full max-w-[95%] space-y-2.5">
                    {/* Collapsible Glass-Box Tool Trace Panel */}
                    {hasTools && (
                      <div className="overflow-hidden rounded-xl border border-glass bg-white/[0.02]">
                        <button
                          type="button"
                          onClick={() => toggleTrace(msg.id)}
                          className="flex w-full items-center justify-between px-3.5 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/[0.04]"
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
                                  <span className="font-mono text-xs font-semibold text-emerald">
                                    {t.tool_name}
                                  </span>
                                  <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                                    {t.latency_ms} ms
                                  </span>
                                </div>

                                {/* Formatted Arguments */}
                                {t.arguments && Object.keys(t.arguments).length > 0 && (
                                  <div className="rounded bg-black/40 p-1.5 font-mono text-[10px] text-slate-400 overflow-x-auto">
                                    <span className="text-slate-500 font-sans">args: </span>
                                    {JSON.stringify(t.arguments)}
                                  </div>
                                )}

                                {/* Returned Physics Summary */}
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

                    {/* Assistant Prose Message */}
                    <div className="glass-surface rounded-2xl rounded-tl-none p-4 text-xs leading-relaxed text-slate-200 border border-glass">
                      <FormattedMessage content={msg.content} />

                      {/* Visual Schedule Timeline Card if returned */}
                      {msg.schedule && Array.isArray(msg.schedule.scheduled_tasks) && (
                        <div className="mt-3.5 rounded-xl border border-amber/30 bg-amber/[0.05] p-3 text-xs">
                          <div className="flex items-center justify-between border-b border-amber/20 pb-2">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-4 w-4 text-amber" />
                              <span className="font-semibold text-white">Optimized Day Timeline</span>
                            </div>
                            <span className="font-mono font-bold text-amber">
                              {msg.schedule.total_savings_pct}% Saved
                            </span>
                          </div>

                          <div className="mt-2.5 divide-y divide-amber/10 space-y-2">
                            {msg.schedule.scheduled_tasks.map((task, sIdx) => (
                              <div key={sIdx} className="pt-2 first:pt-0 flex items-center justify-between text-[11px]">
                                <div>
                                  <div className="flex items-center gap-1.5 font-medium text-white">
                                    <span className="font-mono text-cobalt">{task.start_time} - {task.end_time}</span>
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
                            <span>Optimized Dose: <strong className="text-white">{msg.schedule.total_optimized_dose_ug} µg</strong></span>
                            <span>Naive Dose: <strong className="text-slate-300">{msg.schedule.baseline_naive_dose_ug} µg</strong></span>
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
                )}
              </div>
            );
          })}

          {/* Loading Skeleton */}
          {isLoading && (
            <div className="w-full max-w-[90%] space-y-2">
              <div className="glass-surface rounded-2xl rounded-tl-none p-4 border border-glass animate-pulse space-y-2">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 text-cobalt animate-spin" />
                  <span className="font-mono text-xs text-cobalt">Consulting atmospheric tools...</span>
                </div>
                <div className="h-3 w-3/4 rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/10" />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-crimson/40 bg-crimson/10 p-3 text-xs text-rose-200">
              <div className="flex items-center gap-2 font-semibold text-crimson mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span>Co-Pilot Connection Error</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 3 Quick Starter Prompt Chips */}
        <div className="border-t border-glass bg-white/[0.01] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-2">
            One-Click Benchmark Prompts:
          </p>
          <div className="flex flex-col gap-1.5">
            {STARTER_PROMPTS.map((promptText, pIdx) => (
              <button
                key={pIdx}
                type="button"
                onClick={() => handleSendMessage(promptText)}
                className="flex items-center justify-between rounded-lg border border-glass bg-surface px-3 py-2 text-left text-[11px] text-slate-300 transition-all hover:border-glassHover hover:bg-surfaceHover hover:text-white active:scale-[0.98]"
              >
                <span className="truncate pr-2">{promptText}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-cobalt" />
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <div className="border-t border-glass p-3 bg-[#0D0D0F]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask Aether Co-Pilot (e.g. routine schedule, routes, smog trap)..."
              disabled={isLoading}
              className="flex-1 rounded-xl border border-glass bg-surface px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 backdrop-blur-md transition-all focus:border-cobalt/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-cobalt/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cobalt text-white shadow-glowCobalt transition-all hover:bg-cobalt/90 active:scale-[0.95] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
