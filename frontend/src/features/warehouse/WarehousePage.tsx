import { useEffect, useRef, useState } from 'react';
import { YAW_MAX, YAW_MIN } from './iso';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { available, product, qtyAt, scopedLots, time } from '../../shared/lib/inventory';
import { Btn, Kpi, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { WarehouseMap, type MapMode } from './WarehouseMap';
import { Modal, ModalActions } from '../../shared/components/Modal';

export function WarehousePage() {
  const { state, meta, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const locState = useLocation().state as { loc?: string; productId?: string; pick?: string } | null;
  const [mapMode, setMapMode] = useState<MapMode>('3d');
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
  const [moveError, setMoveError] = useState('');

  useEffect(() => {
    if (locState?.loc) setSelectedLoc(locState.loc);
    if (locState?.productId) {
      const l = state?.lots.find((x) => x.productId === locState.productId);
      if (l) {
        setSelectedLoc(l.loc);
        setWarehouseSearch(locState.productId);
      }
    }
    if (locState?.pick) setPickOrderId(locState.pick);
  }, [locState, state]);

  useEffect(() => {
    const q = warehouseSearch.trim();
    if (!q || !state || !meta) return;
    const exact = meta.locations.find((l) => l.id.toLowerCase() === q.toLowerCase());
    if (exact) {
      setSelectedLoc(exact.id);
      return;
    }
    const prod = state.products.find((p) => (p.name + ' ' + p.id).toLowerCase().includes(q.toLowerCase()));
    const lot = prod && state.lots.find((l) => l.productId === prod.id);
    if (lot) setSelectedLoc(lot.loc);
  }, [warehouseSearch, state, meta]);

  useEffect(() => {
    if (!pickOrderId) {
      setPickPlan([]);
      return;
    }
    void api.pickPlan(pickOrderId).then(setPickPlan).catch((e) => toast(e.message));
  }, [pickOrderId, state, toast]);

  if (!state || !meta) return null;

  const mapState = { ...state, lots: scopedLots(state) };

  const totalCells = meta.locations.length;
  const occupied = meta.locations.filter((l) => qtyAt(state, l.id) > 0).length;
  const loc = meta.locations.find((l) => l.id === selectedLoc) ?? meta.locations[0];
  const lots = scopedLots(state).filter((l) => l.loc === selectedLoc);
  const q = qtyAt(state, selectedLoc);
  const p = lots[0] ? product(state, lots[0].productId) : null;
  const pickLocs = new Set(pickPlan.map((l) => l.loc));
  const low = state.products.filter((pr) => available(state, pr.id) < pr.min);

  const confirmPick = async () => {
    if (!pickOrderId) return;
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

  const submitMove = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMoveError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(await api.move(data));
      setSelectedLoc(String(data.to));
      setMoveLot(null);
      toast('Traslado registrado.');
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Error');
    }
  };

  const lotForMove = moveLot ? state.lots.find((l) => l.id === moveLot) : null;

  return (
    <>
      <PageHead
        eyebrow="Control de ubicaciones"
        title="Tu bodega, en perspectiva"
        desc="Cada producto en su lugar. Cada movimiento bajo control."
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
                {state.settings.warehouse}
              </div>
              <div className="panel-subtitle">
                {meta.racks.length} racks · {totalCells} posiciones
              </div>
            </div>
            <Btn variant="ghost" icon="building" onClick={() => navigate('/bodegas')}>
              Diseñar layout
            </Btn>
          </div>
          <div className="map-controls">
            <div className="segmented">
              <button type="button" className={mapMode === '3d' ? 'active' : ''} onClick={() => setMapMode('3d')}>
                <Icon name="cube" />
                Vista 3D
              </button>
              <button type="button" className={mapMode === 'plan' ? 'active' : ''} onClick={() => setMapMode('plan')}>
                <Icon name="map" />
                Plano
              </button>
              <button type="button" className={mapMode === 'front' ? 'active' : ''} onClick={() => setMapMode('front')}>
                <Icon name="layers" />
                Frontal
              </button>
            </div>
            <div className="map-actions">
              <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nivel">
                <option value="all">Todos los niveles</option>
                {[1, 2, 3].map((l) => (
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
                value={warehouseSearch}
                onChange={(e) => setWarehouseSearch(e.target.value)}
                placeholder="Localizar producto o ubicación…"
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
          {mapMode === '3d' ? (
            <div className="toolbar" style={{ padding: '8px 16px', borderBottom: '1px solid #edf1f6' }}>
              <span className="subtle" style={{ fontSize: 10 }}>
                <Icon name="cube" /> Girar vista (parte trasera de racks)
              </span>
              <div className="filter-group" style={{ flex: 1, justifyContent: 'flex-end' }}>
                <Btn
                  variant="small"
                  onClick={() => setViewYaw((y) => Math.max(YAW_MIN, y - Math.PI / 12))}
                >
                  ◀
                </Btn>
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
                <Btn
                  variant="small"
                  onClick={() => setViewYaw((y) => Math.min(YAW_MAX, y + Math.PI / 12))}
                >
                  ▶
                </Btn>
                <span className="subtle" style={{ minWidth: 36 }}>
                  {Math.round((viewYaw * 180) / Math.PI)}°
                </span>
              </div>
            </div>
          ) : null}
          <div
            className="warehouse-canvas"
            id="warehouse-map"
            onPointerDown={(e) => {
              if (mapMode !== '3d') return;
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
            style={mapMode === '3d' ? { cursor: 'grab' } : undefined}
          >
            <WarehouseMap
              state={mapState}
              racks={meta.racks}
              mode={mapMode}
              selectedLoc={selectedLoc}
              level={level}
              warehouseSearch={warehouseSearch}
              pickLocs={pickLocs}
              zoom={zoom}
              yaw={viewYaw}
              onSelect={setSelectedLoc}
              onSelectRack={(rack) => {
                setSelectedLoc(state.lots.find((l) => l.loc[0] === rack)?.loc ?? `${rack}-01-01`);
                setMapMode('front');
              }}
            />
            <div className="map-corner">
              <span className="live-dot" />
              {warehouseSearch
                ? `${meta.locations.filter((l) => {
                    const matchIds = state.products
                      .filter((p) => (p.name + p.id).toLowerCase().includes(warehouseSearch.toLowerCase()))
                      .map((p) => p.id);
                    return (
                      l.id.toLowerCase() === warehouseSearch.toLowerCase() ||
                      state.lots.some((t) => t.loc === l.id && matchIds.includes(t.productId))
                    );
                  }).length} coincidencias`
                : 'Inventario conectado'}
            </div>
            <div className="map-zoom">
              <button
                type="button"
                aria-label="Acercar"
                onClick={() => {
                  if (mapMode !== '3d') {
                    toast('El zoom está disponible en la vista 3D.');
                    return;
                  }
                  setZoom((z) => Math.min(1.45, z + 0.1));
                }}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Alejar"
                onClick={() => {
                  if (mapMode !== '3d') {
                    toast('El zoom está disponible en la vista 3D.');
                    return;
                  }
                  setZoom((z) => Math.max(0.75, z - 0.1));
                }}
              >
                −
              </button>
            </div>
            <div className="map-hint">
              <Icon name="cursor" />
              Selecciona una posición para explorar
            </div>
          </div>
          <div className="map-footer">
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
          </div>
        </section>
        <div className="side-stack">
          {pickOrderId ? (
            <section className="panel pick-panel">
              <div className="panel-head">
                <div className="panel-title">
                  <Icon name="route" />
                  Picking · {pickOrderId}
                </div>
                <button type="button" className="icon-btn" onClick={() => setPickOrderId(null)}>
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
                <Btn variant="primary" icon="check" onClick={() => void confirmPick()}>
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
                {p ? (
                  <>
                    <div className="product-title">{p.name}</div>
                    <dl className="detail-grid">
                      <div>
                        <dt>Disponible</dt>
                        <dd>{q} u.</dd>
                      </div>
                      <div>
                        <dt>Lote</dt>
                        <dd>{lots[0].batch}</dd>
                      </div>
                    </dl>
                    <div className="button-row">
                      <Btn variant="primary" icon="swap" onClick={() => setMoveLot(lots[0].id)}>
                        Trasladar
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

      {lotForMove && p ? (
        <Modal
          title="Trasladar existencias"
          subtitle={`${p.id} / ${p.name}`}
          onClose={() => setMoveLot(null)}
          footer={
            <ModalActions onCancel={() => setMoveLot(null)} submitLabel="Confirmar traslado" formId="move-form" icon="swap" />
          }
        >
          <form id="move-form" onSubmit={submitMove}>
            <input type="hidden" name="lotId" value={lotForMove.id} />
            <div className="form-grid">
              <div className="field">
                <label htmlFor="move-qty">Cantidad</label>
                <input id="move-qty" name="qty" type="number" min={1} max={lotForMove.qty} defaultValue={lotForMove.qty} required />
              </div>
              <MoveDestSelect productId={lotForMove.productId} qty={lotForMove.qty} from={lotForMove.loc} />
            </div>
            {moveError ? <div className="form-error visible">{moveError}</div> : null}
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function MoveDestSelect({
  productId,
  qty,
  from,
}: {
  productId: string;
  qty: number;
  from: string;
}) {
  const [opts, setOpts] = useState<{ id: string }[]>([]);
  useEffect(() => {
    void api.suggest(productId, qty, from).then(setOpts);
  }, [productId, qty, from]);
  return (
    <div className="field">
      <label htmlFor="move-to">Destino</label>
      <select name="to" id="move-to" required defaultValue={opts[0]?.id}>
        {opts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.id}
          </option>
        ))}
      </select>
    </div>
  );
}
