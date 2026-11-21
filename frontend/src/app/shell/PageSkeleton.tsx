import { useLocation } from 'react-router-dom';

export type SkeletonVariant = 'dashboard' | 'table' | 'form' | 'split';

function variantForPath(path: string): SkeletonVariant {
  if (path === '/' || path === '') return 'dashboard';
  if (
    path.startsWith('/pedidos/nuevo') ||
    path.startsWith('/reglas') ||
    path.startsWith('/configuracion') ||
    path.startsWith('/recepcion')
  )
    return 'form';
  if (
    path.startsWith('/clientes') ||
    path.startsWith('/proveedores') ||
    path.startsWith('/cotizaciones') ||
    path.startsWith('/empaque') ||
    path.startsWith('/plan') ||
    path.startsWith('/bodegas') ||
    path.startsWith('/logistica') ||
    path.startsWith('/inventario') ||
    path.startsWith('/bodega')
  )
    return 'split';
  return 'table';
}

function HeadBones() {
  return (
    <div className="page-skeleton-head">
      <span className="skeleton" style={{ width: 110, height: 10 }} />
      <span className="skeleton" style={{ width: 260, height: 28 }} />
      <span className="skeleton" style={{ width: 340, height: 12 }} />
    </div>
  );
}

function KpiBones({ count = 4 }: { count?: number }) {
  return (
    <div className="page-skeleton-kpis">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="page-skeleton-kpi">
          <span className="skeleton" style={{ width: '42%', height: 10 }} />
          <span className="skeleton" style={{ width: '55%', height: 28, marginTop: 14 }} />
          <span className="skeleton" style={{ width: '70%', height: 10, marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

function TableBones({ rows = 6 }: { rows?: number }) {
  return (
    <div className="page-skeleton-panel">
      <div className="page-skeleton-panel-head">
        <span className="skeleton" style={{ width: 180, height: 14 }} />
        <span className="skeleton" style={{ width: 160, height: 28 }} />
      </div>
      <div className="page-skeleton-table-head">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="skeleton" style={{ height: 10 }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="page-skeleton-row">
          <span className="skeleton" style={{ width: '70%', height: 12 }} />
          <span className="skeleton" style={{ width: '85%', height: 12 }} />
          <span className="skeleton" style={{ width: '50%', height: 12 }} />
          <span className="skeleton" style={{ width: 72, height: 22 }} />
          <span className="skeleton" style={{ width: 84, height: 28 }} />
        </div>
      ))}
    </div>
  );
}

function SideBones() {
  return (
    <div className="page-skeleton-panel page-skeleton-side">
      <span className="skeleton" style={{ width: 140, height: 14 }} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="page-skeleton-side-item">
          <span className="skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
          <div>
            <span className="skeleton" style={{ width: '80%', height: 12 }} />
            <span className="skeleton" style={{ width: '55%', height: 10, marginTop: 8 }} />
            <span className="skeleton" style={{ width: 110, height: 10, marginTop: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FormBones() {
  return (
    <div className="page-skeleton-form">
      <div className="page-skeleton-panel">
        <span className="skeleton" style={{ width: 120, height: 14 }} />
        <span className="skeleton" style={{ height: 42, marginTop: 14 }} />
        <span className="skeleton" style={{ height: 88, marginTop: 12 }} />
        <div className="page-skeleton-form-grid">
          <span className="skeleton" style={{ height: 42 }} />
          <span className="skeleton" style={{ height: 42 }} />
          <span className="skeleton" style={{ height: 42 }} />
          <span className="skeleton" style={{ height: 42 }} />
        </div>
      </div>
      <div className="page-skeleton-panel">
        <span className="skeleton" style={{ width: 160, height: 14 }} />
        <span className="skeleton" style={{ height: 72, marginTop: 14 }} />
        <span className="skeleton" style={{ height: 120, marginTop: 12 }} />
      </div>
    </div>
  );
}

/** Esqueleto de pantalla: carga diferida y cambio de ruta. */
export function PageSkeleton({ variant }: { variant?: SkeletonVariant }) {
  const path = useLocation().pathname;
  const kind = variant ?? variantForPath(path);

  return (
    <div className={`page-skeleton is-${kind}`} aria-busy="true" aria-label="Cargando pantalla">
      <HeadBones />
      {kind === 'dashboard' || kind === 'table' || kind === 'split' ? <KpiBones /> : null}
      {kind === 'dashboard' || kind === 'split' ? (
        <div className="page-skeleton-split">
          <TableBones rows={kind === 'dashboard' ? 6 : 8} />
          <SideBones />
        </div>
      ) : null}
      {kind === 'table' ? <TableBones rows={8} /> : null}
      {kind === 'form' ? <FormBones /> : null}
    </div>
  );
}

/** Skeleton a pantalla completa (auth / estado inicial). */
export function AppSkeleton({ label = 'Cargando operación…' }: { label?: string }) {
  return (
    <div className="app-skeleton" role="status" aria-busy="true" aria-label={label}>
      <aside className="app-skeleton-side" aria-hidden>
        <span className="skeleton" style={{ width: 140, height: 28 }} />
        <span className="skeleton" style={{ width: 72, height: 8, marginTop: 28 }} />
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="skeleton" style={{ height: 36, marginTop: 8 }} />
        ))}
      </aside>
      <div className="app-skeleton-main">
        <div className="app-skeleton-top">
          <span className="skeleton" style={{ width: 180, height: 14 }} />
          <span className="skeleton" style={{ width: 220, height: 36 }} />
        </div>
        <div className="app-skeleton-page">
          <PageSkeleton variant="dashboard" />
        </div>
      </div>
    </div>
  );
}
