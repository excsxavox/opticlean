import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, num } from '../../shared/lib/inventory';
import { childrenStatus, componentsOf, isRaw } from '../../shared/lib/bom';
import { downloadCSV } from '../../shared/lib/csv';
import { expiryAlerts } from '../../shared/lib/wholesale';
import { Badge, Btn, Kpi, KpiGrid, PageHead, Button } from '../../shared/components/ui';
import { Menu } from '../../shared/components/Menu';
import { Icon } from '../../shared/components/Icon';
import { SegmentedControl } from '../../shared/components/Tabs';
import type { AppState, Metrics } from '../../shared/types';
import { InventoryDetailPanel } from './InventoryDetailPanel';
import { InventoryOverview } from './InventoryOverview';
import { InventoryProductForm } from './InventoryProductForm';
import {
  buildInventoryRows,
  filterInventoryRows,
  inventoryStatusLabels,
  type InventoryFilter,
  type InventoryKindFilter,
  type InventoryRow,
  type InventorySort,
} from './inventoryModel';
import '../../styles/inventory.css';
import { Checkbox } from '../../shared/components/Checkbox';
import { ChipGroup } from '../../shared/components/Chip';
import { IconButton } from '../../shared/components/IconButton';
import { SearchInput } from '../../shared/components/SearchInput';

const PAGE_CHUNK = 10;
const statusOptions: { value: InventoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'attention', label: 'Por reponer' },
  { value: 'expiring', label: 'Por caducar' },
  { value: 'unavailable', label: 'Sin disponibilidad' },
  { value: 'reserved', label: 'Con reservas' },
  { value: 'healthy', label: 'En nivel mínimo o superior' },
  { value: 'low', label: 'Bajo mínimo' },
];
const sortOptions: { value: InventorySort; label: string }[] = [
  { value: 'attention', label: 'Prioridad' },
  { value: 'expiry', label: 'Caducidad más cercana' },
  { value: 'name', label: 'Nombre: A–Z' },
  { value: 'stock-desc', label: 'Mayor stock físico' },
  { value: 'available-asc', label: 'Menor disponibilidad' },
  { value: 'value-desc', label: 'Mayor valor a PVP' },
];

export function InventoryPage() {
  const { state, meta, toast, applyResponse } = useAppState();
  if (!state || !meta) return null;
  return (
    <InventoryWorkspace
      state={state}
      categories={meta.categories}
      toast={toast}
      applyResponse={applyResponse}
    />
  );
}

export function InventoryWorkspace({
  state,
  categories,
  toast,
  applyResponse,
}: {
  state: AppState;
  categories: string[];
  toast: (message: string) => void;
  applyResponse: (r: { state: AppState; metrics: Metrics }) => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(params.get('proveedor')));
  const [view, setView] = useState<'table' | 'lines'>('table');
  const [visibleCount, setVisibleCount] = useState(PAGE_CHUNK);
  const [whBusy, setWhBusy] = useState(false);
  const catalogRef = useRef<HTMLElement>(null);

  const query = params.get('q') ?? '';
  const category = params.get('linea') ?? '';
  const supplier = params.get('proveedor') ?? '';
  const status =
    statusOptions.find((option) => option.value === params.get('estado'))?.value ?? 'all';
  const kind = (
    ['finished', 'raw'].includes(params.get('tipo') ?? '') ? params.get('tipo') : 'all'
  ) as InventoryKindFilter;
  const sort =
    sortOptions.find((option) => option.value === params.get('orden'))?.value ?? 'attention';

  const allRows = useMemo(() => buildInventoryRows(state), [state]);
  const rows = useMemo(
    () => filterInventoryRows(allRows, { query, category, supplier, status, kind, sort }),
    [allRows, query, category, supplier, status, kind, sort],
  );
  const warehouse = state.warehouses.find((site) => site.id === activeWarehouseId(state));
  const warehouseName = warehouse?.name ?? state.settings.warehouse;
  const categoryNames = [...new Set([...categories, ...state.products.map((p) => p.category)])];
  const suppliers = [...new Set(state.products.map((p) => p.supplier))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
  const attention = useMemo(
    () => filterInventoryRows(allRows, { status: 'attention', kind }),
    [allRows, kind],
  );
  const finishedRows = useMemo(() => filterInventoryRows(allRows, { kind: 'finished' }), [allRows]);
  const rawRows = useMemo(() => filterInventoryRows(allRows, { kind: 'raw' }), [allRows]);
  const totals = allRows.reduce(
    (sum, row) => ({
      stock: sum.stock + row.stock,
      available: sum.available + row.available,
      reserved: sum.reserved + row.reserved,
    }),
    { stock: 0, available: 0, reserved: 0 },
  );
  const attentionFinished = attention.filter((r) => !isRaw(r.product)).length;
  const attentionRaw = attention.filter((r) => isRaw(r.product)).length;
  const unavailableCount = allRows.filter((row) => row.status === 'unavailable').length;
  const expiry = useMemo(() => expiryAlerts(state), [state]);
  const expiredCount = expiry.filter((item) => item.band === 'vencido').length;
  const soonCount = expiry.filter((item) => item.band !== 'vencido').length;
  const expiringProducts = useMemo(
    () => filterInventoryRows(allRows, { status: 'expiring', kind }),
    [allRows, kind],
  );
  const reservedCount = allRows.filter((row) => row.reserved > 0).length;
  const linkedBlocked = useMemo(
    () =>
      allRows.filter(
        (r) => !isRaw(r.product) && childrenStatus(state, r.product).some((c) => c.status !== 'ok'),
      ),
    [allRows, state],
  );
  const hasFilters = Boolean(query || category || supplier || status !== 'all' || kind !== 'all');
  const visibleRows = rows.slice(0, visibleCount);
  const selected =
    rows.find((row) => row.product.id === selectedId) ??
    allRows.find((row) => row.product.id === selectedId);
  const allVisibleChecked =
    visibleRows.length > 0 && visibleRows.every((r) => checked[r.product.id]);
  const someVisibleChecked =
    !allVisibleChecked && visibleRows.some((r) => checked[r.product.id]);

  const updateParams = (patch: Record<string, string>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(patch).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        );
        return next;
      },
      { replace: true },
    );
    setVisibleCount(PAGE_CHUNK);
  };
  const resetFilters = () =>
    updateParams({ q: '', linea: '', proveedor: '', estado: '', tipo: '' });
  const selectProduct = (id: string) => setSelectedId(id);
  const receive = (id: string) => navigate('/recepcion/nueva', { state: { productId: id } });
  const purchase = (id: string, qty?: number) =>
    navigate('/compras', {
      state: { productId: id, qty: qty && qty > 0 ? Math.ceil(qty) : undefined },
    });
  const locate = (id: string, loc?: string) =>
    navigate('/bodega', { state: loc ? { loc, productId: id } : { productId: id } });

  useEffect(() => {
    setVisibleCount(PAGE_CHUNK);
  }, [query, category, supplier, status, kind, sort]);

  const exportRows = () => {
    downloadCSV('OPTICLEAN_Inventario_filtrado.csv', [
      [
        'Bodega',
        'Tipo',
        'Código',
        'SKU',
        'Producto',
        'Línea',
        'Proveedor',
        'Físico',
        'Reservado',
        'Disponible',
        'Mínimo',
        'Estado',
        'Ubicaciones',
        'PVP',
        'Valor a PVP',
        'Costo promedio',
        'Valor a costo',
        'No vendible',
        'Insumos',
      ],
      ...rows.map((row) => [
        warehouseName,
        isRaw(row.product) ? 'Insumo' : 'Producto',
        row.product.id,
        row.product.sku,
        row.product.name,
        row.product.category,
        row.product.supplier,
        row.stock,
        row.reserved,
        row.available,
        row.product.min,
        inventoryStatusLabels[row.status],
        row.locations.join(' / '),
        row.product.price,
        row.saleValue.toFixed(2),
        (row.product.avgCost ?? 0).toFixed(4),
        row.stockValue.toFixed(2),
        row.unsellable,
        componentsOf(row.product)
          .map((c) => `${c.productId}×${c.qty}`)
          .join('; '),
      ]),
    ]);
    toast(`Se exportaron ${rows.length} ítems de ${warehouseName}.`);
  };

  const onWarehouseChange = async (value: string) => {
    if (!value || value === activeWarehouseId(state) || whBusy) return;
    setWhBusy(true);
    try {
      applyResponse(await api.activateWarehouse(value));
      const name = state.warehouses.find((w) => w.id === value)?.name ?? 'Bodega';
      toast(`${name} activa.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cambiar de bodega.');
    } finally {
      setWhBusy(false);
    }
  };

  const quickFilters: { value: InventoryFilter; label: string; count: number }[] = [
    { value: 'all', label: 'Todos', count: allRows.length },
    { value: 'attention', label: 'Por reponer', count: attention.length },
    { value: 'expiring', label: 'Por caducar', count: expiringProducts.length },
    { value: 'unavailable', label: 'Sin disponibilidad', count: unavailableCount },
    { value: 'reserved', label: 'Con reservas', count: reservedCount },
  ];

  const alertTotal = expiry.length + linkedBlocked.length;
  const expiryTitle = [
    expiredCount ? `${expiredCount} ${expiredCount === 1 ? 'lote vencido' : 'lotes vencidos'}` : '',
    soonCount ? `${soonCount} por vencer en ≤ 90 días` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const expiryHint = expiry[0]
    ? `${expiry[0].name} · ${expiry[0].loc} · ${
        expiry[0].days < 0 ? 'vencido' : `vence en ${expiry[0].days} días`
      }`
    : '';
  const showInCatalog = (patch: Record<string, string>) => {
    updateParams(patch);
    // Espera a que el menú se cierre y devuelva el foco antes de desplazar.
    window.setTimeout(
      () => catalogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    );
  };

  const toggleAllVisible = () => {
    const next = { ...checked };
    const turnOn = !allVisibleChecked;
    visibleRows.forEach((r) => {
      next[r.product.id] = turnOn;
    });
    setChecked(next);
  };

  return (
    <div className="inv-page inv-page-v2">
      <PageHead
        eyebrow="Control de stock"
        title="Inventario"
        desc="Stock físico, reservas y disponibilidad de productos e insumos por bodega."
        actions={
          <div className="inv-top-actions">
            <label className="inv-wh-select">
              <Icon name="building" />
              <Select
                value={activeWarehouseId(state)}
                disabled={whBusy}
                aria-label="Bodega"
                onChange={(e) => void onWarehouseChange(e.target.value)}
              >
                {state.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.code ? ` • ${w.code}` : ''}
                  </option>
                ))}
              </Select>
            </label>
            {alertTotal > 0 ? (
              <Menu
                label="Alertas de inventario"
                className="inv-alerts-menu"
                trigger={
                  <Button
                    icon="bell"
                    className="inv-alerts-btn"
                    aria-label={`Alertas de inventario: ${alertTotal}`}
                  >
                    Alertas
                    <span className={`inv-alerts-badge${expiredCount ? ' is-danger' : ''}`}>
                      {alertTotal > 99 ? '99+' : alertTotal}
                    </span>
                  </Button>
                }
                items={[
                  expiry.length > 0 && {
                    label: expiryTitle,
                    icon: 'calendar',
                    tone: expiredCount ? ('danger' as const) : undefined,
                    hint: expiryHint,
                    onSelect: () => showInCatalog({ estado: 'expiring', orden: 'expiry', tipo: '' }),
                  },
                  linkedBlocked.length > 0 && {
                    label: `${linkedBlocked.length} ${linkedBlocked.length === 1 ? 'producto vinculado' : 'productos vinculados'} a insumos bajo mínimo`,
                    icon: 'alert',
                    hint: 'Ver afectados en el catálogo',
                    onSelect: () => showInCatalog({ estado: 'attention', tipo: '' }),
                  },
                ]}
              />
            ) : null}
            <Btn icon="download" disabled={!rows.length} onClick={exportRows}>
              Exportar vista
            </Btn>
            <Menu
              label="Crear"
              trigger={
                <Button variant="primary" icon="plus" className="inv-create-btn">
                  Crear
                  <Icon name="chevron" className="ui-menu-chevron" />
                </Button>
              }
              items={[
                {
                  label: 'Nuevo producto',
                  icon: 'box',
                  hint: 'Ficha de producto o insumo',
                  onSelect: () => setEditProduct(''),
                },
                {
                  label: 'Registrar entrada',
                  icon: 'receive',
                  hint: 'Recepción de mercadería',
                  onSelect: () => navigate('/recepcion/nueva'),
                },
              ]}
            />
          </div>
        }
      />

      <KpiGrid label="Resumen de la bodega activa">
        <Kpi
          label="Stock físico"
          icon="box"
          value={num(totals.stock)}
          caption={`${finishedRows.length} productos · ${rawRows.length} insumos`}
          onClick={resetFilters}
        />
        <Kpi
          label="Reservado"
          icon="orders"
          value={num(totals.reserved)}
          caption="En pedidos por preparar"
          active={status === 'reserved'}
          onClick={() => updateParams({ estado: status === 'reserved' ? '' : 'reserved' })}
        />
        <Kpi
          label="Disponible"
          icon="check"
          tone="success"
          value={num(totals.available)}
          caption="Físico menos reservado"
        />
        <Kpi
          label="Por reponer"
          icon="alert"
          tone={attention.length ? 'warning' : 'default'}
          value={attention.length}
          caption={`${attentionFinished} ${attentionFinished === 1 ? 'producto' : 'productos'} · ${attentionRaw} ${attentionRaw === 1 ? 'insumo' : 'insumos'}`}
          active={status === 'attention'}
          onClick={() => updateParams({ estado: status === 'attention' ? '' : 'attention' })}
        />
        <Kpi
          label="Por caducar"
          icon="calendar"
          tone={expiry.length ? 'warning' : 'default'}
          value={expiringProducts.length}
          caption={
            expiry.length
              ? `${expiredCount} ${expiredCount === 1 ? 'lote vencido' : 'lotes vencidos'} · ${soonCount} ${soonCount === 1 ? 'lote' : 'lotes'} en 90 días`
              : 'Sin lotes en 90 días'
          }
          active={status === 'expiring'}
          onClick={() =>
            updateParams({
              estado: status === 'expiring' ? '' : 'expiring',
              orden: status === 'expiring' ? '' : 'expiry',
            })
          }
        />
      </KpiGrid>

      {view === 'lines' ? (
        <InventoryOverview
          state={state}
          rows={status === 'attention' ? rows : allRows}
          category={category}
          focusAttention={status === 'attention'}
          onSelectCategory={(value) =>
            updateParams({
              linea: value,
              tipo: value === 'Insumos' ? 'raw' : value ? 'finished' : kind === 'all' ? '' : kind,
            })
          }
          onSelectProduct={selectProduct}
          onFilterAttention={(nextKind) =>
            updateParams({ tipo: nextKind, estado: 'attention', linea: '' })
          }
          onReceive={receive}
          onPurchase={purchase}
        />
      ) : null}

      <div className="inv-workspace">
        <section ref={catalogRef} className="inv-browser" aria-labelledby="inv-products-heading">
          <div className="inv-browser-heading">
            <h2 id="inv-products-heading">
              Catálogo <span>{allRows.length}</span>
            </h2>
            <SegmentedControl
              label="Vista"
              value={view}
              onValueChange={setView}
              items={[
                { value: 'table', label: 'Tabla' },
                { value: 'lines', label: 'Por líneas' },
              ]}
            />
          </div>

          <div className="inv-toolbar">
            <SearchInput className="inv-search" aria-label="Buscar en inventario" placeholder="Buscar producto, insumo, código o ubicación…" value={query} onChange={(event) => updateParams({ q: event.target.value })} />
            <label className="inv-select">
              <span>Tipo</span>
              <Select
                value={kind}
                onChange={(e) =>
                  updateParams({ tipo: e.target.value === 'all' ? '' : e.target.value })
                }
              >
                <option value="all">Todos</option>
                <option value="finished">Productos</option>
                <option value="raw">Insumos</option>
              </Select>
            </label>
            <label className="inv-select">
              <span>Familia</span>
              <Select value={category} onChange={(e) => updateParams({ linea: e.target.value })}>
                <option value="">Todas</option>
                {categoryNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              className={`inv-more-filters ${filtersOpen || supplier ? 'is-active' : ''}`}
              aria-expanded={filtersOpen}
              data-state={filtersOpen ? 'open' : 'closed'}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Más filtros
              <Icon name="chevron" className="ui-menu-chevron" />
            </Button>
            <label className="inv-select inv-sort-select">
              <span>Orden</span>
              <Select
                aria-label="Ordenar productos"
                value={sort}
                onChange={(event) =>
                  updateParams({
                    orden: event.target.value === 'attention' ? '' : event.target.value,
                  })
                }
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {filtersOpen ? (
            <div className="inv-extra-filters" id="inv-extra-filters">
              <label>
                Proveedor
                <Select
                  value={supplier}
                  onChange={(event) => updateParams({ proveedor: event.target.value })}
                >
                  <option value="">Todos los proveedores</option>
                  {suppliers.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </label>
              {hasFilters ? (
                <Button variant="link" className="inv-text-button" onClick={resetFilters}>
                  <Icon name="close" /> Limpiar filtros
                </Button>
              ) : null}
            </div>
          ) : null}

          <ChipGroup
            type="single"
            label="Filtros rápidos"
            className="inv-quick-filters"
            value={status}
            onValueChange={(value) => updateParams({ estado: value === 'all' ? '' : value })}
            items={quickFilters.map((filter) => ({ value: filter.value, label: filter.label, count: filter.count }))}
          />

          {view === 'table' ? (
            rows.length ? (
              <>
                <div className="inv-table-scroll">
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th className="inv-col-check">
                          <Checkbox checked={allVisibleChecked} indeterminate={someVisibleChecked} onCheckedChange={() => toggleAllVisible()} aria-label="Seleccionar visibles" />
                        </th>
                        <th scope="col">Producto / Insumo</th>
                        <th scope="col">Estado</th>
                        <th scope="col" className="inv-number">
                          Físico
                        </th>
                        <th scope="col" className="inv-number">
                          Reservado
                        </th>
                        <th scope="col" className="inv-number">
                          Disponible
                        </th>
                        <th scope="col" className="inv-number">
                          Mínimo
                        </th>
                        <th scope="col" className="inv-col-location">
                          Ubicación
                        </th>
                        <th scope="col" className="inv-col-actions">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => {
                        const comps = childrenStatus(state, row.product);
                        const open = !!expanded[row.product.id];
                        const hasBom = comps.length > 0;
                        return (
                          <Fragment key={row.product.id}>
                            <tr
                              className={`inv-row-${row.status} ${
                                selected?.product.id === row.product.id ? 'is-selected' : ''
                              } ${isRaw(row.product) ? 'inv-row-raw' : ''}`}
                            >
                              <td className="inv-col-check">
                                <Checkbox checked={!!checked[row.product.id]} onCheckedChange={() => setChecked((c) => ({
                                      ...c,
                                      [row.product.id]: !c[row.product.id],
                                    }))} aria-label={`Seleccionar ${row.product.name}`} />
                              </td>
                              <td>
                                <div className="inv-table-product-wrap">
                                  {hasBom ? (
                                    <button
                                      type="button"
                                      className={`inv-expand ${open ? 'is-open' : ''}`}
                                      aria-expanded={open}
                                      aria-label={`${open ? 'Ocultar' : 'Ver'} insumos de ${row.product.name}`}
                                      onClick={() =>
                                        setExpanded((current) => ({
                                          ...current,
                                          [row.product.id]: !open,
                                        }))
                                      }
                                    >
                                      <Icon name="chevron" />
                                    </button>
                                  ) : (
                                    <span className="inv-expand-spacer" />
                                  )}
                                  <button
                                    type="button"
                                    className="inv-table-product"
                                    onClick={() => selectProduct(row.product.id)}
                                    aria-pressed={selected?.product.id === row.product.id}
                                  >
                                    <span>
                                      <strong>{row.product.name}</strong>
                                      <small>
                                        {row.product.id} ·{' '}
                                        {isRaw(row.product) ? 'Insumo' : 'Producto'}
                                        {row.product.category ? ` · ${row.product.category}` : ''}
                                      </small>
                                    </span>
                                  </button>
                                </div>
                              </td>
                              <td>
                                <StatusBadge row={row} />
                              </td>
                              <td className="inv-number">{num(row.stock)}</td>
                              <td className="inv-number inv-muted">{num(row.reserved)}</td>
                              <td className={`inv-number inv-available-${row.status}`}>
                                <strong>{num(row.available)}</strong>
                              </td>
                              <td className="inv-number">{num(row.product.min)}</td>
                              <td className="inv-col-location">
                                {row.locations.length ? (
                                  <button
                                    type="button"
                                    className="inv-location-link"
                                    aria-label={`Localizar ${row.product.name}`}
                                    onClick={() => locate(row.product.id)}
                                  >
                                    <Icon name="pin" />
                                    <span>{row.locations[0]}</span>
                                    {row.locations.length > 1 ? (
                                      <small>+{row.locations.length - 1}</small>
                                    ) : null}
                                  </button>
                                ) : (
                                  <span className="inv-muted">Sin ubicación</span>
                                )}
                              </td>
                              <td className="inv-col-actions">
                                <div className="inv-table-actions">
                                  <Button size="small" className="inv-receive-btn" onClick={() => receive(row.product.id)}>
                                    <Icon name="receive" />
                                    Recibir
                                  </Button>
                                  <IconButton icon="more" label={`Más acciones de ${row.product.name}`} className="inv-more-btn" onClick={() => selectProduct(row.product.id)} />
                                </div>
                              </td>
                            </tr>
                            {open && hasBom ? (
                              <tr className="inv-bom-row">
                                <td colSpan={9}>
                                  <div className="inv-bom-panel">
                                    <header>
                                      <strong>Materia prima requerida</strong>
                                      <span>por 1 unidad de {row.product.name}</span>
                                    </header>
                                    <ul>
                                      {comps.map((child) => (
                                        <li
                                          key={child.product.id}
                                          className={`inv-bom-child inv-bom-${child.status}`}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => selectProduct(child.product.id)}
                                          >
                                            <span>
                                              <strong>{child.product.name}</strong>
                                              <small>
                                                {child.qtyPerUnit} uds. por unidad ·{' '}
                                                {child.product.id}
                                              </small>
                                            </span>
                                            <span className="inv-bom-stats">
                                              <em className={`inv-pill inv-pill-${child.status}`}>
                                                {child.status === 'ok'
                                                  ? 'OK'
                                                  : child.status === 'low'
                                                    ? 'Bajo'
                                                    : 'Crítico'}
                                              </em>
                                              <strong>{num(child.available)}</strong>
                                              <small>/ mín. {num(child.min)}</small>
                                            </span>
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="inv-load-more">
                  <span>
                    Mostrando {visibleRows.length} de {rows.length} ítems
                  </span>
                  {visibleCount < rows.length ? (
                    <Button type="button" onClick={() => setVisibleCount((n) => n + PAGE_CHUNK)}>
                      Cargar más
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="inv-empty">
                <span>
                  <Icon name={allRows.length ? 'search' : 'box'} />
                </span>
                <h3>
                  {allRows.length ? 'No hay ítems con estos filtros' : 'Tu inventario empieza aquí'}
                </h3>
                <p>
                  {allRows.length
                    ? 'Prueba otro nombre, código o ubicación, o limpia los filtros.'
                    : 'Crea tu primer producto y registra una entrada.'}
                </p>
                <Btn
                  variant="primary"
                  icon={allRows.length ? 'refresh' : 'plus'}
                  onClick={allRows.length ? resetFilters : () => setEditProduct('')}
                >
                  {allRows.length ? 'Limpiar filtros' : 'Crear primer producto'}
                </Btn>
              </div>
            )
          ) : null}
        </section>
      </div>

      {selected && editProduct === null ? (
        <InventoryDetailPanel
          state={state}
          row={selected}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditProduct(selected.product.id)}
          onReceive={() => receive(selected.product.id)}
          onPurchase={() =>
            purchase(selected.product.id, selected.shortage || selected.product.min)
          }
          onLocate={(loc) => locate(selected.product.id, loc)}
          onTrace={() => navigate('/trazabilidad', { state: { q: selected.product.id } })}
          onSelectRelated={selectProduct}
          onOpenPurchase={(id) => navigate('/compras', { state: { focus: id } })}
        />
      ) : null}

      {editProduct !== null ? (
        <InventoryProductForm
          key={editProduct || 'new'}
          product={state.products.find((p) => p.id === editProduct)}
          categories={categoryNames}
          products={state.products}
          onClose={() => setEditProduct(null)}
          onSaved={(id) => {
            setEditProduct(null);
            resetFilters();
            setSelectedId(id);
          }}
        />
      ) : null}
    </div>
  );
}

function StatusBadge({ row }: { row: InventoryRow }) {
  const expiry =
    row.nearestExpiryDays != null && row.nearestExpiryDays <= 90 ? (
      <Badge
        text={
          row.nearestExpiryDays < 0
            ? 'Vencido'
            : row.nearestExpiryDays <= 30
              ? `Vence ${row.nearestExpiryDays}d`
              : `Caduca ${row.nearestExpiryDays}d`
        }
        color={row.nearestExpiryDays <= 30 ? 'amber' : 'muted'}
      />
    ) : null;
  if (row.status === 'healthy') {
    return (
      <span className="inv-status-stack">
        <span className="inv-status-badge healthy">En nivel</span>
        {expiry}
      </span>
    );
  }
  return (
    <span className="inv-status-stack">
      <span className={`inv-status-badge ${row.status}`}>{inventoryStatusLabels[row.status]}</span>
      {expiry}
    </span>
  );
}
