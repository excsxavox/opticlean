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
import type { AppState, Meta, Metrics } from '../types';

type Ctx = {
  state: AppState | null;
  meta: Meta | null;
  metrics: Metrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  applyResponse: (r: { state: AppState; metrics: Metrics }) => void;
  toast: (message: string) => void;
};

const AppStateContext = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  const applyResponse = useCallback((r: { state: AppState; metrics: Metrics }) => {
    setState(r.state);
    setMetrics(r.metrics);
    void api.getMeta().then(setMeta);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s] = await Promise.all([api.getMeta(), api.getState()]);
      setMeta(m);
      applyResponse(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la operación');
    } finally {
      setLoading(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    window.setTimeout(() => setToastMsg(''), 4300);
  }, []);

  const value = useMemo(
    () => ({ state, meta, metrics, loading, error, refresh, applyResponse, toast }),
    [state, meta, metrics, loading, error, refresh, applyResponse, toast],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
      <div id="toast" className={toastMsg ? 'show' : ''} role="status">
        {toastMsg}
      </div>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState debe usarse dentro de AppStateProvider');
  return ctx;
}
