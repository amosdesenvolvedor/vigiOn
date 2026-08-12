import { useEffect, useState } from 'react';
import { apiRequest, apiUrl } from '../auth/api';
export type RealtimeState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export const realtimeInvalidationEvent = 'vigion:realtime-invalidation';
export function useRealtime(onInvalidate: () => void) {
  const [state, setState] = useState<RealtimeState>('connecting');
  useEffect(() => {
    let source: EventSource | null = null;
    let canceled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      setState(source ? 'reconnecting' : 'connecting');
      try {
        const { ticket } = await apiRequest<{ ticket: string }>('/realtime/ticket', {
          method: 'POST',
        });
        if (canceled) return;
        source = new EventSource(`${apiUrl}/realtime/stream?ticket=${encodeURIComponent(ticket)}`);
        source.addEventListener('ready', () => {
          setState('connected');
          onInvalidate();
        });
        source.addEventListener('dashboard', () => {
          onInvalidate();
          window.dispatchEvent(new Event(realtimeInvalidationEvent));
        });
        source.onerror = () => {
          source?.close();
          source = null;
          if (!canceled) {
            setState('reconnecting');
            retry = setTimeout(() => void connect(), 5000);
          }
        };
      } catch {
        if (!canceled) {
          setState('disconnected');
          retry = setTimeout(() => void connect(), 10000);
        }
      }
    };
    void connect();
    return () => {
      canceled = true;
      if (retry) clearTimeout(retry);
      source?.close();
      setState('disconnected');
    };
  }, [onInvalidate]);
  return state;
}
