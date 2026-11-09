import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { BottomNav } from './components/BottomNav';
import type { AppState } from './types';
import { HomePage } from './pages/HomePage';
import { InventoryPage } from './pages/InventoryPage';
import { OrdersPage } from './pages/OrdersPage';
import { ReceivePage } from './pages/ReceivePage';
import { WarehousePage } from './pages/WarehousePage';

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError('');
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
    void refresh();
  }, [refresh]);

  if (loading && !state) {
    return <div className="boot">Cargando operación…</div>;
  }

  if (error && !state) {
    return (
      <div className="boot">
        <p>{error}</p>
        <p className="subtle">Asegúrate de que el backend esté en el puerto 3001.</p>
        <button type="button" className="btn primary" onClick={() => void refresh()}>
          Reintentar
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav pendingOrders={pending} />
    </div>
  );
}
