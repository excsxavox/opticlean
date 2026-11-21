import { useEffect, useMemo, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { client, orderWeight, product } from '../../shared/lib/inventory';
import { Badge, Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { RouteMap } from './RouteMap';
import {
  FLEET as DEFAULT_FLEET,
  activeOrders,
  cityOf,
  deliveredToday,
  opsDate,
  packagesOf,
  routeOrders,
  sectorOf,
  truckLoad,
  type Truck,
} from './fleet';
import '../../styles/logistics.css';

export function RoutesPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const [fleet, setFleet] = useState<Truck[]>(DEFAULT_FLEET);
  const initialTruck =
    (location.state as { truckId?: string } | null)?.truckId ??
    new URLSearchParams(location.search).get('truck') ??
    DEFAULT_FLEET[0]?.id ??
    '';

  const [truckId, setTruckId] = useState(initialTruck);
  const today = opsDate();

  useEffect(() => {
    void api
      .fleet()
      .then((r) => {
        if (!r.trucks?.length) return;
        setFleet(r.trucks);
        setTruckId((cur) => (r.trucks.some((t) => t.id === cur) ? cur : r.trucks[0].id));
      })
      .catch(() => {});
  }, []);

  const [stopId, setStopId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [error, setError] = useState('');

  const truck = fleet.find((t) => t.id === truckId) ?? fleet[0];
  const pendingStops = useMemo(
    () => (state && truck ? routeOrders(state, truck.plate) : []),
    [state, truck],
  );
  const doneStops = useMemo(
    () => (state && truck ? deliveredToday(state, truck.plate, today) : []),
    [state, truck, today],
  );

  if (!state || !truck) return null;

  const stops = [...pendingStops, ...doneStops];
  const allActive = activeOrders(state);
  const current =
    pendingStops.find((o) => o.id === stopId) ??
    pendingStops[0] ??
    null;
  const load = truckLoad(state, truck, allActive);
  const done = doneStops.length;
  const pending = pendingStops.length;
  const totalToday = done + pending;
  const progressPct = totalToday ? Math.round((done / totalToday) * 100) : 0;
  const currentClient = current ? client(state, current.clientId) : null;
  const lineKeys = current ? current.lines.map((l) => `${current.id}:${l.productId}`) : [];
  const allChecked = lineKeys.length > 0 && lineKeys.every((k) => checked[k]);

  const submitDelivery = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!current) return;
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.delivery({
          orderId: current.id,
          person: String(data.person),
          notes: String(data.notes ?? ''),
          code: String(data.code ?? ''),
        }),
      );
      toast(`Entrega de ${current.id} confirmada.`);
      setDeliveryOpen(false);
      setChecked({});
      setStopId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const submitIncident = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!current) return;
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.incident({
          orderId: current.id,
          reason: String(data.reason),
          notes: String(data.notes ?? ''),
        }),
      );
      toast(`Incidencia registrada en ${current.id}.`);
      setIncidentOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="log-page log-routes-page">
      <PageHead
        eyebrow="Operativo"
        title="Mi ruta"
        desc="Paradas del día, mapa y confirmación real de entregas."
        actions={
          <>
            <Btn icon="history" onClick={() => navigate('/logistica/historial')}>
              Historial
            </Btn>
            <Btn icon="truck" onClick={() => navigate('/logistica')}>
              Distribución
            </Btn>
          </>
        }
      />

      <div className="log-route-tabs" role="tablist" aria-label="Vehículos">
        {fleet.map((t) => {
          const n = routeOrders(state, t.plate).length;
          const d = deliveredToday(state, t.plate, today).length;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={truck.id === t.id}
              className={truck.id === t.id ? 'is-active' : ''}
              onClick={() => {
                setTruckId(t.id);
                setStopId(null);
                setChecked({});
              }}
            >
              {t.label} · {t.city}
              {n ? <span className="log-tab-pill">{n}</span> : null}
              {!n && d ? <span className="log-tab-badge">Hecho</span> : null}
              {!n && !d ? <span className="log-tab-badge">Libre</span> : null}
            </button>
          );
        })}
      </div>

      <div className="log-route-statusbar">
        <Badge
          text={pending ? 'En ruta' : done ? 'Completada' : 'Disponible'}
          color={pending ? 'blue' : done ? 'green' : 'green'}
        />
        <strong>
          {truck.label} · {truck.plate}
        </strong>
        <span>{truck.driver}</span>
        <span>
          {Math.round(load.realKg || load.kg)} / {truck.maxKg} kg
        </span>
        <div className="log-route-progress">
          <div className="log-bar is-green">
            <span style={{ width: `${progressPct}%` }} />
          </div>
          <small>
            {done} de {totalToday || 0} pedidos · {pending} por hacer · {progressPct}%
          </small>
        </div>
      </div>

      <div className="log-route-workspace">
        <aside className="log-panel log-stops-panel">
          <header>
            <h2>Paradas de hoy</h2>
            <p>
              {pending} en ruta · {done} entregadas
            </p>
          </header>
          {stops.length ? (
            <ul className="log-stop-list">
              {pendingStops.map((o, i) => {
                const c = client(state, o.clientId);
                const active = current?.id === o.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={`log-stop-btn ${active ? 'is-active' : ''} ${
                        o.status === 'Incidencia' ? 'is-issue' : ''
                      }`}
                      onClick={() => {
                        setStopId(o.id);
                        setChecked({});
                      }}
                    >
                      <span className="log-stop-idx">{i + 1}</span>
                      <span>
                        <strong>{c?.name ?? o.clientId}</strong>
                        <small>
                          {o.id} · {packagesOf(o)} producto(s) · {sectorOf(state, o)}
                          {o.status === 'Incidencia' ? ' · Incidencia' : ''}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
              {doneStops.map((o) => {
                const c = client(state, o.clientId);
                return (
                  <li key={o.id}>
                    <div className="log-stop-btn is-done">
                      <span className="log-stop-idx is-done">
                        <Icon name="check" />
                      </span>
                      <span>
                        <strong>{c?.name ?? o.clientId}</strong>
                        <small>
                          {o.id} · Entregado
                          {o.deliveredTo ? ` a ${o.deliveredTo}` : ''}
                        </small>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="log-empty">
              Este vehículo no tiene paradas hoy. Despacha pedidos desde Distribución.
            </p>
          )}
        </aside>

        <section className="log-panel log-map-panel">
          <RouteMap
            state={state}
            orders={pendingStops.length ? pendingStops : doneStops}
            city={truck.city}
            activeId={current?.id}
            onSelect={(id) => {
              if (pendingStops.some((o) => o.id === id)) {
                setStopId(id);
                setChecked({});
              }
            }}
            showFullButton
            onFullRoute={() => navigate('/logistica/historial')}
          />
        </section>

        <aside className="log-panel log-current-panel">
          <header>
            <h2>Parada actual</h2>
          </header>
          {current && currentClient ? (
            <>
              <div className="log-current-card">
                <span className="log-current-kicker">
                  Siguiente {pendingStops.findIndex((o) => o.id === current.id) + 1} · {current.id}
                </span>
                <strong>{currentClient.name}</strong>
                <p>
                  {sectorOf(state, current)}, {currentClient.address}
                </p>
                <small>
                  {packagesOf(current)} producto(s) · {currentClient.contact}
                </small>
                {current.status === 'Incidencia' && current.incident ? (
                  <div className="log-incident-chip">Incidencia: {current.incident}</div>
                ) : null}
                <a
                  className="btn primary full"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${currentClient.address} ${cityOf(state, current)}`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="pin" /> Cómo llegar
                </a>
              </div>

              <div className="log-checklist">
                <h3>Checklist de entrega</h3>
                {current.lines.map((l) => {
                  const key = `${current.id}:${l.productId}`;
                  const p = product(state, l.productId);
                  return (
                    <label key={key} className="log-check-item">
                      <input
                        type="checkbox"
                        checked={!!checked[key]}
                        onChange={() =>
                          setChecked((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                      />
                      <span>
                        {p?.name ?? l.productId} × {l.qty}
                        <small>
                          {orderWeight(state, { ...current, lines: [l] }).toFixed(1)} kg
                        </small>
                      </span>
                    </label>
                  );
                })}
                <p className="log-check-hint">
                  Marca todos los productos para habilitar la confirmación.
                </p>
                <div className="log-current-actions">
                  <Btn
                    variant="green"
                    icon="check"
                    disabled={!allChecked}
                    onClick={() => {
                      setError('');
                      setDeliveryOpen(true);
                    }}
                  >
                    Confirmar entrega
                  </Btn>
                  <Btn
                    variant="ghost"
                    icon="alert"
                    onClick={() => {
                      setError('');
                      setIncidentOpen(true);
                    }}
                  >
                    Incidencia
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={!!current.skipped}
                    onClick={() => {
                      setError('');
                      void api
                        .skipStop(current.id)
                        .then((response) => {
                          applyResponse(response);
                          toast(`${current.id} quedó fuera de la ruta. Las paradas que siguen se reordenaron.`);
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo saltar la parada.'));
                    }}
                  >
                    Saltar y reordenar
                  </Btn>
                </div>
              </div>
            </>
          ) : (
            <p className="log-empty">
              {done
                ? 'Ruta del día completada. Revisa el historial para el detalle.'
                : 'Selecciona una parada o despacha pedidos a este vehículo.'}
            </p>
          )}
        </aside>
      </div>

      <p className="log-route-footnote">
        Las entregas e incidencias se guardan en el servidor y alimentan el{' '}
        <button type="button" className="linkish" onClick={() => navigate('/logistica/historial')}>
          Historial de rutas
        </button>{' '}
        y la trazabilidad.
      </p>

      {deliveryOpen && current ? (
        <Modal
          title="Confirmar entrega"
          subtitle={current.id}
          onClose={() => setDeliveryOpen(false)}
          footer={
            <ModalActions
              onCancel={() => setDeliveryOpen(false)}
              submitLabel="Registrar entrega"
              formId="route-delivery-form"
              icon="check"
            />
          }
        >
          <form id="route-delivery-form" onSubmit={submitDelivery}>
            <div className="field">
              <label htmlFor="route-person">Quien recibe</label>
              <input
                id="route-person"
                name="person"
                required
                defaultValue={currentClient?.contact}
              />
            </div>
            <div className="field">
              <label htmlFor="route-code">Código que dicta el cliente</label>
              <input id="route-code" name="code" inputMode="numeric" autoComplete="off" required={!!current.deliveryCode} />
            </div>
            {current.deliveryKey ? (
              <p className="subtle">
                El cliente lo ve en{' '}
                <a href={`/entrega?orderId=${encodeURIComponent(current.id)}&k=${encodeURIComponent(current.deliveryKey)}`}>
                  su enlace
                </a>
                .
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="route-notes">Observaciones</label>
              <textarea id="route-notes" name="notes" />
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}

      {incidentOpen && current ? (
        <Modal
          title="Registrar incidencia"
          subtitle={current.id}
          onClose={() => setIncidentOpen(false)}
          footer={
            <ModalActions
              onCancel={() => setIncidentOpen(false)}
              submitLabel="Guardar incidencia"
              formId="route-incident-form"
              icon="alert"
            />
          }
        >
          <form id="route-incident-form" onSubmit={submitIncident}>
            <div className="field">
              <label htmlFor="route-reason">Motivo</label>
              <Select id="route-reason" name="reason" required defaultValue="">
                <option value="" disabled>
                  Selecciona…
                </option>
                <option>Cliente ausente</option>
                <option>Dirección incorrecta</option>
                <option>Rechazo parcial</option>
                <option>Problema de acceso</option>
                <option>Otro</option>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="route-inc-notes">Detalle</label>
              <textarea id="route-inc-notes" name="notes" />
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
