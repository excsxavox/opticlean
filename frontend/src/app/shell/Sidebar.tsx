import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Icon, Logo } from '../../shared/components/Icon';
import { cx } from '../../shared/components/ui';
import { spring } from '../../shared/motion/presets';
import type { MenuSection } from '../navigation';
import { Tooltip } from '../../shared/components/Tooltip';
import { IconButton } from '../../shared/components/IconButton';

/** Pantallas sin entrada propia que se marcan dentro de otra del menú. */
const NESTED_PATHS: Record<string, string> = { '/pedidos': '/cotizaciones' };

type Props = {
  sections: MenuSection[];
  collapsed: boolean;
  mobileOpen: boolean;
  /** Contador dinámico por ruta (p. ej. pedidos por preparar). */
  counters: Record<string, number>;
  user: { name: string; email: string; role: string; initials: string };
  onNavigate: () => void;
  onAssistant: () => void;
  onLogout: () => void;
};

export function Sidebar({
  sections,
  collapsed,
  mobileOpen,
  counters,
  user,
  onNavigate,
  onAssistant,
  onLogout,
}: Props) {
  const { pathname } = useLocation();
  return (
    <aside
      className={cx('sidebar', collapsed && 'is-collapsed', mobileOpen && 'open')}
      aria-label="Navegación principal"
    >
      <div className="sidebar-head">
        <NavLink className="brand" to="/" onClick={onNavigate} aria-label="OPTICLEAN AI · Inicio">
          <Logo />
          <span className="brand-text">
            OPTI<span>CLEAN</span> <em>AI</em>
          </span>
        </NavLink>
      </div>

      <div className="sidebar-scroll">
        {sections.map((sec) => (
          <div className="nav-section" key={sec.section}>
            <div className="nav-heading">
              <span>{sec.section}</span>
            </div>
            <nav className="nav">
              {sec.items.map((item) => {
                const count = counters[item.path];
                const pill = count ? String(count) : item.badge;
                return (
                  <Tooltip key={item.id} content={collapsed ? item.label : undefined} side="right"><NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        'nav-item',
                        !isActive && NESTED_PATHS[item.path] && pathname.startsWith(NESTED_PATHS[item.path]) && 'is-nested',
                      )
                    }
                  >
                    {({ isActive: own }) => {
                      const nested = NESTED_PATHS[item.path];
                      const isActive = own || Boolean(nested && pathname.startsWith(nested));
                      return (
                        <>
                          {isActive ? (
                            <motion.span
                              layoutId="nav-active"
                              className="nav-active-bg"
                              transition={spring.snappy}
                              aria-hidden
                            />
                          ) : null}
                          <Icon name={item.icon} />
                          <span className="nav-label">{item.label}</span>
                          {pill ? (
                            <span className={cx('nav-pill', count ? 'is-count' : null)}>{pill}</span>
                          ) : null}
                        </>
                      );
                    }}
                  </NavLink></Tooltip>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <Tooltip content={collapsed ? 'Asistente operativo' : undefined} side="right"><button
          type="button"
          className="assistant-trigger"
          onClick={onAssistant}
        >
          <span className="assistant-trigger-icon">
            <Icon name="spark" />
          </span>
          <span className="assistant-trigger-text">
            <strong>Asistente operativo</strong>
            <small>Consulta stock, espacio y prioridades</small>
          </span>
        </button></Tooltip>

        <div className="sidebar-user">
          <Tooltip content={user.name} side="right"><div className="avatar">
            {user.initials}
          </div></Tooltip>
          <Tooltip content={user.email || undefined} side="right"><div className="sidebar-user-text">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div></Tooltip>
          <IconButton tooltipSide="right" icon="logout" label="Cerrar sesión" className="sidebar-logout" onClick={onLogout} />
        </div>
      </div>
    </aside>
  );
}
