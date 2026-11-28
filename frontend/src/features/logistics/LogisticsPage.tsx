import { useEffect, useMemo, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import {
  client,
  money as moneyFmt,
  orderValue,
  orderLoadKg,
  product,
  statusColor,
} from '../../shared/lib/inventory';
import { Badge, Btn, Empty, Kpi, KpiGrid, PageHead, Button } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';
import type { Order } from '../../shared/types';
import { RouteMap } from './RouteMap';
import { FleetManagePanel } from './FleetManagePanel';
import {
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
  truckRouteCost,
  vehicleAllowsSector,
  vehicleIconName,
  vehicleKindLabel,
  type AutoAssignPlan,
  type Truck,
} from './fleet';
import '../../styles/logistics.css';
import { Checkbox } from '../../shared/components/Checkbox';
import { Input, Textarea } from '../../shared/components/Input';
import { SearchInput } from '../../shared/components/SearchInput';
import { SegmentedControl, TabPanel, Tabs } from '../../shared/components/Tabs';

type MainTab = 'distribucion' | 'rutas' | 'flota';

export function LogisticsPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [fleet, setFleet] = useState<Truck[]>([]);
  const [fleetReady, setFleetReady] = useState(false);
  const [query, setQuery] = useState('');
  const [openCities, setOpenCities] = useState<Record<string, boolean>>({
    Quito: true,
    Guayaquil: true,
    Cuenca: true,
  });
  const [selectedTruck, setSelectedTruck] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('distribucion');
  const [listTab, setListTab] = useState<'pendientes' | 'listos' | 'en_ruta'>('listos');
  const [draftStaged, setDraftStaged] = useState<Record<string, string[]>>({});
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

  const applyFleet = (trucks: Truck[]) => {
    setFleet(trucks);
    setSelectedTruck((cur) => (trucks.some((t) => t.id === cur) ? cur : (trucks[0]?.id ?? '')));
    setFleetReady(true);
  };

  useEffect(() => {
    void api
      .fleet()
      .then((r) => {
        applyFleet(Array.isArray(r.trucks) ? r.trucks : []);
      })
      .catch(() => {
        applyFleet([]);
      });
  }, []);

  const activeOrders = useMemo(() => (state ? getActiveOrders(state) : []), [state]);

  /** Carga = la confirmada en Empaque (guardada) más lo que se está armando aquí. */
  const stagedByTruck = useMemo(() => {
    const saved = activeOrders
      .filter((o) => o.status === 'Preparado' && o.stagedPlate)
      .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
    const savedIds = new Set(saved.map((o) => o.id));
    const out: Record<string, string[]> = {};
    for (const t of fleet) {
      const ids = saved
        .filter((o) => o.stagedPlate?.toUpperCase() === t.plate.toUpperCase())
        .map((o) => o.id);
      const draft = (draftStaged[t.id] ?? []).filter((id) => !savedIds.has(id));
      if (ids.length || draft.length) out[t.id] = [...ids, ...draft];
    }
    return out;
  }, [activeOrders, fleet, draftStaged]);

  const stagedIds = useMemo(() => new Set(Object.values(stagedByTruck).flat()), [stagedByTruck]);

  const tabCounts = useMemo(() => {
    const pendientes = activeOrders.filter((o) => o.status === 'Por preparar').length;
    const listos = activeOrders.filter(
      (o) => o.status === 'Preparado' && !stagedIds.has(o.id),
    ).length;
    const enRuta = activeOrders.filter(
      (o) => o.status === 'En ruta' || o.status === 'Incidencia',
    ).length;
    return { pendientes, listos, enRuta };
  }, [activeOrders, stagedIds]);

  const deliveryDate = useMemo(
    () =>
      new Date().toLocaleDateString('es-EC', {
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
  const detailTruck = detail?.vehicle ? fleet.find((t) => t.plate === detail.vehicle) : null;

  const totalVolume = activeOrders.reduce((n, o) => n + orderVolume(state, o), 0);
  const totalWeight = activeOrders.reduce((n, o) => n + orderLoadKg(state, o), 0);
  const fleetMaxVolume = 120;
  const fleetMaxWeight = 10000;
  const trucksInUse = fleet.filter((t) => activeOrders.some((o) => o.vehicle === t.plate));
  const avgEta = trucksInUse.length
    ? trucksInUse.reduce((n, t) => n + t.etaHours, 0) / trucksInUse.length
    : 4.5;

  const truck = fleet.find((t) => t.id === selectedTruck) ?? fleet[0];

  const stagedOrdersOf = (truckId: string) =>
    (stagedByTruck[truckId] ?? [])
      .map((id) => activeOrders.find((o) => o.id === id && o.status === 'Preparado'))
      .filter((o): o is Order => Boolean(o));

  const truckLoad = (t: Truck) => calcTruckLoad(state!, t, activeOrders, stagedOrdersOf(t.id));

  const emptyLoad = {
    kg: 0,
    m3: 0,
    pct: 0,
    status: 'ok' as const,
    label: 'Disponible',
    orders: [] as Order[],
    pending: [] as Order[],
  };
  const selectedLoad = truck && state ? truckLoad(truck) : emptyLoad;
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
    const truck = fleet.find((t) => t.id === truckId);
    const ids = [...new Set(orderIds)].filter((id) =>
      activeOrders.some((o) => o.id === id && o.status === 'Preparado' && !stagedIds.has(id)),
    );
    if (!ids.length || !truck) return;
    const allowed: string[] = [];
    const blocked: string[] = [];
    for (const id of ids) {
      const o = activeOrders.find((x) => x.id === id);
      if (!o) continue;
      if (vehicleAllowsSector(truck, sectorOf(state!, o))) allowed.push(id);
      else blocked.push(id);
    }
    if (blocked.length) {
      toast(
        `${blocked.length} pedido(s) fuera de zona de ${truck.label}` +
          (truck.allowedSectors?.length ? ` (${truck.allowedSectors.join(', ')})` : ''),
      );
    }
    if (!allowed.length) return;
    setDraftStaged((prev) => {
      const next: Record<string, string[]> = {};
      for (const [tid, list] of Object.entries(prev)) {
        next[tid] = list.filter((id) => !allowed.includes(id));
      }
      next[truckId] = [...new Set([...(next[truckId] ?? []), ...allowed])];
      return next;
    });
    setSelectedOrders((prev) => prev.filter((id) => !allowed.includes(id)));
    setSelectedTruck(truckId);
    setDraggingId(null);
    setDropTarget(null);
    toast(`${allowed.length} pedido(s) cargado(s) en ${truck.label}. Revisa Pedidos o Enviar.`);
  };

  const unstageOrder = async (truckId: string, orderId: string) => {
    const saved = activeOrders.find((o) => o.id === orderId && o.stagedPlate);
    if (!saved) {
      setDraftStaged((prev) => ({
        ...prev,
        [truckId]: (prev[truckId] ?? []).filter((id) => id !== orderId),
      }));
      return;
    }
    // Está en la carga confirmada: se guarda la carga sin ese pedido.
    const plate = saved.stagedPlate!;
    const rest = activeOrders
      .filter((o) => o.status === 'Preparado' && o.stagedPlate === plate && o.id !== orderId)
      .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
    try {
      applyResponse(
        rest.length
          ? await api.confirmLoad({
              plate,
              orderIds: rest.map((o) => o.id),
              reason: rest.find((o) => o.loadNote)?.loadNote,
            })
          : await api.releaseLoad(plate),
      );
      toast(`${orderId} salió de la carga de ${plate}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo retirar de la carga');
    }
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
    const t = fleet.find((x) => x.id === truckId);
    const ids = stagedByTruck[truckId] ?? [];
    if (!t || !ids.length || assigning) return;
    setAssigning(true);
    setError('');
    try {
      const res = await api.dispatch(ids, t.plate);
      applyResponse(res);
      if (Array.isArray(res.trucks) && res.trucks.length) {
        applyFleet(res.trucks as Truck[]);
      }
      const kmMsg = res.km
        ? ` · +${res.km.added} km (odómetro ${res.km.odometerKm.toLocaleString('es-EC')} km)`
        : '';
      toast(`${t.label} enviado con ${ids.length} pedido(s)${kmMsg}.`);
      setDraftStaged((prev) => ({ ...prev, [truckId]: [] }));
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
    const ready = activeOrders.filter(
      (o) => o.status === 'Preparado' && !stagedIds.has(o.id) && !o.vehicle,
    );
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
          fleet: fleet.map((t) => ({
            id: t.id,
            plate: t.plate,
            label: t.label,
            city: t.city,
            driver: t.driver,
            maxKg: t.maxKg,
            maxM3: t.maxM3,
            costPerKm: t.costPerKm,
            allowedSectors: t.allowedSectors ?? [],
          })),
        });
        plan = res.plan;
      } catch {
        plan = suggestAutoAssign(state, ready, stagedByTruck, fleet);
        plan.source = 'heuristic';
        plan.summary = `Sin respuesta de IA · ${plan.summary}`;
      }

      if (plan.assignments.length) {
        setDraftStaged((prev) => {
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
          code: String(data.code ?? ''),
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

  const pageTitle =
    mainTab === 'flota' ? 'Gestión de flota' : mainTab === 'rutas' ? 'Rutas' : 'Distribución';
  const pageDesc =
    mainTab === 'flota'
      ? 'Alta de vehículos, cobertura por zonas y costo real de transporte'
      : mainTab === 'rutas'
        ? 'Rutas previstas por vehículo: tiempo, costo y mapa'
        : 'Asigna pedidos a camiones y genera rutas eficientes';

  return (
    <div className="log-page">
      <PageHead
        eyebrow="Logística"
        title={pageTitle}
        desc={pageDesc}
        actions={
          <div className="log-head-actions">
            <div className="log-date-chip">
              <Icon name="calendar" />
              Fecha de entrega: {deliveryDate}
            </div>
            {mainTab === 'distribucion' ? (
              <Btn
                icon="spark"
                variant="primary"
                disabled={aiBusy || assigning}
                onClick={() => void runAiAutoAssign()}
              >
                {aiBusy ? 'Analizando…' : 'IA autoasignar'}
              </Btn>
            ) : null}
          </div>
        }
      />

      <Tabs
        label="Secciones de logística"
        value={mainTab}
        onValueChange={setMainTab}
        items={[
          { value: 'distribucion', label: 'Distribución', icon: 'truck' },
          { value: 'rutas', label: 'Rutas', icon: 'route' },
          { value: 'flota', label: 'Flota', icon: 'truck' },
        ]}
      >

      <TabPanel value="flota">
<FleetManagePanel onFleetChange={applyFleet} />
</TabPanel>

      <TabPanel value="rutas">
        <section className="log-panel log-routes-tab" aria-label="Rutas previstas">
          <div className="log-trucks-head">
            <h3>
              <Icon name="route" />
              Rutas previstas
            </h3>
            <div className="log-routes-actions">
              <Btn icon="history" onClick={() => navigate('/logistica/historial')}>
                Historial
              </Btn>
            </div>
          </div>
          {!fleet.length ? (
            <Empty
              title="Sin vista previa"
              desc="Agrega vehículos en Flota y asigna pedidos en Distribución para ver rutas aquí."
            />
          ) : (
            <ul className="log-planned-list">
              {fleet.map((t) => {
                const load = truckLoad(t);
                const stops = routeOrders(state, t.plate);
                const showStops = stops.length ? stops : load.orders.slice(0, 4);
                const open = expandedRoute === t.id;
                return (
                  <li key={t.id} className={`log-planned-card ${open ? 'is-open' : ''}`}>
                    <div className="log-planned-row">
                      <span className="log-planned-icon" aria-hidden>
                        <Icon name="route" />
                      </span>
                      <div className="log-planned-copy">
                        <strong>Ruta prevista · {t.label}</strong>
                        <small>
                          {fmtHours(t.etaHours)} · {moneyFmt(truckRouteCost(t))} estimados
                          {t.routeKm ? ` · ruta ~${t.routeKm} km` : ''}
                          {typeof t.odometerKm === 'number'
                            ? ` · odómetro ${t.odometerKm.toLocaleString('es-EC')} km`
                            : ''}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="log-planned-link"
                        onClick={() => navigate('/logistica/rutas', { state: { truckId: t.id } })}
                      >
                        Ver ruta
                        <Icon name="external" />
                      </button>
                      <button
                        type="button"
                        className="log-planned-toggle"
                        aria-expanded={open}
                        onClick={() => {
                          setExpandedRoute(open ? null : t.id);
                          setSelectedTruck(t.id);
                        }}
                      >
                        <Icon name="chevron" className={open ? 'is-open' : ''} />
                      </button>
                    </div>
                    {open ? (
                      <div className="log-route-detail">
                        <RouteMap
                          state={state}
                          orders={showStops}
                          city={t.city}
                          onSelect={(id) => setDetailId(id)}
                          showFullButton
                          onFullRoute={() =>
                            navigate('/logistica/rutas', { state: { truckId: t.id } })
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
</TabPanel>

      <TabPanel value="distribucion">
        <>
          <KpiGrid label="Resumen de distribución">
            <Kpi
              label="Total de pedidos"
              icon="orders"
              value={activeOrders.length}
              caption="en operación"
            />
            <Kpi
              label="Volumen total"
              icon="box"
              value={totalVolume.toFixed(1)}
              unit="m³"
              caption={`de ${fleetMaxVolume} m³`}
            />
            <Kpi
              label="Peso total"
              icon="truck"
              value={Math.round(totalWeight).toLocaleString('es-EC')}
              unit="kg"
              caption={`de ${fleetMaxWeight.toLocaleString('es-EC')} kg`}
            />
            <Kpi
              label="Tiempo estimado"
              icon="route"
              value={fmtHours(avgEta)}
              caption="promedio de entrega"
            />
          </KpiGrid>

          <div className="log-layout">
            <section className="log-panel" aria-label="Pedidos por ciudad">
              <header>
                <h2>Pedidos por ciudad / sector</h2>
                <p>
                  En Pendientes usa <strong>Marcar listo</strong>. Luego arrastra los Listos al
                  camión o usa IA autoasignar.
                </p>
              </header>

              <SegmentedControl
                label="Estado de pedidos"
                full
                value={listTab}
                onValueChange={setListTab}
                items={[
                  { value: 'pendientes', label: 'Pendientes', count: tabCounts.pendientes },
                  { value: 'listos', label: 'Listos', count: tabCounts.listos },
                  { value: 'en_ruta', label: 'En ruta', count: tabCounts.enRuta },
                ]}
                className="log-list-filter"
              />

              <SearchInput className="log-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar ciudad o sector..." aria-label="Buscar ciudad o sector" />

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
                                  <Checkbox className="log-order-check" checked={selected} disabled={!selectable} onClick={(e) => e.stopPropagation()} onCheckedChange={() => toggleOrder(o.id)} aria-label={`Seleccionar ${o.id}`} />
                                  <button
                                    type="button"
                                    className="log-order-main"
                                    onClick={() => setDetailId(o.id)}
                                  >
                                    <span>
                                      <strong>Pedido {o.id.replace('PED-', '#')}</strong>
                                      <small>
                                        {sectorOf(state, o)} · {client(state, o.clientId)?.name} ·{' '}
                                        {orderLoadKg(state, o).toFixed(1)} kg
                                      </small>
                                    </span>
                                    <span className="log-order-meta">
                                      <span
                                        className={`log-status log-status-${statusTone(o.status)}`}
                                      >
                                        {statusLabel(o.status)}
                                      </span>
                                      <em>
                                        {pkgs} {pkgs === 1 ? 'paquete' : 'paquetes'}
                                      </em>
                                    </span>
                                  </button>
                                  {o.status === 'Por preparar' ? (
                                    <Button variant="primary" size="small" className="log-order-ready" type="button" disabled={preparingId === o.id} onClick={(e) => {
                                        e.stopPropagation();
                                        void markReady(o.id);
                                      }}>
                                      <Icon name="check" />
                                      {preparingId === o.id ? 'Preparando…' : 'Marcar listo'}
                                    </Button>
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
                  <div
                    className={`log-bar ${volPct >= 95 ? 'is-red' : volPct > 55 ? 'is-amber' : 'is-green'}`}
                  >
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
                  <div
                    className={`log-bar ${kgPct >= 95 ? 'is-red' : kgPct > 55 ? 'is-amber' : 'is-green'}`}
                  >
                    <span style={{ width: `${kgPct}%` }} />
                  </div>
                </div>
              </section>

              <section className="log-panel log-trucks" aria-label="Camiones disponibles">
                <div className="log-trucks-head">
                  <h3>
                    <Icon name="truck" />
                    Vehículos disponibles
                  </h3>
                  <Button size="small" className="log-filter-btn" onClick={() => setMainTab('flota')}>
                    <Icon name="settings" />
                    Gestión de flota
                  </Button>
                </div>
                {fleetReady && !fleet.length ? (
                  <Empty
                    title="Sin vehículos"
                    desc="Agrega camiones en Gestión de flota para asignar pedidos."
                  />
                ) : null}
                <ul className="log-truck-list">
                  {fleet.map((t) => {
                    const load = truckLoad(t);
                    const active = selectedTruck === t.id;
                    const tone =
                      load.status === 'full'
                        ? 'red'
                        : load.status === 'partial'
                          ? 'amber'
                          : 'green';
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
                                <Icon name={vehicleIconName(t)} />
                              </span>
                              <strong>
                                {t.label} · {vehicleKindLabel(t)} - {t.city}
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
                              <strong>
                                ${t.costPerKm.toFixed(2)}
                                {t.costFromRules ? '/km*' : '/km'}
                              </strong>
                            </div>
                            <div>
                              <span>Odómetro</span>
                              <strong>{(t.odometerKm ?? 0).toLocaleString('es-EC')} km</strong>
                            </div>
                          </div>
                          <p className="log-truck-zones">
                            <strong>Zonas:</strong>{' '}
                            {t.allowedSectors?.length
                              ? t.allowedSectors.join(', ')
                              : 'Sin restricción de sector'}
                          </p>

                          <div className={`log-truck-bar log-bar is-${tone}`}>
                            <span
                              style={{ width: `${Math.max(load.pct, load.kg > 0 ? 2 : 0)}%` }}
                            />
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
                                <Btn icon="plus" onClick={() => stageToTruck(t.id, readySelected)}>
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

              <section className="log-panel log-routes" aria-label="Rutas previstas">
                <div className="log-trucks-head">
                  <h3>
                    <Icon name="route" />
                    Rutas previstas
                  </h3>
                  <div className="log-routes-actions">
                    <Btn icon="route" onClick={() => setMainTab('rutas')}>
                      Ver todas
                    </Btn>
                    <Btn icon="history" onClick={() => navigate('/logistica/historial')}>
                      Historial
                    </Btn>
                  </div>
                </div>
                {!fleet.length ? (
                  <Empty
                    title="Sin vista previa"
                    desc="Cuando tengas vehículos y pedidos asignados, aquí verás las rutas."
                  />
                ) : (
                  <ul className="log-planned-list">
                    {fleet.map((t) => (
                      <li key={t.id} className="log-planned-card">
                        <div className="log-planned-row">
                          <span className="log-planned-icon" aria-hidden>
                            <Icon name="route" />
                          </span>
                          <div className="log-planned-copy">
                            <strong>Ruta prevista</strong>
                            <small>
                              {fmtHours(t.etaHours)} · {moneyFmt(truckRouteCost(t))} estimados
                            </small>
                          </div>
                          <button
                            type="button"
                            className="log-planned-link"
                            onClick={() =>
                              navigate('/logistica/rutas', { state: { truckId: t.id } })
                            }
                          >
                            Ver ruta
                            <Icon name="external" />
                          </button>
                        </div>
                        <p className="log-planned-meta">
                          {t.label} · {vehicleKindLabel(t)} · {t.city}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </>
</TabPanel>
      </Tabs>

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
              {detail.status === 'Preparado' && !stagedIds.has(detail.id) && truck ? (
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
              {detail.priority ? (
                <span className="log-detail-chip">Prioridad {detail.priority}</span>
              ) : null}
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
                  {orderLoadKg(state, detail).toFixed(1)} kg ·{' '}
                  {orderVolume(state, detail).toFixed(2)} m³ · {packagesOf(detail)}{' '}
                  {packagesOf(detail) === 1 ? 'paquete' : 'paquetes'}
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

      {pedidosTruckId
        ? (() => {
            const pt = fleet.find((t) => t.id === pedidosTruckId) ?? truck;
            if (!pt) return null;
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
                              {sectorOf(state, o)} · {orderLoadKg(state, o).toFixed(1)} kg ·{' '}
                              {orderVolume(state, o).toFixed(2)} m³
                            </small>
                          </div>
                          <Btn
                            variant="danger"
                            icon="close"
                            onClick={() => void unstageOrder(pt.id, o.id)}
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
                              {statusLabel(o.status)} · {orderLoadKg(state, o).toFixed(1)} kg
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
          })()
        : null}

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
              <Input id="delivery-person" name="person" required />
            </div>
            <div className="field">
              <label htmlFor="delivery-code">Código que dicta el cliente</label>
              <Input id="delivery-code" name="code" inputMode="numeric" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="delivery-notes">Observaciones</label>
              <Textarea id="delivery-notes" name="notes" />
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
            <ModalActions
              onCancel={() => setIncidentOrder(null)}
              submitLabel="Guardar"
              formId="incident-form"
            />
          }
        >
          <form id="incident-form" onSubmit={submitIncident}>
            <input type="hidden" name="orderId" value={incidentOrder} />
            <div className="field">
              <label htmlFor="incident-reason">Motivo</label>
              <Select id="incident-reason" name="reason">
                <option>Cliente ausente</option>
                <option>Dirección no localizada</option>
                <option>Recepción no autorizada</option>
                <option>Producto con novedad</option>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="incident-notes">Detalle</label>
              <Textarea id="incident-notes" name="notes" />
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
              Fuente: <strong>{aiPlan.source === 'openai' ? 'OpenAI' : 'Heurística local'}</strong>.
              Criterios: ciudad, capacidad kg/m³, ocupación y costo/km. Los pedidos quedaron en
              carga. Usa <strong>Enviar camión</strong> para despachar.
            </p>
            {Object.entries(aiPlan.byTruck).map(([truckId, ids]) => {
              const t = fleet.find((x) => x.id === truckId);
              const items = aiPlan.assignments.filter((a) => a.truckId === truckId);
              return (
                <div key={truckId} className="log-ai-truck">
                  <h4>
                    {t?.label ?? truckId} · {t?.plate} · {t?.city}
                  </h4>
                  <small>
                    Cap. {t?.maxKg.toLocaleString('es-EC')} kg / {t?.maxM3} m³ · ${t?.costPerKm}/km
                    {t?.costPerTrip ? ` + ${moneyFmt(t.costPerTrip)}/viaje` : ''}· {ids.length}{' '}
                    pedido(s)
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
