import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { client, money as moneyFmt, orderValue, orderWeight, product, statusColor } from '../../shared/lib/inventory';
import { Badge, Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';
import type { Order } from '../../shared/types';
import { RouteMap } from './RouteMap';
import {
  FLEET,
  activeOrders as getActiveOrders,
  cityOf,
  fmtHours,
  orderVolume,
  packagesOf,
  routeOrders,
  sectorOf,
  statusLabel,
  statusTone,
  suggestAutoAssign,
  truckLoad as calcTruckLoad,
  type AutoAssignPlan,
} from './fleet';
import '../../styles/logistics.css';

export function LogisticsPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [openCities, setOpenCities] = useState<Record<string, boolean>>({
    Quito: true,
    Guayaquil: true,
    Cuenca: true,
  });
  const [selectedTruck, setSelectedTruck] = useState('T01');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [listTab, setListTab] = useState<'pendientes' | 'listos' | 'en_ruta'>('listos');
  const [stagedByTruck, setStagedByTruck] = useState<Record<string, string[]>>({});
  const [pedidosTruckId, setPedidosTruckId] = useState<string | null>(null);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deliveryOrder, setDeliveryOrder] = useState<string | null>(null);
  const [incidentOrder, setIncidentOrder] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPlan, setAiPlan] = useState<AutoAssignPlan | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);

  const activeOrders = useMemo(() => (state ? getActiveOrders(state) : []), [state]);

  const stagedIds = useMemo(
    () => new Set(Object.values(stagedByTruck).flat()),
    [stagedByTruck],
  );

  const tabCounts = useMemo(() => {
    const pendientes = activeOrders.filter((o) => o.status === 'Por preparar').length;
    const listos = activeOrders.filter((o) => o.status === 'Preparado' && !stagedIds.has(o.id)).length;
    const enRuta = activeOrders.filter((o) => o.status === 'En ruta' || o.status === 'Incidencia').length;
    return { pendientes, listos, enRuta };
  }, [activeOrders, stagedIds]);

  const deliveryDate = useMemo(
    () =>
      new Date('2026-10-07T12:00:00').toLocaleDateString('es-EC', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [],
  );

  const grouped = useMemo(() => {
    if (!state) return [] as [string, Order[]][];
    const q = query.trim().toLowerCase();
    const map = new Map<string, Order[]>();
    for (const o of activeOrders) {
      if (listTab === 'pendientes' && o.status !== 'Por preparar') continue;
      if (listTab === 'listos' && (o.status !== 'Preparado' || stagedIds.has(o.id))) continue;
      if (listTab === 'en_ruta' && o.status !== 'En ruta' && o.status !== 'Incidencia') continue;

      const city = cityOf(state, o);
      const sector = sectorOf(state, o);
      if (
        q &&
        !city.toLowerCase().includes(q) &&
        !sector.toLowerCase().includes(q) &&
        !o.id.toLowerCase().includes(q) &&
        !(client(state, o.clientId)?.name ?? '').toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = map.get(city) ?? [];
      list.push(o);
      map.set(city, list);
    }
    const preferred = ['Quito', 'Guayaquil', 'Cuenca'];
    return [...map.entries()].sort((a, b) => {
      const ia = preferred.indexOf(a[0]);
      const ib = preferred.indexOf(b[0]);
      if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [activeOrders, query, state, listTab, stagedIds]);

  if (!state) return null;

  const detail = detailId ? state.orders.find((o) => o.id === detailId) : null;
  const detailClient = detail ? client(state, detail.clientId) : null;
  const detailTruck = detail?.vehicle ? FLEET.find((t) => t.plate === detail.vehicle) : null;

  const totalVolume = activeOrders.reduce((n, o) => n + orderVolume(state, o), 0);
  const totalWeight = activeOrders.reduce((n, o) => n + orderWeight(state, o), 0);
  const fleetMaxVolume = 120;
  const fleetMaxWeight = 10000;
  const trucksInUse = FLEET.filter((t) => activeOrders.some((o) => o.vehicle === t.plate));
  const avgEta = trucksInUse.length
    ? trucksInUse.reduce((n, t) => n + t.etaHours, 0) / trucksInUse.length
    : 4.5;

  const truck = FLEET.find((t) => t.id === selectedTruck) ?? FLEET[0];

  const stagedOrdersOf = (truckId: string) =>
    (stagedByTruck[truckId] ?? [])
      .map((id) => activeOrders.find((o) => o.id === id && o.status === 'Preparado'))
      .filter((o): o is Order => Boolean(o));

  const truckLoad = (t: (typeof FLEET)[number]) =>
    calcTruckLoad(state, t, activeOrders, stagedOrdersOf(t.id));

  const selectedLoad = truckLoad(truck);
  const assignedVolume = selectedLoad.m3;
  const assignedWeight = selectedLoad.kg;
  const volPct = selectedLoad.pct;
  const kgPct = selectedLoad.pct;

  const toggleOrder = (id: string) => {
    setSelectedOrders((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const readySelected = selectedOrders.filter((id) =>
    activeOrders.some((o) => o.id === id && o.status === 'Preparado' && !stagedIds.has(id)),
  );

  const stageToTruck = (truckId: string, orderIds: string[]) => {
    const ids = [...new Set(orderIds)].filter((id) =>
      activeOrders.some((o) => o.id === id && o.status === 'Preparado' && !stagedIds.has(id)),
    );
    if (!ids.length) return;
    setStagedByTruck((prev) => {
      const next: Record<string, string[]> = {};
      for (const [tid, list] of Object.entries(prev)) {
        next[tid] = list.filter((id) => !ids.includes(id));
      }
      next[truckId] = [...new Set([...(next[truckId] ?? []), ...ids])];
      return next;
    });
    setSelectedOrders((prev) => prev.filter((id) => !ids.includes(id)));
    setSelectedTruck(truckId);
    setDraggingId(null);
    setDropTarget(null);
    const name = FLEET.find((t) => t.id === truckId)?.label ?? truckId;
    toast(`${ids.length} pedido(s) cargado(s) en ${name}. Revisa Pedidos o Enviar camión.`);
  };

  const unstageOrder = (truckId: string, orderId: string) => {
    setStagedByTruck((prev) => ({
      ...prev,
      [truckId]: (prev[truckId] ?? []).filter((id) => id !== orderId),
    }));
  };

  const markReady = async (orderId: string) => {
    if (preparingId) return;
    setPreparingId(orderId);
    setError('');
    try {
      applyResponse(await api.prepare(orderId));
      toast(`${orderId.replace('PED-', 'Pedido #')} listo para asignar.`);
      setListTab('listos');
      setDetailId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo marcar listo';
      setError(msg);
      toast(msg);
    } finally {
      setPreparingId(null);
    }
  };

  const sendTruck = async (truckId: string) => {
    const t = FLEET.find((x) => x.id === truckId);
    const ids = stagedByTruck[truckId] ?? [];
    if (!t || !ids.length || assigning) return;
    setAssigning(true);
    setError('');
    try {
      applyResponse(await api.dispatch(ids, t.plate));
      toast(`${t.label} enviado con ${ids.length} pedido(s).`);
      setStagedByTruck((prev) => ({ ...prev, [truckId]: [] }));
      setPedidosTruckId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      toast(err instanceof Error ? err.message : 'No se pudo enviar el camión');
    } finally {
      setAssigning(false);
    }
  };

  const runAiAutoAssign = async () => {
    if (!state || aiBusy) return;
    const ready = activeOrders.filter((o) => o.status === 'Preparado' && !stagedIds.has(o.id) && !o.vehicle);
    if (!ready.length) {
      toast('No hay pedidos listos para autoasignar.');
      setListTab('listos');
      return;
    }
    setAiBusy(true);
    setError('');
    try {
      let plan: AutoAssignPlan;
      try {
        const res = await api.logisticsAutoAssign({
          orderIds: ready.map((o) => o.id),
          stagedByTruck,
          fleet: FLEET.map((t) => ({
            id: t.id,
            plate: t.plate,
            label: t.label,
            city: t.city,
            driver: t.driver,
            maxKg: t.maxKg,
            maxM3: t.maxM3,
            costPerKm: t.costPerKm,
          })),
        });
        plan = res.plan;
      } catch {
        plan = suggestAutoAssign(state, ready, stagedByTruck);
        plan.source = 'heuristic';
        plan.summary = `Sin respuesta de IA · ${plan.summary}`;
      }

      if (plan.assignments.length) {
        setStagedByTruck((prev) => {
          const next: Record<string, string[]> = { ...prev };
          for (const [truckId, ids] of Object.entries(plan.byTruck)) {
            next[truckId] = [...new Set([...(next[truckId] ?? []), ...ids])];
          }
          return next;
        });
        const firstTruck = Object.keys(plan.byTruck)[0];
        if (firstTruck) setSelectedTruck(firstTruck);
        setSelectedOrders([]);
      }
      setListTab('listos');
      setAiPlan(plan);
      toast(plan.summary);
    } finally {
      setAiBusy(false);
    }
  };

  const submitDelivery = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.delivery({
          orderId: String(data.orderId),
          person: String(data.person),
          notes: String(data.notes ?? ''),
        }),
      );
      toast('Entrega confirmada.');
      setDeliveryOrder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const submitIncident = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.incident({
          orderId: String(data.orderId),
          reason: String(data.reason),
          notes: String(data.notes ?? ''),
        }),
      );
      toast('Novedad registrada.');
      setIncidentOrder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="log-page">
      <PageHead
        eyebrow="Logística"
        title="Distribución"
        desc="Asigne pedidos a camiones y genera rutas eficientes"
        actions={
          <div className="log-head-actions">
            <div className="log-date-chip">
              <Icon name="calendar" />
              Fecha de entrega: {deliveryDate}
            </div>
            <Btn
              icon="spark"
              variant="primary"
              disabled={aiBusy || assigning}
              onClick={() => void runAiAutoAssign()}
            >
              {aiBusy ? 'Analizando…' : 'IA autoasignar'}
            </Btn>
          </div>
        }
      />

      <section className="log-metrics" aria-label="Resumen de distribución">
        <article className="log-metric">
          <div className="log-metric-label">
            Total de pedidos <Icon name="orders" />
          </div>
          <strong>{activeOrders.length}</strong>
          <span>en operación</span>
        </article>
        <article className="log-metric">
          <div className="log-metric-label">
            Volumen total <Icon name="box" />
          </div>
          <strong>
            {totalVolume.toFixed(1)}
            <small>m³</small>
          </strong>
          <span>de {fleetMaxVolume} m³</span>
        </article>
        <article className="log-metric">
          <div className="log-metric-label">
            Peso total <Icon name="truck" />
          </div>
          <strong>
            {Math.round(totalWeight).toLocaleString('es-EC')}
            <small>kg</small>
          </strong>
          <span>de {fleetMaxWeight.toLocaleString('es-EC')} kg</span>
        </article>
        <article className="log-metric">
          <div className="log-metric-label">
            Tiempo estimado <Icon name="route" />
          </div>
          <strong>{fmtHours(avgEta)}</strong>
          <span>promedio de entrega</span>
        </article>
      </section>

      <div className="log-layout">
        <section className="log-panel" aria-label="Pedidos por ciudad">
          <header>
            <h2>Pedidos por ciudad / sector</h2>
            <p>
              En Pendientes usa <strong>Marcar listo</strong>. Luego arrastra los Listos al camión o usa IA
              autoasignar.
            </p>
          </header>

          <div className="log-list-tabs" role="tablist" aria-label="Estado de pedidos">
            <button
              type="button"
              role="tab"
              className={listTab === 'pendientes' ? 'is-active' : ''}
              aria-selected={listTab === 'pendientes'}
              onClick={() => setListTab('pendientes')}
            >
              Pendientes <span>{tabCounts.pendientes}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={listTab === 'listos' ? 'is-active' : ''}
              aria-selected={listTab === 'listos'}
              onClick={() => setListTab('listos')}
            >
              Listos <span>{tabCounts.listos}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={listTab === 'en_ruta' ? 'is-active' : ''}
              aria-selected={listTab === 'en_ruta'}
              onClick={() => setListTab('en_ruta')}
            >
              En ruta <span>{tabCounts.enRuta}</span>
            </button>
          </div>

          <label className="log-search">
            <Icon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ciudad o sector..."
              aria-label="Buscar ciudad o sector"
            />
          </label>

          {grouped.length ? (
            <ul className="log-cities">
              {grouped.map(([city, orders]) => {
                const open = openCities[city] ?? true;
                return (
                  <li key={city} className={`log-city ${open ? 'is-open' : ''}`}>
                    <button
                      type="button"
                      className="log-city-toggle"
                      onClick={() => setOpenCities((prev) => ({ ...prev, [city]: !open }))}
                    >
                      <Icon name="chevron" className="log-city-chevron" />
                      <strong>{city}</strong>
                      <span className="log-city-count">
                        {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}
                      </span>
                    </button>
                    {open ? (
                      <ul className="log-orders">
                        {orders.map((o) => {
                          const selectable = o.status === 'Preparado' && !stagedIds.has(o.id);
                          const selected = selectedOrders.includes(o.id);
                          const pkgs = packagesOf(o);
                          return (
                            <li
                              key={o.id}
                              className={`log-order ${selected ? 'is-selected' : ''} ${draggingId === o.id ? 'is-dragging' : ''} ${selectable ? 'is-draggable' : ''}`}
                              draggable={selectable}
                              onDragStart={(e) => {
                                if (!selectable) return;
                                setDraggingId(o.id);
                                e.dataTransfer.setData('text/plain', o.id);
                                e.dataTransfer.effectAllowed = 'move';
                                if (!selectedOrders.includes(o.id)) {
                                  setSelectedOrders((prev) => [...prev, o.id]);
                                }
                              }}
                              onDragEnd={() => {
                                setDraggingId(null);
                                setDropTarget(null);
                              }}
                            >
                              <input
                                className="log-order-check"
                                type="checkbox"
                                checked={selected}
                                disabled={!selectable}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleOrder(o.id)}
                                aria-label={`Seleccionar ${o.id}`}
                              />
                              <button
                                type="button"
                                className="log-order-main"
                                onClick={() => setDetailId(o.id)}
                              >
                                <span>
                                  <strong>Pedido {o.id.replace('PED-', '#')}</strong>
                                  <small>
                                    {sectorOf(state, o)} · {client(state, o.clientId)?.name} ·{' '}
                                    {orderWeight(state, o).toFixed(1)} kg
                                  </small>
                                </span>
                                <span className="log-order-meta">
                                  <span className={`log-status log-status-${statusTone(o.status)}`}>
                                    {statusLabel(o.status)}
                                  </span>
                                  <em>
                                    {pkgs} {pkgs === 1 ? 'paquete' : 'paquetes'}
                                  </em>
                                </span>
                              </button>
                              {o.status === 'Por preparar' ? (
                                <button
                                  type="button"
                                  className="log-order-ready btn small primary"
                                  disabled={preparingId === o.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void markReady(o.id);
                                  }}
                                >
                                  <Icon name="check" />
                                  {preparingId === o.id ? 'Preparando…' : 'Marcar listo'}
                                </button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="log-empty">
              {listTab === 'listos'
                ? 'No hay pedidos listos por asignar.'
                : listTab === 'pendientes'
                  ? 'No hay pedidos pendientes de preparar.'
                  : 'No hay pedidos en ruta.'}
            </p>
          )}
        </section>

        <aside className="log-side">
          <section className="log-assign" aria-label="Resumen de la asignación">
            <h3>Resumen de la asignación</h3>
            <div className="log-assign-row">
              <div>
                <span>Volumen asignado</span>
                <strong>
                  {assignedVolume.toFixed(1)} m³ · {volPct}%
                </strong>
              </div>
              <div className={`log-bar ${volPct >= 95 ? 'is-red' : volPct > 55 ? 'is-amber' : 'is-green'}`}>
                <span style={{ width: `${volPct}%` }} />
              </div>
            </div>
            <div className="log-assign-row">
              <div>
                <span>Peso asignado</span>
                <strong>
                  {Math.round(assignedWeight).toLocaleString('es-EC')} kg · {kgPct}%
                </strong>
              </div>
              <div className={`log-bar ${kgPct >= 95 ? 'is-red' : kgPct > 55 ? 'is-amber' : 'is-green'}`}>
                <span style={{ width: `${kgPct}%` }} />
              </div>
            </div>
          </section>

          <section className="log-panel log-trucks" aria-label="Camiones disponibles">
            <div className="log-trucks-head">
              <h3>
                <Icon name="truck" />
                Camiones disponibles
              </h3>
              <button type="button" className="log-filter-btn">
                <Icon name="search" />
                Filtrar
              </button>
            </div>
            <ul className="log-truck-list">
              {FLEET.map((t) => {
                const load = truckLoad(t);
                const active = selectedTruck === t.id;
                const tone = load.status === 'full' ? 'red' : load.status === 'partial' ? 'amber' : 'green';
                const isDrop = dropTarget === t.id;
                return (
                  <li key={t.id}>
                    <div
                      className={`log-truck log-truck-${tone} ${active ? 'is-active' : ''} ${isDrop ? 'is-drop-target' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTruck(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedTruck(t.id);
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTarget(t.id);
                        setSelectedTruck(t.id);
                      }}
                      onDragLeave={() => {
                        setDropTarget((prev) => (prev === t.id ? null : prev));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dropped = e.dataTransfer.getData('text/plain');
                        const ids = readySelected.includes(dropped)
                          ? readySelected
                          : dropped
                            ? [...readySelected, dropped]
                            : readySelected;
                        stageToTruck(t.id, ids);
                      }}
                    >
                      <div className="log-truck-top">
                        <div className="log-truck-title">
                          <span className={`log-truck-icon log-truck-icon-${tone}`}>
                            <Icon name="truck" />
                          </span>
                          <strong>
                            {t.label} - {t.city}
                          </strong>
                        </div>
                        <span className={`log-truck-badge ${load.status}`}>
                          <i aria-hidden />
                          {load.label}
                        </span>
                      </div>

                      <div className="log-truck-metrics">
                        <div>
                          <span>Capacidad (kg)</span>
                          <strong>{t.maxKg.toLocaleString('es-EC')}</strong>
                        </div>
                        <div>
                          <span>Volumen (m³)</span>
                          <strong>{t.maxM3}</strong>
                        </div>
                        <div>
                          <span>Costo por km</span>
                          <strong>${t.costPerKm.toFixed(2)}</strong>
                        </div>
                      </div>

                      <div className={`log-truck-bar log-bar is-${tone}`}>
                        <span style={{ width: `${Math.max(load.pct, load.kg > 0 ? 2 : 0)}%` }} />
                      </div>
                      <div className="log-truck-foot">
                        <em>
                          {load.kg.toLocaleString('es-EC')} kg | {load.m3.toFixed(1)} m³
                          {load.pending.length ? ` · ${load.pending.length} en carga` : ''}
                        </em>
                        <strong>{load.pct}%</strong>
                      </div>
                      {isDrop ? (
                        <p className="log-drop-hint">Suelta aquí para cargar en el camión</p>
                      ) : null}

                      {active ? (
                        <div className="log-truck-actions">
                          {readySelected.length ? (
                            <Btn
                              icon="plus"
                              onClick={() => stageToTruck(t.id, readySelected)}
                            >
                              Cargar seleccionados
                            </Btn>
                          ) : null}
                          <Btn
                            icon="orders"
                            onClick={() => {
                              setSelectedTruck(t.id);
                              setPedidosTruckId(t.id);
                            }}
                          >
                            Pedidos ({load.pending.length + load.orders.length})
                          </Btn>
                          <Btn
                            variant="primary"
                            icon="truck"
                            disabled={!load.pending.length || assigning}
                            onClick={() => void sendTruck(t.id)}
                          >
                            {assigning ? 'Enviando…' : 'Enviar camión'}
                          </Btn>
                          {load.orders
                            .filter((o) => o.status === 'En ruta' || o.status === 'Incidencia')
                            .slice(0, 1)
                            .map((o) => (
                              <Btn
                                key={o.id}
                                icon="check"
                                variant="green"
                                onClick={() => {
                                  setError('');
                                  setDeliveryOrder(o.id);
                                }}
                              >
                                Confirmar entrega
                              </Btn>
                            ))}
                          {load.orders.some((o) => o.status === 'En ruta') ? (
                            <Btn
                              icon="alert"
                              onClick={() => {
                                const o = load.orders.find((x) => x.status === 'En ruta');
                                if (!o) return;
                                setError('');
                                setIncidentOrder(o.id);
                              }}
                            >
                              Novedad
                            </Btn>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="log-panel log-routes" aria-label="Resumen de rutas">
            <div className="log-trucks-head">
              <h3>
                <Icon name="route" />
                Resumen de rutas
              </h3>
              <div className="log-routes-actions">
                <Btn icon="route" onClick={() => navigate('/logistica/rutas')}>
                  Ver todas
                </Btn>
                <Btn icon="history" onClick={() => navigate('/logistica/historial')}>
                  Historial
                </Btn>
              </div>
            </div>
            <ul className="log-route-list">
              {FLEET.map((t, index) => {
                const load = truckLoad(t);
                const tone = load.status === 'full' ? 'red' : load.status === 'partial' ? 'amber' : 'green';
                const open = expandedRoute === t.id;
                const stops = routeOrders(state, t.plate);
                const showStops = stops.length ? stops : load.orders.slice(0, 4);
                return (
                  <li key={t.id} className={`log-route-card ${open ? 'is-open' : ''}`}>
                    <button
                      type="button"
                      className="log-route"
                      onClick={() => {
                        setExpandedRoute(open ? null : t.id);
                        setSelectedTruck(t.id);
                      }}
                    >
                      <span className={`log-route-num log-route-num-${tone}`}>{index + 1}</span>
                      <span className="log-route-copy">
                        <strong>
                          {t.label} - {t.city}
                        </strong>
                        <small>
                          {fmtHours(t.etaHours)} | {moneyFmt(t.routeKm * t.costPerKm)}
                        </small>
                      </span>
                      <span className="log-route-eta">{fmtHours(t.etaHours)}</span>
                      <Icon name="chevron" className={`log-route-chevron ${open ? 'is-open' : ''}`} />
                    </button>

                    {open ? (
                      <div className="log-route-detail">
                        <div className="log-route-detail-grid">
                          <RouteMap
                            state={state}
                            orders={showStops}
                            city={t.city}
                            onSelect={(id) => setDetailId(id)}
                            showFullButton
                            onFullRoute={() => navigate('/logistica/rutas', { state: { truckId: t.id } })}
                          />
                          <div>
                            <ul className="log-route-stats">
                              <li>
                                <Icon name="history" />
                                <span>
                                  Tiempo estimado: <strong>{fmtHours(t.etaHours)}</strong>
                                </span>
                              </li>
                              <li>
                                <Icon name="spark" />
                                <span>
                                  Costo estimado: <strong>{moneyFmt(t.routeKm * t.costPerKm)}</strong>
                                </span>
                              </li>
                              <li>
                                <Icon name="route" />
                                <span>
                                  Distancia total: <strong>{t.routeKm} km</strong>
                                </span>
                              </li>
                            </ul>
                            <h4>Puntos de entrega</h4>
                            {showStops.length ? (
                              <ol className="log-route-points">
                                {showStops.map((o) => (
                                  <li key={o.id}>
                                    <button type="button" onClick={() => setDetailId(o.id)}>
                                      <strong>{client(state, o.clientId)?.name ?? o.clientId}</strong>
                                      <small>
                                        {sectorOf(state, o)} · {o.id}
                                      </small>
                                    </button>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <p className="log-empty">Sin paradas asignadas a este camión.</p>
                            )}
                            <div className="log-route-detail-actions">
                              <Btn
                                variant="primary"
                                icon="route"
                                onClick={() => navigate('/logistica/rutas', { state: { truckId: t.id } })}
                              >
                                Pantalla de rutas
                              </Btn>
                              <Btn icon="history" onClick={() => navigate('/logistica/historial')}>
                                Historial de camiones
                              </Btn>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>

      {detail ? (
        <Modal
          title={`Pedido ${detail.id.replace('PED-', '#')}`}
          subtitle={`${detailClient?.name ?? detail.clientId} · ${cityOf(state, detail)}`}
          onClose={() => setDetailId(null)}
          footer={
            <div className="log-detail-actions">
              {detail.status === 'Por preparar' ? (
                <Btn
                  variant="primary"
                  icon="check"
                  disabled={preparingId === detail.id}
                  onClick={() => void markReady(detail.id)}
                >
                  {preparingId === detail.id ? 'Preparando…' : 'Marcar listo'}
                </Btn>
              ) : null}
              {detail.status === 'Preparado' && !stagedIds.has(detail.id) ? (
                <Btn
                  variant="primary"
                  icon="truck"
                  onClick={() => {
                    stageToTruck(selectedTruck, [detail.id]);
                    setDetailId(null);
                  }}
                >
                  Cargar en {truck.label}
                </Btn>
              ) : null}
              {detail.status === 'En ruta' || detail.status === 'Incidencia' ? (
                <>
                  <Btn
                    variant="green"
                    icon="check"
                    onClick={() => {
                      setDetailId(null);
                      setError('');
                      setDeliveryOrder(detail.id);
                    }}
                  >
                    Confirmar entrega
                  </Btn>
                  {detail.status === 'En ruta' ? (
                    <Btn
                      icon="alert"
                      onClick={() => {
                        setDetailId(null);
                        setError('');
                        setIncidentOrder(detail.id);
                      }}
                    >
                      Novedad
                    </Btn>
                  ) : null}
                </>
              ) : null}
              <Btn onClick={() => setDetailId(null)}>Cerrar</Btn>
            </div>
          }
        >
          <div className="log-detail">
            <div className="log-detail-status">
              <Badge text={detail.status} color={statusColor(detail.status)} />
              {detail.priority ? <span className="log-detail-chip">Prioridad {detail.priority}</span> : null}
              {detail.vehicle ? (
                <span className="log-detail-chip">
                  {detailTruck ? `${detailTruck.label} · ${detail.vehicle}` : detail.vehicle}
                </span>
              ) : null}
            </div>

            <dl className="log-detail-grid">
              <div>
                <dt>Cliente</dt>
                <dd>{detailClient?.name ?? detail.clientId}</dd>
              </div>
              <div>
                <dt>Contacto</dt>
                <dd>{detailClient?.contact || '—'}</dd>
              </div>
              <div>
                <dt>Ciudad / sector</dt>
                <dd>
                  {cityOf(state, detail)} · {sectorOf(state, detail)}
                </dd>
              </div>
              <div>
                <dt>Dirección</dt>
                <dd>{detailClient?.address || '—'}</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{detail.date}</dd>
              </div>
              <div>
                <dt>Carga</dt>
                <dd>
                  {orderWeight(state, detail).toFixed(1)} kg · {orderVolume(state, detail).toFixed(2)} m³ ·{' '}
                  {packagesOf(detail)} {packagesOf(detail) === 1 ? 'paquete' : 'paquetes'}
                </dd>
              </div>
            </dl>

            {detail.incident ? (
              <p className="log-detail-incident">
                <Icon name="alert" />
                {detail.incident}
              </p>
            ) : null}

            <h4 className="log-detail-lines-title">Productos del pedido</h4>
            <ul className="log-detail-lines">
              {detail.lines.map((l) => {
                const p = product(state, l.productId);
                return (
                  <li key={l.productId}>
                    <div>
                      <strong>{p?.name ?? l.productId}</strong>
                      <small>
                        {l.productId} · {p?.weight ?? 0} kg/u
                      </small>
                    </div>
                    <em>× {l.qty}</em>
                  </li>
                );
              })}
            </ul>

            <div className="log-detail-total">
              <span>Total</span>
              <strong>{moneyFmt(orderValue(state, detail))}</strong>
            </div>
          </div>
        </Modal>
      ) : null}

      {pedidosTruckId ? (() => {
        const pt = FLEET.find((t) => t.id === pedidosTruckId) ?? truck;
        const staged = stagedOrdersOf(pt.id);
        const onRoute = activeOrders.filter((o) => o.vehicle === pt.plate);
        return (
          <Modal
            title={`Pedidos · ${pt.label}`}
            subtitle={`${pt.plate} · saca pedidos de la carga o envía el camión`}
            onClose={() => setPedidosTruckId(null)}
            footer={
              <div className="log-detail-actions">
                <Btn
                  variant="primary"
                  icon="truck"
                  disabled={!staged.length || assigning}
                  onClick={() => void sendTruck(pt.id)}
                >
                  {assigning ? 'Enviando…' : 'Enviar camión'}
                </Btn>
                <Btn onClick={() => setPedidosTruckId(null)}>Cerrar</Btn>
              </div>
            }
          >
            <div className="log-pedidos-modal">
              <h4>En carga (aún no enviados)</h4>
              {staged.length ? (
                <ul className="log-detail-lines">
                  {staged.map((o) => (
                    <li key={o.id}>
                      <div>
                        <strong>
                          {o.id} · {client(state, o.clientId)?.name}
                        </strong>
                        <small>
                          {sectorOf(state, o)} · {orderWeight(state, o).toFixed(1)} kg ·{' '}
                          {orderVolume(state, o).toFixed(2)} m³
                        </small>
                      </div>
                      <Btn
                        variant="danger"
                        icon="close"
                        onClick={() => unstageOrder(pt.id, o.id)}
                      >
                        Sacar
                      </Btn>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle">No hay pedidos en carga. Arrastra listos al camión.</p>
              )}

              <h4>Ya en ruta</h4>
              {onRoute.length ? (
                <ul className="log-detail-lines">
                  {onRoute.map((o) => (
                    <li key={o.id}>
                      <div>
                        <strong>
                          {o.id} · {client(state, o.clientId)?.name}
                        </strong>
                        <small>
                          {statusLabel(o.status)} · {orderWeight(state, o).toFixed(1)} kg
                        </small>
                      </div>
                      <Badge text={o.status} color={statusColor(o.status)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle">Sin pedidos despachados en este camión.</p>
              )}
              {error ? <div className="form-error visible">{error}</div> : null}
            </div>
          </Modal>
        );
      })() : null}

      {deliveryOrder ? (
        <Modal
          title="Confirmar entrega"
          subtitle={deliveryOrder}
          onClose={() => setDeliveryOrder(null)}
          footer={
            <ModalActions
              onCancel={() => setDeliveryOrder(null)}
              submitLabel="Registrar entrega"
              formId="delivery-form"
              icon="check"
            />
          }
        >
          <form id="delivery-form" onSubmit={submitDelivery}>
            <input type="hidden" name="orderId" value={deliveryOrder} />
            <div className="field">
              <label htmlFor="delivery-person">Quien recibe</label>
              <input id="delivery-person" name="person" required />
            </div>
            <div className="field">
              <label htmlFor="delivery-notes">Observaciones</label>
              <textarea id="delivery-notes" name="notes" />
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}

      {incidentOrder ? (
        <Modal
          title="Registrar novedad"
          subtitle={incidentOrder}
          onClose={() => setIncidentOrder(null)}
          footer={
            <ModalActions onCancel={() => setIncidentOrder(null)} submitLabel="Guardar" formId="incident-form" />
          }
        >
          <form id="incident-form" onSubmit={submitIncident}>
            <input type="hidden" name="orderId" value={incidentOrder} />
            <div className="field">
              <label htmlFor="incident-reason">Motivo</label>
              <select id="incident-reason" name="reason">
                <option>Cliente ausente</option>
                <option>Dirección no localizada</option>
                <option>Recepción no autorizada</option>
                <option>Producto con novedad</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="incident-notes">Detalle</label>
              <textarea id="incident-notes" name="notes" />
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}

      {aiPlan ? (
        <Modal
          title="Análisis IA · Autoasignación"
          subtitle={aiPlan.summary}
          onClose={() => setAiPlan(null)}
          footer={
            <div className="modal-actions">
              <Btn variant="primary" icon="check" onClick={() => setAiPlan(null)}>
                Entendido
              </Btn>
            </div>
          }
        >
          <div className="log-ai-plan">
            <p className="subtle">
              Fuente:{' '}
              <strong>{aiPlan.source === 'openai' ? 'OpenAI' : 'Heurística local'}</strong>. Criterios:
              ciudad, capacidad kg/m³, ocupación y costo/km. Los pedidos quedaron en carga. Usa{' '}
              <strong>Enviar camión</strong> para despachar.
            </p>
            {Object.entries(aiPlan.byTruck).map(([truckId, ids]) => {
              const t = FLEET.find((x) => x.id === truckId);
              const items = aiPlan.assignments.filter((a) => a.truckId === truckId);
              return (
                <div key={truckId} className="log-ai-truck">
                  <h4>
                    {t?.label ?? truckId} · {t?.plate} · {t?.city}
                  </h4>
                  <small>
                    Cap. {t?.maxKg.toLocaleString('es-EC')} kg / {t?.maxM3} m³ · ${t?.costPerKm}/km ·{' '}
                    {ids.length} pedido(s)
                  </small>
                  <ul>
                    {items.map((a) => (
                      <li key={a.orderId}>
                        <strong>{a.orderId}</strong>
                        <span>
                          {a.kg} kg · {a.m3} m³
                        </span>
                        <em>{a.reason}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {aiPlan.unassigned.length ? (
              <div className="log-ai-truck is-warn">
                <h4>Sin asignar</h4>
                <ul>
                  {aiPlan.unassigned.map((u) => (
                    <li key={u.orderId}>
                      <strong>{u.orderId}</strong>
                      <span>
                        {u.city} · {u.kg} kg · {u.m3} m³
                      </span>
                      <em>{u.reason}</em>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
