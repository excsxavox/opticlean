import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { activeWarehouseId, num } from '../../shared/lib/inventory';
import { downloadCSV } from '../../shared/lib/csv';
import { Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import type { AppState } from '../../shared/types';
import { InventoryDetailPanel } from './InventoryDetailPanel';
import { InventoryProductForm } from './InventoryProductForm';
import { buildInventoryRows, filterInventoryRows, inventoryStatusLabels, type InventoryFilter, type InventoryRow, type InventorySort } from './inventoryModel';
import '../../styles/inventory.css';

const PAGE_SIZE = 25;
const statusOptions: { value: InventoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'attention', label: 'Por reponer' },
  { value: 'unavailable', label: 'Sin disponibilidad' },
  { value: 'reserved', label: 'Con reservas' },
  { value: 'healthy', label: 'En nivel mínimo o superior' },
  { value: 'low', label: 'Bajo mínimo' },
];
const sortOptions: { value: InventorySort; label: string }[] = [
  { value: 'attention', label: 'Prioridad de reposición' },
  { value: 'name', label: 'Nombre: A–Z' },
  { value: 'stock-desc', label: 'Mayor stock físico' },
  { value: 'available-asc', label: 'Menor disponibilidad' },
  { value: 'value-desc', label: 'Mayor valor a PVP' },
];
const categoryStyle = (category: string) => {
  const styles: Record<string, { icon: string; tone: string }> = {
    Hogar: { icon: 'home', tone: 'violet' },
    Industrial: { icon: 'building', tone: 'blue' },
    Institucional: { icon: 'box', tone: 'teal' },
    Hospitalaria: { icon: 'shield', tone: 'cyan' },
  };
  return styles[category] ?? { icon: 'box', tone: 'blue' };
};

export function InventoryPage() {
  const { state, meta, toast } = useAppState();
  if (!state || !meta) return null;
  return <InventoryWorkspace state={state} categories={meta.categories} toast={toast} />;
}

export function InventoryWorkspace({ state, categories, toast }: {
  state: AppState;
  categories: string[];
  toast: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(params.get('proveedor') || params.get('estado')));
  const inspector = useRef<HTMLElement>(null);
  const query = params.get('q') ?? '';
  const category = params.get('linea') ?? '';
  const supplier = params.get('proveedor') ?? '';
  const status = statusOptions.find((option) => option.value === params.get('estado'))?.value ?? 'all';
  const sort = sortOptions.find((option) => option.value === params.get('orden'))?.value ?? 'attention';
  const allRows = useMemo(() => buildInventoryRows(state), [state]);
  const rows = useMemo(() => filterInventoryRows(allRows, { query, category, supplier, status, sort }), [allRows, query, category, supplier, status, sort]);
  const warehouse = state.warehouses.find((site) => site.id === activeWarehouseId(state));
  const warehouseName = warehouse?.name ?? state.settings.warehouse;
  const categoryNames = [...new Set([...categories, ...state.products.map((p) => p.category)])];
  const suppliers = [...new Set(state.products.map((p) => p.supplier))].sort((a, b) => a.localeCompare(b, 'es'));
  const attention = useMemo(() => filterInventoryRows(allRows, { status: 'attention' }), [allRows]);
  const totals = allRows.reduce((sum, row) => ({ stock: sum.stock + row.stock, available: sum.available + row.available, reserved: sum.reserved + row.reserved }), { stock: 0, available: 0, reserved: 0 });
  const unavailableCount = allRows.filter((row) => row.status === 'unavailable').length;
  const hasFilters = Boolean(query || category || supplier || status !== 'all');
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const requestedPage = Number(params.get('pagina'));
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = rows.find((row) => row.product.id === selectedId);

  const updateParams = (patch: Record<string, string>, resetPage = true) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      if (resetPage) next.delete('pagina');
      return next;
    }, { replace: true });
  };
  const resetFilters = () => updateParams({ q: '', linea: '', proveedor: '', estado: '' });
  const selectProduct = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia('(max-width: 1350px)').matches) {
      requestAnimationFrame(() => inspector.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const receive = (id: string) => navigate('/recepcion', { state: { productId: id } });
  const locate = (id: string, loc?: string) => navigate('/bodega', { state: loc ? { loc, productId: id } : { productId: id } });
  const exportRows = () => {
    downloadCSV('OPTICLEAN_Inventario_filtrado.csv', [
      ['Bodega', 'Código', 'SKU', 'Producto', 'Línea', 'Proveedor', 'Físico', 'Reservado', 'Disponible', 'Mínimo', 'Estado', 'Ubicaciones', 'PVP', 'Valor a PVP'],
      ...rows.map((row) => [warehouseName, row.product.id, row.product.sku, row.product.name, row.product.category, row.product.supplier, row.stock, row.reserved, row.available, row.product.min, inventoryStatusLabels[row.status], row.locations.join(' / '), row.product.price, row.stockValue.toFixed(2)]),
    ]);
    toast(`Se exportaron ${rows.length} productos de ${warehouseName}.`);
  };
  const quickFilters: { value: InventoryFilter; label: string; count: number }[] = [
    { value: 'all', label: 'Todos', count: allRows.length },
    { value: 'attention', label: 'Por reponer', count: attention.length },
    { value: 'reserved', label: 'Con reservas', count: allRows.filter((row) => row.reserved > 0).length },
  ];

  return (
    <div className="inv-page">
      <PageHead eyebrow="Control de existencias" title="Inventario" desc="Encuentra lo que necesitas. Anticípate a lo que falta." actions={<>
        <Btn icon="download" disabled={!rows.length} onClick={exportRows}>Exportar vista</Btn>
        <Btn variant="primary" icon="plus" onClick={() => setEditProduct('')}>Crear producto</Btn>
      </>} />

      <div className="inv-context">
        <span className="inv-context-icon"><Icon name="warehouse" /></span>
        <div><span>Bodega activa</span><strong>{warehouseName}</strong></div>
        {warehouse?.code && <span className="inv-warehouse-code">{warehouse.code}</span>}
        <button type="button" className="inv-text-button" onClick={() => navigate('/bodegas')}>Cambiar bodega <Icon name="chevron" /></button>
      </div>

      <section className="inv-metrics" aria-label="Resumen de la bodega activa">
        <button type="button" className="inv-metric" onClick={resetFilters}>
          <span className="inv-metric-label">Stock físico <Icon name="box" /></span>
          <strong>{num(totals.stock)}<small>uds.</small></strong>
          <span>{allRows.length} productos en el catálogo <Icon name="arrow" /></span>
        </button>
        <div className="inv-metric inv-metric-available">
          <span className="inv-metric-label">Disponible para pedidos <Icon name="check" /></span>
          <strong>{num(totals.available)}<small>uds.</small></strong>
          <span>Stock físico menos reservas</span>
        </div>
        <button type="button" className={`inv-metric ${status === 'reserved' ? 'is-active' : ''}`} onClick={() => updateParams({ estado: status === 'reserved' ? '' : 'reserved' })}>
          <span className="inv-metric-label">Unidades reservadas <Icon name="orders" /></span>
          <strong>{num(totals.reserved)}<small>uds.</small></strong>
          <span>En pedidos por preparar <Icon name="arrow" /></span>
        </button>
        <button type="button" className={`inv-metric inv-metric-attention ${status === 'attention' ? 'is-active' : ''}`} onClick={() => updateParams({ estado: status === 'attention' ? '' : 'attention' })}>
          <span className="inv-metric-label">Necesitan reposición <Icon name="alert" /></span>
          <strong>{attention.length}<small>productos</small></strong>
          <span>{unavailableCount ? `${unavailableCount} sin disponibilidad` : attention.length ? 'Revisa los niveles mínimos' : 'Todos los niveles en orden'} <Icon name="arrow" /></span>
        </button>
      </section>

      <div className="inv-category-nav" role="group" aria-label="Filtrar por línea">
        <button type="button" className={`inv-category ${!category ? 'is-active' : ''}`} aria-pressed={!category} onClick={() => updateParams({ linea: '' })}><Icon name="layers" /> Todas las líneas <span>{allRows.length}</span></button>
        {categoryNames.map((name) => <button type="button" key={name} className={`inv-category inv-tone-${categoryStyle(name).tone} ${category === name ? 'is-active' : ''}`} aria-pressed={category === name} onClick={() => updateParams({ linea: category === name ? '' : name })}><Icon name={categoryStyle(name).icon} /> {name} <span>{allRows.filter((row) => row.product.category === name).length}</span></button>)}
      </div>

      <div className={`inv-workspace ${selected ? 'has-selection' : ''}`}>
        <section className="inv-browser" aria-labelledby="inv-products-heading">
          <div className="inv-browser-heading">
            <h2 id="inv-products-heading">Productos <span>{allRows.length}</span></h2>
            <div className="inv-search"><Icon name="search" /><input type="search" aria-label="Buscar en inventario" placeholder="Buscar producto, código, proveedor o ubicación…" value={query} onChange={(event) => updateParams({ q: event.target.value })} />{query && <button type="button" aria-label="Borrar búsqueda" onClick={() => updateParams({ q: '' })}><Icon name="close" /></button>}</div>
            <button type="button" className="inv-filter-toggle" aria-expanded={filtersOpen} aria-controls="inv-extra-filters" onClick={() => setFiltersOpen((open) => !open)}>Filtros{supplier && <span className="inv-filter-indicator" aria-label="Proveedor filtrado" />}<Icon name="chevron" /></button>
          </div>
          <div className="inv-tools">
            <div id="inv-extra-filters" className="inv-filter-fields" hidden={!filtersOpen}>
              <label>Proveedor<select value={supplier} onChange={(event) => updateParams({ proveedor: event.target.value })}><option value="">Todos los proveedores</option>{suppliers.map((name) => <option key={name}>{name}</option>)}</select></label>
              <label>Estado<select value={status} onChange={(event) => updateParams({ estado: event.target.value === 'all' ? '' : event.target.value })}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
            <div className="inv-filter-bottom">
              <div className="inv-quick-filters" role="group" aria-label="Filtros rápidos">{quickFilters.map((filter) => <button type="button" key={filter.value} aria-pressed={status === filter.value} onClick={() => updateParams({ estado: filter.value === 'all' ? '' : filter.value })}>{filter.label}<span>{filter.count}</span></button>)}</div>
              <div className="inv-sort"><label>Ordenar por <select aria-label="Ordenar productos" value={sort} onChange={(event) => updateParams({ orden: event.target.value === 'attention' ? '' : event.target.value })}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
            </div>
          </div>
          <div className="inv-results-bar">
            <span role="status">{rows.length} de {allRows.length} productos{category ? ` · ${category}` : ''}{status !== 'all' ? ` · ${statusOptions.find((option) => option.value === status)?.label}` : ''}{supplier ? ` · ${supplier}` : ''}</span>
            {hasFilters ? <button type="button" className="inv-text-button" onClick={resetFilters}><Icon name="close" /> Limpiar filtros</button> : <span className="inv-list-hint">Selecciona un producto para ver el detalle</span>}
          </div>
          {rows.length ? <>
            <div className="inv-table-scroll"><table className="inv-table">
              <caption className="inv-sr-only">Productos de {warehouseName}. Selecciona un producto para ver sus ubicaciones y lotes.</caption>
              <thead><tr><th scope="col">Producto</th><th scope="col">Prioridad</th><th scope="col" className="inv-number">Disponible</th><th scope="col" className="inv-number inv-col-secondary">Físico</th><th scope="col" className="inv-number inv-col-secondary">Reservado</th><th scope="col" className="inv-col-location">Ubicación</th><th scope="col" className="inv-col-actions">Acciones</th></tr></thead>
              <tbody>{visibleRows.map((row) => <tr key={row.product.id} className={`inv-row-${row.status} ${selected?.product.id === row.product.id ? 'is-selected' : ''}`}>
                <td><button type="button" className="inv-table-product" onClick={() => selectProduct(row.product.id)} aria-label={`Ver detalle de ${row.product.name}`} aria-pressed={selected?.product.id === row.product.id}><span><strong>{row.product.name}</strong><small>{row.product.id} · {row.product.category}<span className="inv-product-supplier"> · {row.product.supplier}</span></small></span></button></td>
                <td><StockPriority row={row} /><small className="inv-table-min">{row.status === 'unavailable' ? 'Sin disponibilidad' : row.shortage > 0 ? `Faltan ${num(row.shortage)} uds.` : `Mín. ${num(row.product.min)} uds.`}</small></td>
                <td className={`inv-number inv-available-${row.status}`}><strong>{num(row.available)}</strong></td><td className="inv-number inv-col-secondary">{num(row.stock)}</td><td className="inv-number inv-muted inv-col-secondary">{num(row.reserved)}</td>
                <td className="inv-col-location">{row.locations.length ? <button type="button" className="inv-location-link" aria-label={`Localizar ${row.product.name} en la bodega`} onClick={() => locate(row.product.id)}><Icon name="pin" /><span>{row.locations[0]}</span>{row.locations.length > 1 && <small title={`${row.locations.length} ubicaciones`}>+{row.locations.length - 1}</small>}</button> : <span className="inv-muted">Sin ubicación</span>}</td>
                <td className="inv-col-actions"><div className="inv-table-actions"><button type="button" title="Registrar entrada" aria-label={`Registrar entrada de ${row.product.name}`} onClick={() => receive(row.product.id)}><Icon name="receive" /></button><button type="button" title="Ver detalle" aria-label={`Abrir detalle de ${row.product.name}`} onClick={() => selectProduct(row.product.id)}><Icon name="chevron" /></button></div></td>
              </tr>)}</tbody>
            </table></div>
            <div className="inv-pagination"><span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} de {rows.length} productos</span><div><button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => updateParams({ pagina: String(page - 1) }, false)}><Icon name="back" /></button><span>{page} / {pageCount}</span><button type="button" aria-label="Página siguiente" disabled={page >= pageCount} onClick={() => updateParams({ pagina: String(page + 1) }, false)}><Icon name="arrow" /></button></div></div>
          </> : <div className="inv-empty"><span><Icon name={allRows.length ? 'search' : 'box'} /></span><h3>{allRows.length ? 'No hay productos con estos filtros' : 'Tu inventario empieza aquí'}</h3><p>{allRows.length ? 'Prueba otro nombre, código o ubicación, o limpia los filtros para ver el catálogo completo.' : 'Crea tu primer producto y registra una entrada para asignarle stock y ubicación.'}</p><Btn variant="primary" icon={allRows.length ? 'refresh' : 'plus'} onClick={allRows.length ? resetFilters : () => setEditProduct('')}>{allRows.length ? 'Limpiar filtros' : 'Crear primer producto'}</Btn></div>}
        </section>

        {selected && <aside ref={inspector} className="inv-inspector" aria-label="Detalle del producto">
          <InventoryDetailPanel key={selected.product.id} row={selected} onClose={() => setSelectedId(null)} onEdit={() => setEditProduct(selected.product.id)} onReceive={() => receive(selected.product.id)} onLocate={(loc) => locate(selected.product.id, loc)} onTrace={() => navigate('/trazabilidad', { state: { q: selected.product.id } })} />
        </aside>}
      </div>
      <p className="inv-reservation-note"><Icon name="info" />Las reservas corresponden a los pedidos por preparar de la operación.</p>

      {editProduct !== null && <InventoryProductForm key={editProduct || 'new'} product={state.products.find((p) => p.id === editProduct)} categories={categoryNames} products={state.products} onClose={() => setEditProduct(null)} onSaved={(id) => { setEditProduct(null); resetFilters(); setSelectedId(id); }} />}
    </div>
  );
}

function StockPriority({ row }: { row: InventoryRow }) {
  const labels = { unavailable: 'Urgente', low: 'Reponer', healthy: 'En nivel' };
  return <span className={`inv-stock-status ${row.status}`}><i />{labels[row.status]}</span>;
}
