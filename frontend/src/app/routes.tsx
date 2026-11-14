import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { useAppState } from '../shared/hooks/AppStateProvider';
import { useAuth } from '../shared/hooks/AuthProvider';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { ReceptionPage } from '../features/reception/ReceptionPage';
import { WarehousePage } from '../features/warehouse/WarehousePage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { NewOrderPage } from '../features/orders/NewOrderPage';
import { PurchasesPage } from '../features/purchases/PurchasesPage';
import { LogisticsPage } from '../features/logistics/LogisticsPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { TraceabilityPage } from '../features/traceability/TraceabilityPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { WarehousesAdminPage } from '../features/warehouses/WarehousesAdminPage';
import { FamiliesPage } from '../features/families/FamiliesPage';

function LoadingShell({ label = 'Cargando operación…' }: { label?: string }) {
  return (
    <div className="page" style={{ padding: 40 }}>
      <p>{label}</p>
    </div>
  );
}

function ProtectedApp() {
  const { loading: authLoading, user } = useAuth();
  const { loading, error, refresh } = useAppState();

  if (authLoading) return <LoadingShell label="Verificando sesión…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (loading) return <LoadingShell />;
  if (error) {
    return (
      <div className="page" style={{ padding: 40 }}>
        <p>{error}</p>
        <p className="subtle">Asegúrate de que el backend esté en ejecución.</p>
        <button type="button" className="btn primary" onClick={() => void refresh()}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="recepcion" element={<ReceptionPage />} />
        <Route path="bodega" element={<WarehousePage />} />
        <Route path="bodegas" element={<WarehousesAdminPage />} />
        <Route path="familias" element={<FamiliesPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="pedidos/nuevo" element={<NewOrderPage />} />
        <Route path="compras" element={<PurchasesPage />} />
        <Route path="logistica" element={<LogisticsPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="trazabilidad" element={<TraceabilityPage />} />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/bodega" replace />} />
      </Route>
    </Routes>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}
