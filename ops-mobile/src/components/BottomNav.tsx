import { NavLink } from 'react-router-dom';
import type { AuthRole } from '../auth';
import { Icon } from './Icon';

const warehouseTabs = [
  { to: '/', label: 'Inicio', icon: 'home', end: true },
  { to: '/inventario', label: 'Inventario', icon: 'box' },
  { to: '/recibir', label: 'Recibir', icon: 'receive', primary: true },
  { to: '/pedidos', label: 'Pedidos', icon: 'orders' },
  { to: '/bodega', label: 'Bodega', icon: 'warehouse' },
] as const;

const dispatchTabs = [
  { to: '/despacho', label: 'Despacho', icon: 'truck', primary: true, end: true },
] as const;

const driverTabs = [
  { to: '/ruta', label: 'Mi ruta', icon: 'route', primary: true, end: true },
  { to: '/historial', label: 'Historial', icon: 'history' },
] as const;

export function BottomNav({
  role = 'ops',
  pendingOrders = 0,
}: {
  role?: AuthRole;
  pendingOrders?: number;
}) {
  const tabs =
    role === 'driver' ? driverTabs : role === 'dispatch' ? dispatchTabs : warehouseTabs;

  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={'end' in tab ? tab.end : false}
          className={({ isActive }) =>
            `bottom-nav-item${isActive ? ' active' : ''}${'primary' in tab && tab.primary ? ' is-primary' : ''}`
          }
        >
          <span className="bottom-nav-icon">
            <Icon name={tab.icon} />
            {tab.to === '/pedidos' && pendingOrders > 0 ? (
              <em className="nav-badge">{pendingOrders > 9 ? '9+' : pendingOrders}</em>
            ) : null}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
