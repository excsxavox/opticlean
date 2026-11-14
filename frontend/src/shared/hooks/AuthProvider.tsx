import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import {
  clearSession,
  getStoredUser,
  getToken,
  setSession,
  type AuthUser,
} from '../auth/session';

type Ctx = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState(() => !!getToken());

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void api
      .me()
      .then((r) => {
        if (!cancelled) {
          setUser(r.user);
          setSession(token, r.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setSession(res.token, res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
