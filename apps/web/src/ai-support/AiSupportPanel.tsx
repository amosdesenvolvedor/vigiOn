import { FormEvent, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../auth/api';

type Message = { role: 'user' | 'assistant'; content: string };
type Status = { enabled: boolean; available: boolean; remainingToday: number };
const suggestions = ['Por que minha câmera está offline?', 'Meu gateway está conectado?', 'Quais câmeras estão offline?', 'Meu armazenamento está próximo do limite?', 'Qual é meu plano?', 'Por que uma notificação falhou?'];

export function AiSupportPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void apiRequest<Status>('/ai-support/status').then(setStatus).catch(() => setStatus(null)); }, []);
  if (!status?.enabled) return null;

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setMessages((current) => [...current, { role: 'user', content: text }]); setMessage(''); setError(''); setBusy(true);
    try {
      const result = await apiRequest<{ conversationId: string; answer: string; remainingToday: number }>('/ai-support/chat', { method: 'POST', body: JSON.stringify({ message: text, ...(conversationId ? { conversationId } : {}) }) });
      setConversationId(result.conversationId); setMessages((current) => [...current, { role: 'assistant', content: result.answer }]); setStatus((current) => current && ({ ...current, remainingToday: result.remainingToday }));
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'O suporte inteligente está temporariamente indisponível.'); }
    finally { setBusy(false); }
  }
  const newConversation = () => { setConversationId(undefined); setMessages([]); setError(''); };
  return (
    <section id="ai-support" className="mt-12 rounded-2xl border border-emerald-500/30 bg-slate-900 p-4 shadow-xl sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-emerald-400">Assistente seguro</p><h2 className="mt-2 text-2xl font-bold">Vigion AI Support</h2><p className="mt-1 text-sm text-slate-400">Suporte inteligente para diagnóstico e orientação no Vigion Cloud.</p></div>
        <button type="button" onClick={newConversation} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-emerald-500">Nova conversa</button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Mensagens disponíveis hoje: {status.remainingToday}</p>
      {!messages.length && <div className="mt-5 flex flex-wrap gap-2">{suggestions.map((item) => <button key={item} type="button" onClick={() => setMessage(item)} className="rounded-full border border-slate-700 px-3 py-2 text-left text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-300">{item}</button>)}</div>}
      <div aria-live="polite" className="mt-5 max-h-96 space-y-3 overflow-y-auto rounded-xl bg-slate-950/70 p-3 sm:p-4">
        {!messages.length && <p className="py-8 text-center text-sm text-slate-500">Escolha uma sugestão ou descreva o problema.</p>}
        {messages.map((item, index) => <div key={`${item.role}-${index}`} className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${item.role === 'user' ? 'ml-auto bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-100'}`}>{item.content}</div>)}
        {busy && <p className="text-sm text-emerald-300">Analisando informações autorizadas…</p>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-200">{error}</p>}
      <form onSubmit={(event) => void send(event)} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="ai-message">Mensagem para o suporte</label><textarea id="ai-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={2} placeholder="Como posso ajudar?" className="min-h-14 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-emerald-500" />
        <button disabled={busy || !message.trim() || status.remainingToday <= 0} className="rounded-xl bg-emerald-400 px-6 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">Enviar</button>
      </form>
    </section>
  );
}
