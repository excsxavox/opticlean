import { matchPath } from 'react-router-dom';
import type { AuthUser } from '../shared/auth/session';
import { canAccessPath } from '../shared/auth/permissions';

export type MenuItem = {
  id: string;
  label: string;
  path: string;
  icon: string;
  badge: string | null;
};

export type MenuSection = { section: string; items: MenuItem[] };

type RouteMeta = {
  /** Título de la pantalla (miga final y título de la pestaña). */
  title: string;
  /** Ruta padre para pantallas de detalle / sub-flujo (p. ej. Nuevo pedido → Pedidos). */
  parent?: string;
};

/** Metadatos de cada ruta. Fuente única para breadcrumbs y document.title. */
export const routeMeta: Record<string, RouteMeta> = {
  '/': { title: 'Inicio' },
  '/inventario': { title: 'Inventario' },
  '/recepcion': { title: 'Recepción' },
  '/recepcion/nueva': { title: 'Registrar recepción', parent: '/recepcion' },
  '/bodega': { title: 'Bodega visual' },
  '/bodegas': { title: 'Bodegas' },
  '/familias': { title: 'Familias' },
  '/pedidos': { title: 'Pedidos' },
  '/pedidos/nuevo': { title: 'Nuevo pedido', parent: '/pedidos' },
  '/cotizaciones': { title: 'Cotizaciones', parent: '/pedidos' },
  '/cotizaciones/nueva': { title: 'Nueva', parent: '/cotizaciones' },
  '/empaque': { title: 'Empaque' },
  '/plan': { title: 'Plan de mañana' },
  '/entrega': { title: 'Código de entrega' },
  '/compras': { title: 'Abastecimiento' },
  '/logistica': { title: 'Logística' },
  '/logistica/rutas': { title: 'Mi ruta', parent: '/logistica' },
  '/logistica/historial': { title: 'Historial de rutas', parent: '/logistica' },
  '/clientes': { title: 'Clientes' },
  '/proveedores': { title: 'Proveedores' },
  '/comercial': { title: 'Comercial' },
  '/trazabilidad': { title: 'Trazabilidad' },
  '/reportes': { title: 'Reportes' },
  '/reglas': { title: 'Reglas de negocio' },
  '/usuarios': { title: 'Usuarios' },
  '/configuracion': { title: 'Configuración' },
};

/** Menú usado si la API de menú no responde. Sigue el mismo recorrido que la semilla. */
export const fallbackMenu: MenuSection[] = [
  {
    section: 'Operación',
    items: [
      { id: 'f-home', label: 'Inicio', path: '/', icon: 'home', badge: null },
      { id: 'f-inv', label: 'Inventario', path: '/inventario', icon: 'box', badge: null },
      { id: 'f-rec', label: 'Recepción', path: '/recepcion', icon: 'receive', badge: null },
      { id: 'f-ped', label: 'Pedidos', path: '/pedidos', icon: 'orders', badge: null },
      { id: 'f-pack', label: 'Empaque', path: '/empaque', icon: 'cube', badge: null },
      { id: 'f-log', label: 'Logística', path: '/logistica', icon: 'truck', badge: null },
      { id: 'f-route', label: 'Mi ruta', path: '/logistica/rutas', icon: 'route', badge: null },
      { id: 'f-hist', label: 'Historial rutas', path: '/logistica/historial', icon: 'history', badge: null },
      { id: 'f-trace', label: 'Trazabilidad', path: '/trazabilidad', icon: 'route', badge: null },
    ],
  },
  {
    section: 'Abastecimiento',
    items: [
      { id: 'f-buy', label: 'Abastecimiento', path: '/compras', icon: 'cart', badge: null },
      { id: 'f-sup', label: 'Proveedores', path: '/proveedores', icon: 'building', badge: null },
    ],
  },
  {
    section: 'Bodega',
    items: [
      { id: 'f-wh', label: 'Bodegas', path: '/bodegas', icon: 'building', badge: null },
      { id: 'f-bod', label: 'Bodega visual', path: '/bodega', icon: 'warehouse', badge: null },
      { id: 'f-fam', label: 'Familias', path: '/familias', icon: 'layers', badge: null },
    ],
  },
  {
    section: 'Gestión',
    items: [
      { id: 'f-plan', label: 'Plan de mañana', path: '/plan', icon: 'calendar', badge: null },
      { id: 'f-cli', label: 'Clientes', path: '/clientes', icon: 'users', badge: null },
      { id: 'f-com', label: 'Comercial', path: '/comercial', icon: 'orders', badge: null },
      { id: 'f-rep', label: 'Reportes', path: '/reportes', icon: 'chart', badge: null },
      { id: 'f-rules', label: 'Reglas de negocio', path: '/reglas', icon: 'shield', badge: null },
      { id: 'f-users', label: 'Usuarios', path: '/usuarios', icon: 'users', badge: null },
      { id: 'f-cfg', label: 'Configuración', path: '/configuracion', icon: 'settings', badge: null },
    ],
  },
];

export type Crumb = { label: string; to?: string };

function metaFor(path: string): { key: string; meta: RouteMeta } | null {
  for (const key of Object.keys(routeMeta)) {
    if (matchPath({ path: key, end: true }, path)) return { key, meta: routeMeta[key] };
  }
  return null;
}

/** Título de la pantalla para una ruta (usa el menú si la ruta no tiene metadatos). */
export function titleFor(path: string, menu: MenuSection[]): string {
  const hit = metaFor(path);
  if (hit) return hit.meta.title;
  for (const sec of menu) {
    const item = sec.items.find((i) => i.path === path);
    if (item) return item.label;
  }
  return 'Operación';
}

/**
 * Migas de pan: Sección del menú › [Padre] › Pantalla.
 * La sección sale del menú (API), así respeta la configuración de cada empresa.
 */
export function breadcrumbsFor(path: string, menu: MenuSection[]): Crumb[] {
  // Sube por los padres: Nueva › Cotizaciones › Pedidos.
  const parents: string[] = [];
  let next = metaFor(path)?.meta.parent;
  while (next && !parents.includes(next)) {
    parents.unshift(next);
    next = metaFor(next)?.meta.parent;
  }
  const chain: Crumb[] = [];
  const sectionPath = parents[0] ?? path;
  const section = menu.find((s) => s.items.some((i) => i.path === sectionPath));
  if (section) chain.push({ label: section.section });
  for (const parent of parents) chain.push({ label: titleFor(parent, menu), to: parent });
  chain.push({ label: titleFor(path, menu) });
  return chain;
}

/** Pantalla de entrada según el puesto. Administración abre el resumen. */
export function homeForRole(role?: string) {
  if (role === 'driver') return '/logistica/rutas';
  if (role === 'dispatch') return '/logistica';
  if (role === 'ops') return '/bodega';
  return '/';
}

/**
 * El menú muestra solo lo que los permisos del JWT permiten.
 * Administración ve todo. Sin usuario, se muestra el menú completo (guest shell).
 */
export function menuForRole(sections: MenuSection[], roleOrUser?: string | AuthUser | null): MenuSection[] {
  const user =
    typeof roleOrUser === 'object' && roleOrUser
      ? roleOrUser
      : roleOrUser
        ? ({ role: roleOrUser } as AuthUser)
        : null;
  if (!user) return sections;
  if (user.role === 'admin') return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessPath(user, item.path)),
    }))
    .filter((section) => section.items.length > 0);
}

export function roleAllowsPath(roleOrUser: string | AuthUser | null | undefined, path: string) {
  if (!roleOrUser) return true;
  const user =
    typeof roleOrUser === 'object'
      ? roleOrUser
      : ({ role: roleOrUser } as AuthUser);
  return canAccessPath(user, path);
}
