import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Icon } from '../shared/components/Icon';
import { useAppState } from '../shared/hooks/AppStateProvider';
import { useAuth } from '../shared/hooks/AuthProvider';
import { api } from '../shared/api/client';
import { available } from '../shared/lib/inventory';
import { Modal } from '../shared/components/Modal';
import { cx } from '../shared/components/ui';
import { transition } from '../shared/motion/presets';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { PageSkeleton } from './shell/PageSkeleton';
import { breadcrumbsFor, fallbackMenu, homeForRole, menuForRole, roleAllowsPath, titleFor, type MenuSection } from './navigation';

const ROUTE_SKELETON_MS = 160;

function PageFrame() {
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    setBusy(true);
    const t = window.setTimeout(() => setBusy(false), ROUTE_SKELETON_MS);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    <>
      {busy ? <PageSkeleton /> : null}
      <div className={busy ? 'page-content is-pending' : 'page-content'} aria-hidden={busy}>
        <Suspense fallback={<PageSkeleton />}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.fast}
          >
            <Outlet />
          </motion.div>
        </Suspense>
      </div>
    </>
  );
}

const COLLAPSE_KEY = 'opticlean.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'OC'
  );
}

export function AppLayout() {
  const { state } = useAppState();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantAnswer, setAssistantAnswer] = useState<string[]>([]);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [menuSections, setMenuSections] = useState<MenuSection[]>(() =>
    menuForRole(
      user?.role === 'admin'
        ? fallbackMenu
        : fallbackMenu.map((s) => ({
            ...s,
            items: s.items.filter((i) => i.path !== '/usuarios'),
          })),
      user?.role,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .menu(user?.companyId)
      .then((res) => {
        if (cancelled || !res.sections?.length) return;
        let sections = res.sections.map((s) => ({
          section: s.section,
          items: s.items.map((i) => ({
            id: i.id,
            label: i.label,
            path: i.path,
            icon: i.icon,
            badge: i.badge,
          })),
        }));
        if (user?.role === 'admin') {
          const hasUsers = sections.some((s) => s.items.some((i) => i.path === '/usuarios'));
          if (!hasUsers) {
            sections = sections.map((s) =>
              s.section === 'Gestión'
                ? {
                    ...s,
                    items: [
                      ...s.items,
                      {
                        id: 'mi-users',
                        label: 'Usuarios',
                        path: '/usuarios',
                        icon: 'users',
                        badge: null,
                      },
                    ],
                  }
                : s,
            );
          }
        } else {
          sections = sections
            .map((s) => ({
              ...s,
              items: s.items.filter((i) => i.path !== '/usuarios'),
            }))
            .filter((s) => s.items.length > 0);
        }
        setMenuSections(menuForRole(sections, user?.role));
      })
      .catch(() => {
        /* mantiene menú fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.role]);

  const path = location.pathname;
  const crumbs = useMemo(() => breadcrumbsFor(path, menuSections), [path, menuSections]);

  useEffect(() => {
    document.title = `${titleFor(path, menuSections)} · OPTICLEAN AI`;
  }, [path, menuSections]);

  useEffect(() => {
    if (!roleAllowsPath(user?.role, path)) navigate(homeForRole(user?.role), { replace: true });
  }, [path, user?.role, navigate]);

  // Cierra el menú móvil al navegar.
  useEffect(() => setMobileOpen(false), [path]);

  const toggleCollapsed = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* sin almacenamiento: solo en memoria */
      }
      return !v;
    });

  if (!state) return null;

  const userName = user?.name || state.settings.operator || 'Operación';
  const pending = state.orders.filter((o) => o.status === 'Por preparar').length;
  const low = state.products.filter((p) => available(state, p.id) < p.min);
  const roleLabel =
    user?.role === 'admin'
      ? 'Administrador'
      : user?.role === 'dispatch'
        ? 'Despacho'
        : user?.role === 'driver'
          ? 'Conductor'
          : user?.role === 'ops'
            ? 'Operaciones'
            : 'Coordinación';

  return (
    <div className={cx('app-shell', collapsed && 'is-collapsed')}>
      <div
        className={cx('mobile-overlay', mobileOpen && 'open')}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />
      <Sidebar
        sections={menuSections}
        collapsed={collapsed && !mobileOpen}
        mobileOpen={mobileOpen}
        counters={{ '/pedidos': pending }}
        user={{
          name: userName,
          email: user?.email || '',
          role: roleLabel,
          initials: initialsOf(userName),
        }}
        onNavigate={() => setMobileOpen(false)}
        onAssistant={() => setAssistantOpen(true)}
        onLogout={() => {
          logout();
          navigate('/login', { replace: true });
        }}
      />
      <div className="main-shell">
        <Topbar
          crumbs={crumbs}
          routeKey={path}
          collapsed={collapsed}
          hasNotifications={pending > 0 || low.length > 0}
          onToggleSidebar={toggleCollapsed}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onNotifications={() => setNotifyOpen(true)}
          onSearch={(query) => {
            const q = query.trim().toLowerCase();
            if (!q) {
              navigate('/inventario');
              return;
            }
            const orderHit = state.orders.some(
              (order) => order.id.toLowerCase() === q || (q.startsWith('ped') && order.id.toLowerCase().includes(q)),
            );
            const clientHit = state.clients.some((item) =>
              [item.name, item.taxId, item.email, item.contact, item.phone].some((value) => value?.toLowerCase().includes(q)),
            );
            const supplierHit = (state.suppliers ?? []).some((item) =>
              [item.name, item.taxId, item.email, item.contact].some((value) => value?.toLowerCase().includes(q)),
            );
            const productHit = state.products.some((item) =>
              [item.name, item.sku, item.id].some((value) => value?.toLowerCase().includes(q)),
            );
            const encoded = encodeURIComponent(query.trim());
            if (orderHit) navigate(`/pedidos?q=${encoded}`);
            else if (supplierHit && !clientHit && !productHit) navigate(`/proveedores?q=${encoded}`);
            else if (clientHit && !productHit) navigate(`/clientes?q=${encoded}`);
            else navigate(`/inventario?q=${encoded}`);
          }}
        />
        <main className="page">
          <PageFrame />
          <footer className="page-footer">
            <span>OPTICLEAN AI · Operación conectada</span>
            <span>{state.demo === false ? 'Datos de la empresa' : 'Datos de demostración'} · Persistencia en servidor local</span>
          </footer>
        </main>
      </div>

      {assistantOpen ? (
        <Modal
          title="Asistente operativo"
          subtitle="Consultas rápidas sobre los datos de esta demostración."
          onClose={() => {
            setAssistantOpen(false);
            setAssistantAnswer([]);
          }}
        >
          <div className="suggestion-title" style={{ marginBottom: 15 }}>
            <Icon name="spark" />
            ¿Qué necesitas resolver?
          </div>
          {(['stock', 'warehouse', 'orders'] as const).map((q) => (
            <button
              key={q}
              type="button"
              className="assistant-prompt"
              onClick={async () => {
                const r = await api.assistant(q);
                setAssistantAnswer(r.lines);
              }}
            >
              {q === 'stock' && '¿Qué productos necesitan reposición?'}
              {q === 'warehouse' && '¿Cuánto espacio tengo en bodega?'}
              {q === 'orders' && '¿Qué debería preparar primero?'}
            </button>
          ))}
          {assistantAnswer.length ? (
            <div className="assistant-answer">
              {assistantAnswer.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          <p className="subtle" style={{ fontSize: 'var(--text-2xs)', marginTop: 17 }}>
            Respuestas calculadas con reglas locales. Sin conexión a un modelo de IA.
          </p>
        </Modal>
      ) : null}

      {notifyOpen ? (
        <Modal
          title="Notificaciones"
          subtitle="Pendientes de la operación actual."
          onClose={() => setNotifyOpen(false)}
        >
          <div className="notification-list">
            <div className="notice">
              <strong>{pending} pedidos por preparar</strong>
              Reserva confirmada. Consulta bodega para iniciar picking.
            </div>
            {low.map((p) => (
              <div className="notice" key={p.id}>
                <strong>Stock bajo · {p.name}</strong>
                {available(state, p.id)} unidades disponibles. Mínimo: {p.min}.
              </div>
            ))}
            <div className="notice">
              <strong>
                {state.orders.filter((o) => o.status === 'Preparado').length} pedidos preparados
              </strong>
              Listos para asignar al próximo despacho.
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
