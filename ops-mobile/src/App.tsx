import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { clearSession, getStoredUser, getToken, type AuthUser } from './auth';
import { BottomNav } from './components/BottomNav';
import type { AppState } from './types';
import { HomePage } from './pages/HomePage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { ReceivePage } from './pages/ReceivePage';
import { WarehousePage } from './pages/WarehousePage';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [authChecking, setAuthChecking] = useState(() => !!getToken());
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    let cancelled = false;
    void api
      .me()
      .then((r) => {
        if (!cancelled) setUser(r.user);
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.getState();
      setState(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con la API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authChecking) return;
    if (!user) {
      setState(null);
      return;
    }
    void refresh();
  }, [authChecking, user, refresh]);

  if (authChecking) {
    return <div className="boot">Verificando sesión…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage user={null} onLogin={setUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (loading && !state) {
    return <div className="boot">Cargando operación…</div>;
  }

  if (error && !state) {
    return (
      <div className="boot">
        <p>{error}</p>
        <p className="subtle">Revisa tu conexión o vuelve a iniciar sesión.</p>
        <button type="button" className="btn primary" onClick={() => void refresh()}>
          Reintentar
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            clearSession();
            setUser(null);
          }}
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  if (!state) return null;

  const pending = state.orders.filter((o) => o.status === 'Por preparar').length;

  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage state={state} />} />
          <Route path="/inventario" element={<InventoryPage state={state} />} />
          <Route path="/recibir" element={<ReceivePage state={state} onRefresh={refresh} />} />
          <Route path="/pedidos" element={<OrdersPage state={state} onRefresh={refresh} />} />
          <Route path="/bodega" element={<WarehousePage state={state} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav pendingOrders={pending} />
    </div>
  );
}
