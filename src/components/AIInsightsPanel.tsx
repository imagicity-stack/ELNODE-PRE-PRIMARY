import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, RefreshCw, AlertCircle } from 'lucide-react';
import { buildAIContext } from '../lib/aiContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIInsightsPanelProps {
  open: boolean;
  onClose: () => void;
  period?: 'This Month' | 'Last Month' | 'This Quarter' | 'This Year';
  greeting?: string;
  /** Override the default financial context builder */
  contextBuilder?: () => Promise<any>;
  /** Role-specific suggested prompts */
  suggestedPrompts?: string[];
  /** Custom summary chips rendered below the greeting */
  summaryRenderer?: (context: any) => React.ReactNode;
  /** Textarea placeholder */
  placeholder?: string;
  /** Header subtitle label */
  label?: string;
}

const SUGGESTED_PROMPTS = [
  "Give me a full school health summary — finance, attendance, and academics.",
  "Which students are at risk of low attendance this month?",
  "How is our fee collection rate and how much is overdue?",
  "Which classes are performing best and worst in exams?",
  "Are there any unresolved grievances I should act on?",
  "Compare income vs expenses over the last 6 months.",
  "Which teachers have pending leave requests?",
  "Suggest 3 concrete actions I should take today.",
];

// Tiny inline markdown -> JSX renderer (no deps)
function renderMarkdown(text: string): React.ReactNode {
  const blocks = text.split(/\n\n+/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n');

    // Heading
    if (/^#{1,3}\s+/.test(lines[0])) {
      const m = lines[0].match(/^(#{1,3})\s+(.*)$/);
      if (m) {
        const level = m[1].length;
        const cls = level === 1 ? 'text-base font-bold' : level === 2 ? 'text-sm font-bold' : 'text-xs font-bold uppercase tracking-wide';
        return <p key={bi} className={`${cls} text-slate-900 mt-3 mb-1`}>{inline(m[2])}</p>;
      }
    }

    // Bullet list
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
      return (
        <ul key={bi} className="list-disc pl-5 space-y-1 my-2 text-sm text-slate-700">
          {lines.map((l, i) => (
            <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    // Numbered list
    if (lines.every(l => /^\s*\d+\.\s+/.test(l))) {
      return (
        <ol key={bi} className="list-decimal pl-5 space-y-1 my-2 text-sm text-slate-700">
          {lines.map((l, i) => (
            <li key={i}>{inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>
          ))}
        </ol>
      );
    }

    return <p key={bi} className="text-sm text-slate-700 my-2 leading-relaxed">{inline(block)}</p>;
  });
}

function inline(text: string): React.ReactNode {
  // Bold **x**, italic *x*, code `x`
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={i++} className="font-bold text-slate-900">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) parts.push(<code key={i++} className="bg-slate-100 text-violet-700 px-1 py-0.5 rounded text-[12px]">{t.slice(1, -1)}</code>);
    else parts.push(<em key={i++} className="italic">{t.slice(1, -1)}</em>);
    lastIndex = m.index + t.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export default function AIInsightsPanel({
  open, onClose, period = 'This Month', greeting,
  contextBuilder, suggestedPrompts, summaryRenderer, placeholder, label,
}: AIInsightsPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [context, setContext] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadContext = contextBuilder ?? (() => buildAIContext(period));

  // Fetch fresh context when panel opens
  useEffect(() => {
    if (!open) return;
    if (context) return;
    setContextLoading(true);
    setContextError(null);
    loadContext()
      .then(setContext)
      .catch((e) => setContextError(e?.message || 'Failed to load data'))
      .finally(() => setContextLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || loading || contextLoading) return;
    const userMsg: Message = { role: 'user', content: content.trim() };
    const newHistory = [...messages, userMsg];
    setMessages([...newHistory, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, context }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: `Sorry — I couldn't get a response. ${errText.slice(0, 200)}` };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) {
              assistantText += parsed.text;
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: 'assistant', content: assistantText };
                return copy;
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: `Sorry — something went wrong. ${err?.message || ''}` };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const reset = () => {
    setMessages([]);
    setContext(null);
    setContextLoading(true);
    loadContext()
      .then(setContext)
      .catch((e) => setContextError(e?.message || 'Failed to load data'))
      .finally(() => setContextLoading(false));
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 animate-in fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full md:w-[440px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold">AI Insights</p>
              <p className="text-[11px] text-violet-100">Gemini · {label || context?.period?.label || period}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={reset}
              className="p-2 rounded-lg hover:bg-white/15 active:scale-90 transition-transform"
              aria-label="New chat"
              title="New chat"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/15 active:scale-90 transition-transform"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50">
          {contextError && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 mb-3 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Couldn't load school data</p>
                <p>{contextError}</p>
                <p className="mt-1 text-rose-500">Run <code className="bg-rose-100 px-1 rounded">firebase deploy --only firestore:rules</code> if rules were recently changed.</p>
              </div>
            </div>
          )}
          {!contextError && context?._dataWarnings && (
            <div className="bg-amber-50 border border-amber-100 text-amber-700 rounded-xl p-3 mb-3 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Partial data loaded</p>
                <p>{context._dataWarnings}</p>
              </div>
            </div>
          )}

          {contextLoading && messages.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-violet-500" />
              Loading your school's data…
            </div>
          )}

          {!contextLoading && messages.length === 0 && (
            <div className="space-y-3">
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-sm text-slate-700">
                  {greeting ||
                    `Hi! I've loaded a full snapshot of your school's data — students, attendance, exams, fees, payroll, leaves, grievances, and more. Ask me anything.`}
                </p>
                {summaryRenderer ? summaryRenderer(context) : context?.school && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-indigo-50 rounded-lg p-2">
                      <p className="text-[9px] text-indigo-700 font-bold uppercase">Students</p>
                      <p className="text-xs font-black text-indigo-800 mt-0.5">{context.school.totalStudents}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-2">
                      <p className="text-[9px] text-emerald-700 font-bold uppercase">Attendance</p>
                      <p className="text-xs font-black text-emerald-800 mt-0.5">{context.attendance?.today?.rate ?? '—'}%</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2">
                      <p className="text-[9px] text-amber-700 font-bold uppercase">Fee Rate</p>
                      <p className="text-xs font-black text-amber-800 mt-0.5">{context.finance?.feeCollection?.collectionRate ?? '—'}%</p>
                    </div>
                    <div className="bg-rose-50 rounded-lg p-2">
                      <p className="text-[9px] text-rose-700 font-bold uppercase">Overdue</p>
                      <p className="text-xs font-black text-rose-800 mt-0.5">{context.finance?.feeCollection?.overdueCount ?? '—'}</p>
                    </div>
                    <div className="bg-violet-50 rounded-lg p-2">
                      <p className="text-[9px] text-violet-700 font-bold uppercase">Grievances</p>
                      <p className="text-xs font-black text-violet-800 mt-0.5">{context.grievances?.open ?? '—'} open</p>
                    </div>
                    <div className={`rounded-lg p-2 ${(context.finance?.period?.net ?? 0) >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
                      <p className={`text-[9px] font-bold uppercase ${(context.finance?.period?.net ?? 0) >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>Net</p>
                      <p className={`text-xs font-black mt-0.5 ${(context.finance?.period?.net ?? 0) >= 0 ? 'text-blue-800' : 'text-orange-800'}`}>
                        ₹{(Math.abs(context.finance?.period?.net ?? 0) / 1000 | 0).toLocaleString()}k
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">Try asking</p>
              <div className="space-y-2">
                {(suggestedPrompts ?? SUGGESTED_PROMPTS).map(p => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    className="w-full text-left text-sm bg-white border border-slate-100 hover:border-violet-200 hover:bg-violet-50/30 text-slate-700 rounded-xl px-3 py-2.5 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-2.5 ${
                  m.role === 'user'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white border border-slate-100 text-slate-700'
                }`}
              >
                {m.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                ) : m.content ? (
                  <div>{renderMarkdown(m.content)}</div>
                ) : (
                  <div className="flex items-center gap-1.5 py-1">
                    <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
                    <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-slate-100 px-3 py-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              rows={1}
              placeholder={contextLoading ? 'Loading data…' : (placeholder ?? 'Ask about fees, expenses, payroll…')}
              disabled={loading || contextLoading}
              className="flex-1 resize-none px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-violet-400 focus:bg-white max-h-32"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading || contextLoading}
              className="p-2.5 bg-violet-600 text-white rounded-xl active:scale-90 transition-transform disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-center mt-2">
            AI may make mistakes. Verify critical figures against the source data.
          </p>
        </form>
      </div>
    </>
  );
}
