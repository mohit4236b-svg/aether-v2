import { useState, useEffect, useRef } from 'react';
import { Bot, X, Send, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { sendChatMessage } from '../lib/api';
import AgentMessage, { getProviderBadge } from './AgentMessage';

const STARTER_PROMPTS = [
  'I need to commute 40 mins, jog 30 mins, and ventilate my bedroom today.',
  'When will the smog trap lift, and is it safe to run at 7 AM?',
  'Compare a 30-min unmasked jog now vs. N95 masked at 4 PM.',
];

/**
 * Slide-over Glass-Box AI Co-Pilot drawer with Escape key dismissal and live tool-call traces.
 * @param {{
 *   isOpen: boolean,
 *   onClose: () => void,
 *   activeCity: string,
 *   coords: { lat: number, lon: number },
 *   activePersona: string,
 * }} props
 */
export default function AgentDrawer({ isOpen, onClose, activeCity, coords, activePersona }) {
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
  const msgCounterRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

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

    msgCounterRef.current += 1;
    const userMsg = {
      id: `user-${msgCounterRef.current}`,
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

      msgCounterRef.current += 1;
      const assistantMsgId = `assistant-${msgCounterRef.current}`;
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
      setExpandedTraces((prev) => new Set(prev).add(assistantMsgId));
    } catch (err) {
      console.error('Co-Pilot request failed:', err);
      setError(err.message || 'Unable to connect to Aether Co-Pilot backend.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const latestProvider = messages[messages.length - 1]?.provider_used || 'deterministic_fallback';
  const badgeInfo = getProviderBadge(latestProvider);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aether AI Co-Pilot"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300"
    >
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-glass bg-[#0D0D0F] shadow-2xl backdrop-blur-2xl transition-transform duration-300 sm:w-[480px]">
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
                <span className="text-slate-200 font-medium capitalize">{activePersona.replace('_', ' ')}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Co-Pilot drawer"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4" aria-live="polite">
          {messages.map((msg) => (
            <AgentMessage
              key={msg.id}
              msg={msg}
              isTraceExpanded={expandedTraces.has(msg.id)}
              onToggleTrace={toggleTrace}
            />
          ))}

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
            <div role="alert" className="rounded-xl border border-crimson/40 bg-crimson/10 p-3 text-xs text-rose-200">
              <div className="flex items-center gap-2 font-semibold text-crimson mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span>Co-Pilot Connection Error</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

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
                className="flex items-center justify-between rounded-lg border border-glass bg-surface px-3 py-2 text-left text-[11px] text-slate-300 transition-all hover:border-glassHover hover:bg-surfaceHover hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="truncate pr-2">{promptText}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-cobalt" />
              </button>
            ))}
          </div>
        </div>

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
              aria-label="Ask Aether Co-Pilot"
              disabled={isLoading}
              className="flex-1 rounded-xl border border-glass bg-surface px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 backdrop-blur-md transition-all focus:border-cobalt/50 focus:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={isLoading || !inputValue.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cobalt text-white shadow-glowCobalt transition-all hover:bg-cobalt/90 active:scale-[0.95] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
