import { useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
type Interval = { weekday: number; startMinute: number; endMinute: number };
type Schedule = {
  id: string;
  cameraId: string | null;
  mode: 'ALWAYS' | 'SCHEDULED' | 'DISABLED';
  intervals: Interval[];
};
const days = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];
const toTime = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const toMinute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function IntelligencePanel() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [mode, setMode] = useState<Schedule['mode']>('SCHEDULED');
  const [rows, setRows] = useState<Interval[]>(
    [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1080 })),
  );
  const [status, setStatus] = useState('');
  useEffect(() => {
    void apiRequest<{ items: Schedule[] }>('/intelligence/schedules')
      .then((d) => {
        const s = d.items.find((x) => x.cameraId === null);
        if (s) {
          setSchedule(s);
          setMode(s.mode);
          setRows(s.intervals);
        }
      })
      .catch((e) => setStatus(e instanceof Error ? e.message : 'Erro ao carregar horários.'));
  }, []);
  const save = async () => {
    setStatus('Salvando…');
    try {
      const d = await apiRequest<{ schedule: Schedule }>('/intelligence/schedules', {
        method: 'PUT',
        body: JSON.stringify({ cameraId: null, mode, intervals: rows }),
      });
      setSchedule(d.schedule);
      setStatus('Horários salvos.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao salvar.');
    }
  };
  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
        Inteligência contextual
      </p>
      <h2 className="mt-1 text-2xl font-bold">Horários de atividade esperada</h2>
      <p className="mt-2 text-sm text-slate-400">
        O timezone configurado na organização é usado na análise. O risco indica prioridade
        operacional, não probabilidade de crime.
      </p>
      <select
        className="mt-5 rounded border border-slate-700 bg-slate-950 p-3"
        value={mode}
        onChange={(e) => setMode(e.target.value as Schedule['mode'])}
      >
        <option value="ALWAYS">Sempre esperado</option>
        <option value="SCHEDULED">Usar horários</option>
        <option value="DISABLED">Não analisar horário</option>
      </select>
      {mode === 'SCHEDULED' && (
        <div className="mt-4 grid gap-2">
          {rows.map((r, i) => (
            <div key={`${r.weekday}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-32 text-sm">{days[r.weekday]}</span>
              <input
                aria-label={`Início ${days[r.weekday]}`}
                type="time"
                value={toTime(r.startMinute)}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, startMinute: toMinute(e.target.value) } : x,
                    ),
                  )
                }
                className="rounded bg-slate-950 p-2"
              />
              <span>até</span>
              <input
                aria-label={`Fim ${days[r.weekday]}`}
                type="time"
                value={toTime(r.endMinute)}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, endMinute: toMinute(e.target.value) } : x,
                    ),
                  )
                }
                className="rounded bg-slate-950 p-2"
              />
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => void save()}
        className="mt-5 rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
      >
        Salvar horários
      </button>
      {status && <p className="mt-3 text-sm text-slate-300">{status}</p>}
      {schedule && <p className="mt-2 text-xs text-slate-500">Configuração ativa.</p>}
    </section>
  );
}
