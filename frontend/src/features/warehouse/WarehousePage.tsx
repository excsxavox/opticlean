import { useEffect, useMemo, useRef, useState } from 'react';
import { YAW_MAX, YAW_MIN } from './iso';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, available, product, qtyAt, scopedLots, time } from '../../shared/lib/inventory';
import { buildWarehouseGeometry, faceLabel, normalizeLayout } from '../../shared/lib/warehouseLayout';
import { Btn, Kpi, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { WarehouseMap, type MapMode } from './WarehouseMap';
import { WarehousePositioning } from './WarehousePositioning';
import { WarehouseTransferDialog } from './WarehouseTransferDialog';
import '../../styles/warehouse-operation.css';

export function WarehousePage() {
  const { state, meta: serverMeta, applyResponse, toast } = useAppState();
  const meta = useMemo(() => {
    if (!state || !serverMeta) return null;
    const warehouse = state.warehouses.find((item) => item.id === activeWarehouseId(state));
    return { ...serverMeta, ...buildWarehouseGeometry(normalizeLayout(warehouse?.layout ?? { racks: warehouse?.racks })) };
  }, [state, serverMeta]);
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const locState = routeLocation.state as { loc?: string; productId?: string; pick?: string } | null;
  const [mapMode, setMapMode] = useState<MapMode | 'positions'>('positions');
  const [selectedLoc, setSelectedLoc] = useState('A-01-01');
  const [level, setLevel] = useState('all');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [viewYaw, setViewYaw] = useState(0);
  const dragRef = useRef<{ x: number; active: boolean } | null>(null);
  const [pickOrderId, setPickOrderId] = useState<string | null>(null);
  const [pickChecked, setPickChecked] = useState<Set<string>>(new Set());
  const [pickPlan, setPickPlan] = useState<Array<{ id: string; loc: string; batch: string; qty: number; productId: string }>>([]);
  const [moveLot, setMoveLot] = useState<string | null>(null);
  const navigationApplied = useRef<string | null>(null);
  const warehouseId = state ? activeWarehouseId(state) : null;
  const previousWarehouse = useRef(warehouseId);
  const warehouseLots = useMemo(() => state ? scopedLots(state) : [], [state]);
  const query = warehouseSearch.trim().toLowerCase();
  const matchingLocations = useMemo(() => {
    if (!query || !state || !meta) return [];
    const productIds = new Set(state.products
      .filter((p) => (p.name + p.id).toLowerCase().includes(query))
      .map((p) => p.id));
    const occupiedMatches = new Set(warehouseLots
      .filter((lot) => lot.qty > 0 && productIds.has(lot.productId))
      .map((lot) => lot.loc));
    return meta.locations.filter((location) =>
      location.id.toLowerCase().includes(query) || occupiedMatches.has(location.id));
  }, [query, state, meta, warehouseLots]);

  useEffect(() => {
    if (previousWarehouse.current === warehouseId) return;
    previousWarehouse.current = warehouseId;
    setSelectedLoc('');
    setLevel('all');
    setWarehouseSearch('');
    setZoom(1);
    setViewYaw(0);
    setPickOrderId(null);
    setPickChecked(new Set());
    setMoveLot(null);
  }, [warehouseId]);

  useEffect(() => {
    if (!meta?.locations.length) return;
    if (!meta.locations.some((l) => l.id === selectedLoc)) {
      setSelectedLoc(meta.locations[0].id);
    }
    if (level !== 'all' && Number(level) > meta.layout.levels) setLevel('all');
  }, [meta, selectedLoc, level]);

  useEffect(() => {
    if (!state || !meta || navigationApplied.current === routeLocation.key) return;
    navigationApplied.current = routeLocation.key;
    if (locState?.loc && meta.locations.some((location) => location.id === locState.loc)) {
      setSelectedLoc(locState.loc);
      setLevel('all');
    }
    if (locState?.productId) {
      const l = warehouseLots.find((x) => x.productId === locState.productId && x.qty > 0);
      if (l) {
        setSelectedLoc(l.loc);
        setWarehouseSearch(locState.productId);
      }
    }
    if (locState?.pick) setPickOrderId(locState.pick);
  }, [locState, routeLocation.key, state, meta, warehouseLots]);

  useEffect(() => {
    if (!matchingLocations.length) return;
    setSelectedLoc((current) => matchingLocations.some((location) => location.id === current)
      ? current
      : matchingLocations[0].id);
    setLevel('all');
  }, [matchingLocations]);

  useEffect(() => {
    let cancelled = false;
    setPickChecked(new Set());
    setPickPlan([]);
    if (!pickOrderId) {
      return;
    }
    void api.pickPlan(pickOrderId)
      .then((plan) => { if (!cancelled) setPickPlan(plan); })
      .catch((e) => { if (!cancelled) toast(e.message); });
    return () => { cancelled = true; };
  }, [pickOrderId, state, toast]);

  if (!state || !meta) return null;

  const activeRackId =
    meta.locations.find((l) => l.id === selectedLoc)?.rack ?? selectedLoc.split('-')[0] ?? 'A';

  const selectRack = (rackId: string) => {
    const rackLocations = meta.locations.filter((location) => location.rack === rackId &&
      (level === 'all' || String(location.level) === level));
    const loc =
      rackLocations.find((l) => l.face === 'D') ?? rackLocations[0];
    if (loc) setSelectedLoc(loc.id);
  };

  const mapState = { ...state, lots: warehouseLots };
  const currentWarehouse = state.warehouses.find((warehouse) => warehouse.id === warehouseId);

  const totalCells = meta.locations.length;
  const occupied = meta.locations.filter((l) => qtyAt(state, l.id) > 0).length;
  const loc = meta.locations.find((l) => l.id === selectedLoc) ?? meta.locations[0];
  const lots = warehouseLots.filter((l) => l.loc === loc.id && l.qty > 0);
  const q = qtyAt(state, loc.id);
  const p = lots[0] ? product(state, lots[0].productId) : null;
  const pickLocs = new Set(pickPlan.map((l) => l.loc));
  const low = state.products.filter((pr) => available(state, pr.id) < pr.min);

  const confirmPick = async () => {
    if (!pickOrderId || !pickPlan.length) return;
    if (!pickPlan.every((l) => pickChecked.has(l.id))) {
      toast('Verifica todas las posiciones.');
      return;
    }
    try {
      applyResponse(await api.prepare(pickOrderId));
      setPickOrderId(null);
      setPickChecked(new Set());
      toast('Pedido preparado.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    }
  };

  const lotForMove = moveLot ? warehouseLots.find((l) => l.id === moveLot) : null;

  return (
    <div className="warehouse-positioning-page">
      <PageHead
        eyebrow="Espacio e inventario"
        title="Centro de ubicaciones"
        desc="Explora tu distribución y encuentra el lugar de cada producto."
        actions={
          <>
            <Btn icon="plus" onClick={() => navigate('/recepcion', { state: { loc: selectedLoc } })}>
              Registrar recepción
            </Btn>
            <Btn
              variant="primary"
              icon="route"
              onClick={() => {
                const pending = state.orders.find((o) => o.status === 'Por preparar');
                if (pending) setPickOrderId(pending.id);
                else toast('No hay pedidos por preparar.');
              }}
            >
              Preparar pedido
            </Btn>
          </>
        }
      />
      <div className="kpis">
        <Kpi
          label="Ocupación"
          value={`${Math.round((occupied / Math.max(totalCells, 1)) * 100)}%`}
          unit=""
          foot={`${occupied}/${totalCells} ubicaciones`}
          icon="warehouse"
        />
        <Kpi
          label="Disponibles"
          value={totalCells - occupied}
          unit="pos."
          foot={`${meta.racks.length} racks · layout activo`}
          icon="grid"
          color="positive"
        />
        <Kpi
          label="Por preparar"
          value={state.orders.filter((o) => o.status === 'Por preparar').length}
          unit="pedidos"
          foot="Picking FEFO"
          icon="orders"
        />
      </div>
      <div className="work-area">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">
                <Icon name="warehouse" />
                {currentWarehouse?.name ?? state.settings.warehouse}
              </div>
              <div className="panel-subtitle">
                {currentWarehouse?.city ? `${currentWarehouse.city} · ` : ''}
                {meta.racks.length} racks · {totalCells} ubicaciones
              </div>
            </div>
            <Btn variant="ghost" icon="building" onClick={() => navigate(warehouseId ? `/bodegas?edit=${encodeURIComponent(warehouseId)}&step=layout` : '/bodegas')}>
              Editar distribución
            </Btn>
          </div>
          <div className="map-controls">
            <div className="segmented" role="group" aria-label="Vista de la bodega">
              <button type="button" aria-pressed={mapMode === 'positions'} className={mapMode === 'positions' ? 'active' : ''} onClick={() => setMapMode('positions')}>
                <Icon name="pin" />Ubicaciones
              </button>
              <button type="button" aria-pressed={mapMode === '3d'} className={mapMode === '3d' ? 'active' : ''} onClick={() => setMapMode('3d')}>
                <Icon name="cube" />
                Vista 3D
              </button>
              <button type="button" aria-pressed={mapMode === 'plan'} className={mapMode === 'plan' ? 'active' : ''} onClick={() => setMapMode('plan')}>
                <Icon name="map" />
                Plano
              </button>
              <button type="button" aria-pressed={mapMode === 'front'} className={mapMode === 'front' ? 'active' : ''} onClick={() => setMapMode('front')}>
                <Icon name="layers" />
                Frontal
              </button>
            </div>
            <div className="map-actions">
              <select value={level} onChange={(e) => {
                const nextLevel = e.target.value;
                setLevel(nextLevel);
                if (nextLevel !== 'all') {
                  const nextLocation = meta.locations.find((location) => location.rack === activeRackId && String(location.level) === nextLevel);
                  if (nextLocation) setSelectedLoc(nextLocation.id);
                }
              }} aria-label="Filtrar por nivel">
                <option value="all">Todos los niveles</option>
                {Array.from({ length: meta.layout.levels }, (_, i) => i + 1).map((l) => (
                  <option key={l} value={l}>
                    Nivel {l}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                aria-label="Restablecer vista"
                onClick={() => {
                  setZoom(1);
                  setLevel('all');
                  setViewYaw(0);
                }}
              >
                <Icon name="expand" />
              </button>
            </div>
          </div>
          <div className="toolbar" style={{ padding: '10px 16px' }}>
            <div className="search-input" style={{ maxWidth: 'none' }}>
              <Icon name="search" />
              <input
                type="search"
                aria-label="Buscar producto o código de ubicación en esta bodega"
                aria-describedby={query ? 'warehouse-search-status' : undefined}
                value={warehouseSearch}
                onChange={(e) => setWarehouseSearch(e.target.value)}
                placeholder="Producto o código de ubicación…"
              />
            </div>
            {warehouseSearch ? (
              <Btn
                onClick={() => {
                  setWarehouseSearch('');
                }}
              >
                Limpiar
              </Btn>
            ) : null}
          </div>
          {query ? (
            <div className={`warehouse-search-feedback ${matchingLocations.length ? '' : 'no-results'}`}>
              <p id="warehouse-search-status" role="status">
                {matchingLocations.length
                  ? `${matchingLocations.length} ${matchingLocations.length === 1 ? 'ubicación encontrada' : 'ubicaciones encontradas'} en esta bodega.`
                  : 'Sin coincidencias en esta bodega. Busca un producto o parte del código de una ubicación.'}
              </p>
              {matchingLocations.length > 1 ? (
                <div className="field">
                  <label htmlFor="warehouse-search-result">Ir a una coincidencia</label>
                  <select id="warehouse-search-result" value={matchingLocations.some((location) => location.id === selectedLoc) ? selectedLoc : ''} onChange={(e) => {
                    setSelectedLoc(e.target.value);
                    setLevel('all');
                  }}>
                    <option value="" disabled>Selecciona una ubicación</option>
                    {matchingLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.id} · {qtyAt(state, location.id)} u.
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}
          {mapMode === '3d' ? (
            <div className="toolbar" style={{ padding: '8px 16px', borderBottom: '1px solid #edf1f6' }}>
              <span className="subtle" style={{ fontSize: 10 }}>
                <Icon name="cube" /> Girar vista (parte trasera de racks)
              </span>
              <div className="filter-group" style={{ flex: 1, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn small"
                  aria-label="Girar vista a la izquierda"
                  disabled={viewYaw <= YAW_MIN}
                  onClick={() => setViewYaw((y) => Math.max(YAW_MIN, y - Math.PI / 12))}
                >
                  ◀
                </button>
                <input
                  type="range"
                  min={YAW_MIN}
                  max={YAW_MAX}
                  step={0.04}
                  value={viewYaw}
                  onChange={(e) => setViewYaw(Number(e.target.value))}
                  aria-label="Ángulo de rotación 3D"
                  style={{ width: 160 }}
                />
                <button
                  type="button"
                  className="btn small"
                  aria-label="Girar vista a la derecha"
                  disabled={viewYaw >= YAW_MAX}
                  onClick={() => setViewYaw((y) => Math.min(YAW_MAX, y + Math.PI / 12))}
                >
                  ▶
                </button>
                <span className="subtle" style={{ minWidth: 36 }}>
                  {Math.round((viewYaw * 180) / Math.PI)}°
                </span>
              </div>
            </div>
          ) : null}
          {mapMode === 'front' || mapMode === 'plan' ? (
            <div className="rack-picker-bar">
              <span className="subtle">Rack</span>
              <div className="rack-picker" role="group" aria-label="Seleccionar rack">
                {meta.racks.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={activeRackId === r.id}
                    aria-label={`Rack ${r.id}`}
                    className={activeRackId === r.id ? 'active' : ''}
                    onClick={() => selectRack(r.id)}
                  >
                    {r.id}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {mapMode === 'positions' ? <WarehousePositioning key={warehouseId} state={mapState} layout={meta.layout} locations={meta.locations} selectedLoc={selectedLoc} level={level} query={query} matches={matchingLocations} pickLocs={pickLocs} onSelect={setSelectedLoc} onSelectRack={selectRack} /> : <div
            className="warehouse-canvas"
            id="warehouse-map"
            onPointerDown={(e) => {
              if (mapMode !== '3d' || e.button !== 0 || (e.target as Element).closest('button, input, select')) return;
              dragRef.current = { x: e.clientX, active: true };
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (mapMode !== '3d' || !dragRef.current?.active) return;
              const dx = e.clientX - dragRef.current.x;
              dragRef.current.x = e.clientX;
              setViewYaw((y) => Math.min(YAW_MAX, Math.max(YAW_MIN, y + dx * 0.008)));
            }}
            onPointerUp={() => {
              if (dragRef.current) dragRef.current.active = false;
            }}
            onPointerCancel={() => { dragRef.current = null; }}
            onLostPointerCapture={() => { dragRef.current = null; }}
            style={mapMode === '3d' ? { cursor: 'grab' } : undefined}
          >
            <WarehouseMap
              state={mapState}
              racks={meta.racks}
              layout={meta.layout}
              locations={meta.locations}
              mode={mapMode}
              selectedLoc={selectedLoc}
              level={level}
              warehouseSearch={warehouseSearch.trim()}
              pickLocs={pickLocs}
              zoom={zoom}
              yaw={viewYaw}
              onSelect={setSelectedLoc}
              onSelectRack={(rack) => {
                selectRack(rack);
                setMapMode('front');
              }}
            />
            <div className="map-corner">
              <span className="live-dot" />
              {query
                ? `${matchingLocations.length} coincidencias`
                : 'Inventario conectado'}
            </div>
            {mapMode === '3d' ? <div className="map-zoom">
              <button
                type="button"
                aria-label="Acercar"
                disabled={zoom >= 1.45}
                onClick={() => {
                  setZoom((z) => Math.min(1.45, z + 0.1));
                }}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Alejar"
                disabled={zoom <= 0.75}
                onClick={() => {
                  setZoom((z) => Math.max(0.75, z - 0.1));
                }}
              >
                −
              </button>
            </div> : null}
            <div className="map-hint">
              <Icon name="cursor" />
              Selecciona una posición para explorar
            </div>
          </div>}
          {mapMode !== 'positions' ? <div className="map-footer">
            <div className="legend">
              <span>
                <i className="swatch blue" />
                Seleccionada
              </span>
              <span>
                <i className="swatch" />
                Ocupada
              </span>
              <span>
                <i className="swatch empty" />
                Disponible
              </span>
              <span>
                <i className="swatch green" />
                Picking / búsqueda
              </span>
            </div>
            <span>Vista 3D: arrastra horizontalmente o usa el control de rotación</span>
          </div> : null}
        </section>
        <div className="side-stack">
          {pickOrderId ? (
            <section className="panel pick-panel">
              <div className="panel-head">
                <div className="panel-title">
                  <Icon name="route" />
                  Picking · {pickOrderId}
                </div>
                <button type="button" className="icon-btn" aria-label="Cerrar preparación del pedido" onClick={() => setPickOrderId(null)}>
                  <Icon name="close" />
                </button>
              </div>
              <div className="pick-intro">
                {pickChecked.size} de {pickPlan.length} posiciones verificadas
              </div>
              {pickPlan.map((l, i) => (
                <label key={l.id} className={`pick-item ${pickChecked.has(l.id) ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={pickChecked.has(l.id)}
                    onChange={(e) => {
                      const next = new Set(pickChecked);
                      if (e.target.checked) next.add(l.id);
                      else next.delete(l.id);
                      setPickChecked(next);
                      setSelectedLoc(l.loc);
                    }}
                  />
                  <span className="pick-number">{i + 1}</span>
                  <div>
                    <div className="product-title">{product(state, l.productId)?.name}</div>
                    <div className="product-code">
                      {l.loc} · {l.batch} · {l.qty} u.
                    </div>
                  </div>
                </label>
              ))}
              <div className="pick-footer">
                <Btn variant="primary" icon="check" disabled={!pickPlan.length || !pickPlan.every((item) => pickChecked.has(item.id))} onClick={() => void confirmPick()}>
                  Confirmar preparación
                </Btn>
              </div>
            </section>
          ) : (
            <section className="panel location-panel">
              <div className="panel-head">
                <span className="panel-title">
                  <Icon name="pin" />
                  Detalle de ubicación
                </span>
              </div>
              <div className="panel-body">
                <div className="location-code">{loc.id}</div>
                <div className="position-address"><span>Rack<strong>{loc.rack}</strong></span><span>Nivel<strong>{String(loc.level).padStart(2, '0')}</strong></span><span>Casilla<strong>{String(loc.pos).padStart(2, '0')}</strong></span></div>
                {loc.face ? (
                  <div className="subtle" style={{ marginBottom: 8 }}>
                    Cara {faceLabel(loc.face).toLowerCase()}
                  </div>
                ) : null}
                <div className="position-capacity-head"><span>Capacidad utilizada</span><strong>{q}/{loc.capacity} u.</strong></div>
                <div className="position-capacity-track"><span style={{ width: `${Math.min(100, q / loc.capacity * 100)}%` }} /></div>
                <p className="subtle">{Math.max(0, loc.capacity - q)} unidades de espacio disponible</p>
                {p ? (
                  <>
                    <div className="product-title">{p.name}</div>
                    {lots.map((lot) => <div className="position-lot" key={lot.id}><div><strong>{lot.batch}</strong><Btn variant="small" icon="swap" onClick={() => setMoveLot(lot.id)}>Reubicar</Btn></div><p>{lot.qty} unidades · Vence {lot.expiry}</p></div>)}
                    <div className="button-row">
                      <Btn icon="plus" onClick={() => navigate('/recepcion', { state: { loc: loc.id, productId: p.id } })} disabled={q >= loc.capacity}>
                        Añadir stock
                      </Btn>
                      <Btn icon="history" onClick={() => navigate('/trazabilidad', { state: { q: p.id } })}>
                        Trazabilidad
                      </Btn>
                    </div>
                  </>
                ) : (
                  <Btn variant="primary" icon="plus" onClick={() => navigate('/recepcion', { state: { loc: loc.id } })}>
                    Asignar producto
                  </Btn>
                )}
              </div>
            </section>
          )}
          <section className="panel suggestion">
            <div className="suggestion-title">
              <Icon name="spark" />
              Una operación más ágil
            </div>
            <p>
              {low.length
                ? `${low[0].name} está bajo el mínimo.`
                : 'Prioriza lotes FEFO en el picking.'}
            </p>
            <Btn variant="ghost" icon="arrow" onClick={() => navigate(low.length ? '/compras' : '/pedidos')}>
              {low.length ? 'Revisar abastecimiento' : 'Explorar pedidos'}
            </Btn>
          </section>
        </div>
      </div>
      <section className="panel movements" style={{ marginTop: 17 }}>
        <div className="panel-head">
          <span className="panel-title">
            <Icon name="history" />
            Últimos movimientos
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <tbody>
              {state.events.slice(0, 5).map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.type}</strong>
                    <span className="sub">{product(state, e.productId)?.name}</span>
                  </td>
                  <td>
                    {e.from} → {e.to}
                  </td>
                  <td>{time(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {lotForMove ? <WarehouseTransferDialog key={`${warehouseId}:${lotForMove.id}`} state={state} lot={lotForMove} onClose={() => setMoveLot(null)} onMoved={(destination) => { setSelectedLoc(destination); setLevel('all'); setWarehouseSearch(''); setMoveLot(null); }} /> : null}
    </div>
  );
}
