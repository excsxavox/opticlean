import { useEffect, useMemo, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, availableIn, client, money, num, orderValue, sellableIn, statusColor, stockIn } from '../../shared/lib/inventory';
import { buildForecast } from '../../shared/lib/forecast';
import { expiryAlerts } from '../../shared/lib/wholesale';
import { Badge, Btn, Kpi, KpiGrid, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { AssignPicker } from '../orders/AssignPicker';
import '../../styles/dashboard.css';
import '../../styles/orders.css';

const ORDERS_PAGE_SIZE = 6;

export function DashboardPage() {
  const { state, meta, applyResponse, toast } = useAppState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [whFilter, setWhFilter] = useState('all');
  const [whBusy, setWhBusy] = useState(false);
  const [bodegueroCount, setBodegueroCount] = useState(0);
  const forecast = useMemo(() => (state ? buildForecast(state) : null), [state]);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    void api
      .listUsers({ role: 'ops', activeOnly: true })
      .then((res) => {
        if (!cancelled) setBodegueroCount(res.users.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  if (!state || !meta || !forecast) return null;

  const pending = state.orders.filter((o) => o.status === 'Por preparar');
  const unassigned = pending.filter((o) => !o.assignedToUserId).length;
  const activeOrders = state.orders.filter((o) => o.status !== 'Entregado');
  const activeWh = activeWarehouseId(state);
  const scope = whFilter;
  const cellsOf = (layout: { rackCount: number; levels: number; positionsPerLevel: number; depthFaces?: number }) =>
    layout.rackCount * layout.levels * layout.positionsPerLevel * (layout.depthFaces ?? 1);
  const sites = scope === 'all' ? state.warehouses.filter((w) => w.status === 'Operativa') : state.warehouses.filter((w) => w.id === scope);
  const totalCells =
    scope === activeWh
      ? meta.locations.length
      : sites.reduce((n, w) => n + cellsOf(w.layout), 0);
  const occupied =
    scope === activeWh
      ? meta.locations.filter((l) =>
          state.lots.some((lot) => lot.loc === l.id && (lot.warehouseId ?? 'WH-QT-01') === scope && lot.qty > 0),
        ).length
      : new Set(
          state.lots
            .filter(
              (lot) =>
                lot.qty > 0 &&
                lot.loc !== 'CUARENTENA' &&
                lot.loc !== 'TRANSITO' &&
                (scope === 'all' || (lot.warehouseId ?? 'WH-QT-01') === scope),
            )
            .map((lot) => `${lot.warehouseId ?? 'WH-QT-01'}:${lot.loc}`),
        ).size;
  const occupancyPct = Math.round((occupied / Math.max(totalCells, 1)) * 100);
  const low = state.products.filter((p) => availableIn(state, p.id, scope) < p.min);
  const units = state.products.reduce((n, p) => n + availableIn(state, p.id, scope), 0);
  const stockValue = state.products.reduce((n, p) => n + stockIn(state, p.id, scope) * (p.avgCost ?? 0), 0);
  const saleValue = state.products.reduce((n, p) => n + stockIn(state, p.id, scope) * p.price, 0);
  const missingCost = state.products.filter((p) => stockIn(state, p.id, scope) > 0 && !(p.avgCost && p.avgCost > 0)).length;
  const unsellable = state.products.reduce(
    (n, p) => n + Math.max(0, stockIn(state, p.id, scope) - sellableIn(state, p.id, scope)),
    0,
  );
  const waiting = state.orders.filter((o) => o.status === 'Esperando stock').length;
  const listed = tab === 'pending' ? pending : activeOrders;
  const pageCount = Math.max(1, Math.ceil(listed.length / ORDERS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageOrders = listed.slice((safePage - 1) * ORDERS_PAGE_SIZE, safePage * ORDERS_PAGE_SIZE);
  const rangeFrom = listed.length ? (safePage - 1) * ORDERS_PAGE_SIZE + 1 : 0;
  const rangeTo = Math.min(safePage * ORDERS_PAGE_SIZE, listed.length);
  const productionAlerts =
    forecast.productionRisks.length ||
    forecast.recommendations.filter((r) => r.urgency === 'now').length;
  const expiry = expiryAlerts(state, scope);
  const expired = expiry.filter((item) => item.band === 'vencido');
  const soon = expiry.filter((item) => item.band !== 'vencido');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const sanitaryGaps = state.products.filter(
    (item) => item.requiresSanitary && (!item.sanitaryRegistration || (item.sanitaryExpires != null && item.sanitaryExpires < today)),
  );

  const onWarehouseChange = async (value: string) => {
    if (whBusy) return;
    if (value === 'all') {
      setWhFilter('all');
      return;
    }
    if (value === activeWh) {
      setWhFilter(value);
      return;
    }
    setWhBusy(true);
    try {
      applyResponse(await api.activateWarehouse(value));
      setWhFilter(value);
      const name = state.warehouses.find((w) => w.id === value)?.name ?? 'Bodega';
      toast(`${name} activa.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cambiar de bodega.');
    } finally {
      setWhBusy(false);
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Panel de control"
        title="Resumen de operaciones"
        desc="Pedidos, stock y movimientos de tu operación de un vistazo."
        actions={
          <>
            <Btn icon="receive" onClick={() => navigate('/recepcion/nueva')}>
              Registrar entrada
            </Btn>
            <Btn variant="primary" icon="plus" onClick={() => navigate('/pedidos/nuevo')}>
              Nuevo pedido
            </Btn>
          </>
        }
      >
        <label className="dash-wh">
          <Icon name="warehouse" />
          <Select
            value={whFilter}
            disabled={whBusy}
            onChange={(e) => void onWarehouseChange(e.target.value)}
            aria-label="Bodega"
          >
            <option value="all">Todas las bodegas</option>
            {state.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>
      </PageHead>
      <KpiGrid label="Resumen de la operación">
        <Kpi
          label="Pedidos activos"
          icon="orders"
          value={activeOrders.length}
          caption={
            <Badge
              text={
                user?.role === 'admin'
                  ? `${bodegueroCount} bodegueros · ${unassigned} sin asignar`
                  : `${pending.length} por preparar`
              }
              color="amber"
            />
          }
        />
        <Kpi
          label="Productos bajo mínimo"
          icon="alert"
          value={low.length}
          tone={low.length ? 'warning' : 'default'}
          caption={
            <button type="button" onClick={() => navigate('/inventario')}>
              Revisar reposición
            </button>
          }
        />
        <Kpi
          label="Unidades disponibles"
          icon="box"
          value={num(units)}
          caption="Descontando reservas"
        />
        <Kpi
          label="Ocupación de bodega"
          icon="warehouse"
          value={`${occupancyPct}%`}
          caption={scope === 'all' ? `${occupied} de ${totalCells} en bodegas operativas` : `${occupied} de ${totalCells} posiciones`}
          progress={occupancyPct}
        />
      </KpiGrid>
      <div className="dash">
        <div className="dash-mid">
          <section className="panel dash-orders">
            <div className="panel-head dash-orders-head">
              <span className="panel-title">Pedidos por preparar</span>
              <div className="dash-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'pending'}
                  className={tab === 'pending' ? 'active' : ''}
                  onClick={() => setTab('pending')}
                >
                  Por preparar ({pending.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'all'}
                  className={tab === 'all' ? 'active' : ''}
                  onClick={() => setTab('all')}
                >
                  Todos ({activeOrders.length})
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th>Bodeguero</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {pageOrders.length ? (
                    pageOrders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.id}</strong>
                        </td>
                        <td>{client(state, o.clientId)?.name}</td>
                        <td>
                          <strong>{money(orderValue(state, o))}</strong>
                        </td>
                        <td>
                          <Badge text={o.status} color={statusColor(o.status)} />
                        </td>
                        <td>
                          <AssignPicker order={o} compact />
                        </td>
                        <td>
                          {o.status === 'Por preparar' ? (
                            <Btn
                              variant="small"
                              onClick={() => navigate('/bodega', { state: { pick: o.id } })}
                            >
                              Preparar
                            </Btn>
                          ) : (
                            <Btn variant="small" onClick={() => navigate('/pedidos')}>
                              Ver
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="dash-empty-row">
                        No hay pedidos en esta vista.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {listed.length ? (
              <div className="dash-pagination" aria-label="Paginación de pedidos">
                <span>
                  Mostrando {rangeFrom}–{rangeTo} de {listed.length}
                </span>
                <div>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    aria-label="Página anterior"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <Icon name="back" />
                  </button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={n === safePage ? 'is-active' : ''}
                      aria-current={n === safePage ? 'page' : undefined}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={safePage >= pageCount}
                    aria-label="Página siguiente"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    <Icon name="arrow" />
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel dash-prio">
            <div className="panel-head">
              <span className="panel-title">Prioridades de hoy</span>
            </div>
            <div className="dash-prio-list">
              <article className="dash-prio-item">
                <div className="dash-prio-icon">
                  <Icon name="alert" />
                </div>
                <div className="dash-prio-body">
                  <strong>{low.length} productos bajo mínimo</strong>
                  <small>Consulta existencias y mínimos.</small>
                  <button type="button" onClick={() => navigate('/inventario')}>
                    Revisar productos
                  </button>
                </div>
              </article>
              <article className="dash-prio-item">
                <div className="dash-prio-icon">
                  <Icon name="orders" />
                </div>
                <div className="dash-prio-body">
                  <strong>{pending.length} pedidos por preparar</strong>
                  <small>Consulta posiciones y lotes.</small>
                  <button type="button" onClick={() => navigate('/bodega')}>
                    Ir a preparación
                  </button>
                </div>
              </article>
              <article className="dash-prio-item">
                <div className="dash-prio-icon">
                  <Icon name="alert" />
                </div>
                <div className="dash-prio-body">
                  <strong>
                    {expired.length} vencido{expired.length === 1 ? '' : 's'} · {soon.length} por vencer
                  </strong>
                  <small>
                    {expiry[0]
                      ? `${expiry[0].name} · ${expiry[0].days < 0 ? 'vencido' : `vence en ${expiry[0].days} días`}`
                      : 'Sin lotes en los próximos 90 días.'}{' '}
                    El vencido queda en cuarentena y no se puede preparar.
                  </small>
                  <button
                    type="button"
                    onClick={() => navigate('/inventario?estado=expiring&orden=expiry')}
                  >
                    Revisar caducidades
                  </button>
                </div>
              </article>
              {sanitaryGaps.length ? (
                <article className="dash-prio-item">
                  <div className="dash-prio-icon">
                    <Icon name="alert" />
                  </div>
                  <div className="dash-prio-body">
                    <strong>
                      {sanitaryGaps.length === 1
                        ? '1 producto sin registro vigente'
                        : `${sanitaryGaps.length} productos sin registro vigente`}
                    </strong>
                    <small>{sanitaryGaps[0]?.name}. No se puede vender hasta actualizar el registro sanitario.</small>
                    <button type="button" onClick={() => navigate('/inventario')}>
                      Revisar registros
                    </button>
                  </div>
                </article>
              ) : null}
              <article className="dash-prio-item">
                <div className="dash-prio-icon">
                  <Icon name="spark" />
                </div>
                <div className="dash-prio-body">
                  <strong>
                    {productionAlerts} alerta{productionAlerts === 1 ? '' : 's'} de producción
                  </strong>
                  <span className="dash-prio-tag">Por validar</span>
                  <small>Revisa el stock antes de actuar.</small>
                  <button type="button" onClick={() => navigate('/compras')}>
                    Revisar alertas
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div className="dash-bottom">
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Inventario por línea</span>
            </div>
            <div className="dash-lines">
              {meta.categories.map((c) => {
                const q = state.products
                  .filter((p) => p.category === c)
                  .reduce((n, p) => n + stockIn(state, p.id, scope), 0);
                return (
                  <button
                    type="button"
                    className="dash-line"
                    key={c}
                    onClick={() => navigate(`/inventario?cat=${encodeURIComponent(c)}`)}
                  >
                    <span>{c}</span>
                    <strong>{num(q)}</strong>
                  </button>
                );
              })}
            </div>
            <p className="dash-lines-note">Las unidades físicas incluyen reservas.</p>
          </section>

          <section className="panel dash-value">
            <div className="panel-head">
              <span className="panel-title">Valor del inventario</span>
            </div>
            <div className="dash-value-body">
              <div className="dash-value-amount">{money(stockValue)}</div>
              <p>Valorado a costo promedio · a precio de venta {money(saleValue)}</p>
              {missingCost ? <p className="fx-muted">{missingCost} producto(s) con stock aún sin costo registrado.</p> : null}
              {unsellable ? <p><span className="fx-chip red">{unsellable} u. no vendibles</span> vencidas, retenidas o con poca vida útil</p> : null}
              {waiting ? (
                <p>
                  <button type="button" className="fx-link" onClick={() => navigate('/pedidos')}>
                    {waiting} pedido(s) esperando stock
                  </button>
                </p>
              ) : null}
              <button
                type="button"
                className="dash-kpi-link"
                onClick={() => navigate('/inventario')}
              >
                Ver detalle
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
