import { useState, type FormEvent } from 'react';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

export function MfaEnrollment() {
  const { reload, logout } = useAuth();
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const begin = async () => setEnrollment(await apiRequest('/auth/mfa/enroll', { method: 'POST' }));
  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    try {
      const data = new FormData(event.currentTarget);
      const result = await apiRequest<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { method: 'POST', body: JSON.stringify({ code: data.get('code') }) });
      setCodes(result.recoveryCodes);
    } catch (reason) { setError((reason as Error).message); }
  };
  if (codes) return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100"><section className="max-w-xl rounded-xl border border-emerald-800 bg-slate-900 p-6"><h1 className="text-2xl font-bold">Salve seus códigos de recuperação</h1><p className="mt-2 text-slate-300">Eles são exibidos uma única vez. Guarde-os fora deste dispositivo.</p><pre className="my-5 rounded bg-slate-950 p-4">{codes.join('\n')}</pre><button className="rounded bg-emerald-400 px-4 py-3 font-bold text-slate-950" onClick={() => void reload()}>Concluir e acessar</button></section></main>;
  return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100"><section className="max-w-xl rounded-xl border border-amber-700 bg-slate-900 p-6"><h1 className="text-2xl font-bold">Proteja a conta administrativa</h1><p className="mt-2 text-slate-300">O acesso à plataforma exige autenticação TOTP.</p>{!enrollment ? <button className="mt-5 rounded bg-emerald-400 px-4 py-3 font-bold text-slate-950" onClick={() => void begin().catch((reason: Error) => setError(reason.message))}>Configurar autenticador</button> : <><p className="mt-5 break-all rounded bg-slate-950 p-3 font-mono">{enrollment.secret}</p><p className="mt-2 text-sm text-slate-400">Adicione a chave ao Google Authenticator, Microsoft Authenticator, 1Password ou compatível.</p><form className="mt-4 flex gap-2" onSubmit={(event) => void confirm(event)}><input required name="code" inputMode="numeric" autoComplete="one-time-code" className="min-h-11 flex-1 rounded bg-slate-950 px-3" placeholder="000000"/><button className="rounded bg-emerald-400 px-4 font-bold text-slate-950">Confirmar</button></form></>}{error && <p className="mt-3 text-rose-300">{error}</p>}<button className="mt-5 block text-sm text-slate-400" onClick={() => void logout()}>Sair</button></section></main>;
}
