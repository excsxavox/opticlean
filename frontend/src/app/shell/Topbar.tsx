import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '../../shared/components/Icon';
import { SearchInput } from '../../shared/components/SearchInput';
import type { Crumb } from '../navigation';

const today = new Intl.DateTimeFormat('es-EC', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Guayaquil',
});

type Props = {
  crumbs: Crumb[];
  /** Clave de la ruta actual: anima la miga final al cambiar de pantalla. */
  routeKey: string;
  collapsed: boolean;
  hasNotifications: boolean;
  onToggleSidebar: () => void;
  onOpenMobileMenu: () => void;
  onNotifications: () => void;
  onSearch: (query: string) => void;
};

export function Topbar({
  crumbs,
  routeKey,
  collapsed,
  hasNotifications,
  onToggleSidebar,
  onOpenMobileMenu,
  onNotifications,
  onSearch,
}: Props) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggleSidebar}
        aria-label={collapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
      >
        <motion.span animate={{ rotate: collapsed ? 180 : 0 }} style={{ display: 'inline-flex' }}>
          <Icon name="chevron-left" />
        </motion.span>
      </button>

      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn mobile-menu"
          aria-label="Abrir menú"
          onClick={onOpenMobileMenu}
        >
          <Icon name="menu" />
        </button>
        <nav className="breadcrumbs" aria-label="Ruta de navegación">
          <ol>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <Fragment key={`${c.label}-${i}`}>
                  {i > 0 ? (
                    <li className="breadcrumbs-sep" aria-hidden>
                      <Icon name="chevron" />
                    </li>
                  ) : null}
                  <li className={last ? 'is-current' : undefined}>
                    {last ? (
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.strong
                          key={routeKey}
                          aria-current="page"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                        >
                          {c.label}
                        </motion.strong>
                      </AnimatePresence>
                    ) : c.to ? (
                      <Link to={c.to}>{c.label}</Link>
                    ) : (
                      <span>{c.label}</span>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>
      </div>

      <div className="top-tools">
        <form
          className="top-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get('query')?.toString().trim() ?? '';
            onSearch(q);
          }}
        >
          <SearchInput
            name="query"
            shortcut
            size="small"
            placeholder="Buscar producto, pedido o cliente…"
            aria-label="Buscar en la operación"
            autoComplete="off"
          />
        </form>
        <span className="date-label">
          <Icon name="calendar" />
          {today.format(new Date())}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Ver notificaciones"
          onClick={onNotifications}
        >
          <Icon name="bell" />
          {hasNotifications ? <span className="notification-dot" /> : null}
        </button>
      </div>
    </header>
  );
}
