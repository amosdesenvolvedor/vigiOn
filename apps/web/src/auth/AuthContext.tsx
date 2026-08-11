import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, setAccessToken } from './api';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
}
interface Organization {
  id: string;
  name: string;
  slug: string;
}
interface AuthContextValue {
  user: User | null;
  organization: Organization | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
}
interface RegisterInput {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  organizationName: string;
  timezone: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = async () => {
    const data = await apiRequest<{ user: User; organization: Organization }>('/auth/me');
    setUser(data.user);
    setOrganization(data.organization);
  };

  useEffect(() => {
    apiRequest<{ session: { accessToken: string } }>('/auth/refresh', { method: 'POST' })
      .then(async ({ session }) => {
        setAccessToken(session.accessToken);
        await loadMe();
      })
      .catch(() => setAccessToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiRequest<{ session: { accessToken: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(data.session.accessToken);
    await loadMe();
  };
  const register = async (input: RegisterInput) => {
    const data = await apiRequest<{ session: { accessToken: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAccessToken(data.session.accessToken);
    await loadMe();
  };
  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
      setOrganization(null);
    }
  };

  const value = { user, organization, loading, login, register, logout, reload: loadMe };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
