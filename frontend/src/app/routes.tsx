import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { useAppState } from '../shared/hooks/AppStateProvider';
import { useAuth } from '../shared/hooks/AuthProvider';
import { homeForRole } from './navigation';
import { LoginPage } from '../features/auth/LoginPage';
import { AppSkeleton } from './shell/PageSkeleton';

// Cada pantalla se descarga solo al visitarla (code splitting por ruta).
const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const InventoryPage = lazy(() =>
  import('../features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const ReceptionListPage = lazy(() =>
  import('../features/reception/ReceptionListPage').then((m) => ({ default: m.ReceptionListPage })),
);
const ReceptionNewPage = lazy(() =>
  import('../features/reception/ReceptionPage').then((m) => ({ default: m.ReceptionNewPage })),
);
const WarehousePage = lazy(() =>
  import('../features/warehouse/WarehousePage').then((m) => ({ default: m.WarehousePage })),
);
const OrdersPage = lazy(() =>
  import('../features/orders/OrdersPage').then((m) => ({ default: m.OrdersPage })),
);
const NewOrderPage = lazy(() =>
  import('../features/orders/NewOrderPage').then((m) => ({ default: m.NewOrderPage })),
);
const PurchasesPage = lazy(() =>
  import('../features/purchases/PurchasesPage').then((m) => ({ default: m.PurchasesPage })),
);
const LogisticsPage = lazy(() =>
  import('../features/logistics/LogisticsPage').then((m) => ({ default: m.LogisticsPage })),
);
const RoutesPage = lazy(() =>
  import('../features/logistics/RoutesPage').then((m) => ({ default: m.RoutesPage })),
);
const RouteHistoryPage = lazy(() =>
  import('../features/logistics/RouteHistoryPage').then((m) => ({ default: m.RouteHistoryPage })),
);
const ClientsPage = lazy(() =>
  import('../features/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const SuppliersPage = lazy(() =>
  import('../features/suppliers/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const TraceabilityPage = lazy(() =>
  import('../features/traceability/TraceabilityPage').then((m) => ({
    default: m.TraceabilityPage,
  })),
);
const ReportsPage = lazy(() =>
  import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const BusinessRulesPage = lazy(() =>
  import('../features/settings/BusinessRulesPage').then((m) => ({ default: m.BusinessRulesPage })),
);
const UsersPage = lazy(() =>
  import('../features/users/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const WarehousesAdminPage = lazy(() =>
  import('../features/warehouses/WarehousesAdminPage').then((m) => ({
    default: m.WarehousesAdminPage,
  })),
);
const FamiliesPage = lazy(() =>
  import('../features/families/FamiliesPage').then((m) => ({ default: m.FamiliesPage })),
);
const CommercialPage = lazy(() =>
  import('../features/commercial/CommercialPage').then((m) => ({ default: m.CommercialPage })),
);
const QuotesPage = lazy(() =>
  import('../features/quotes/QuotesPage').then((m) => ({ default: m.QuotesPage })),
);
const PackingPage = lazy(() =>
  import('../features/packing/PackingPage').then((m) => ({ default: m.PackingPage })),
);
const PlanPage = lazy(() => import('../features/plan/PlanPage').then((m) => ({ default: m.PlanPage })));
const DeliveryCodePage = lazy(() =>
  import('../features/logistics/DeliveryCodePage').then((m) => ({ default: m.DeliveryCodePage })),
);

function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={homeForRole(user?.role)} replace />;
}

function ProtectedApp() {
  const { loading: authLoading, user } = useAuth();
  const { loading, error, refresh } = useAppState();

  if (authLoading) return <AppSkeleton label="Verificando sesión…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (loading) return <AppSkeleton />;
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
        <Route path="recepcion" element={<ReceptionListPage />} />
        <Route path="recepcion/nueva" element={<ReceptionNewPage />} />
        <Route path="bodega" element={<WarehousePage />} />
        <Route path="bodegas" element={<WarehousesAdminPage />} />
        <Route path="familias" element={<FamiliesPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="pedidos/nuevo" element={<NewOrderPage />} />
        <Route path="cotizaciones" element={<QuotesPage />} />
        <Route path="empaque" element={<PackingPage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="compras" element={<PurchasesPage />} />
        <Route path="logistica" element={<LogisticsPage />} />
        <Route path="logistica/rutas" element={<RoutesPage />} />
        <Route path="logistica/historial" element={<RouteHistoryPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="proveedores" element={<SuppliersPage />} />
        <Route path="comercial" element={<CommercialPage />} />
        <Route path="trazabilidad" element={<TraceabilityPage />} />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="reglas" element={<BusinessRulesPage />} />
        <Route path="usuarios" element={<UsersPage />} />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="*" element={<RoleHome />} />
      </Route>
    </Routes>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/entrega" element={<DeliveryCodePage />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}
