export const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? 'Não foi possível concluir a solicitação');
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}
