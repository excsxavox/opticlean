import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { client, orderWeight, product } from '../../shared/lib/inventory';
import { Badge, Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { RouteMap } from './RouteMap';
import {
  FLEET,
  activeOrders,
  cityOf,
  packagesOf,
  routeOrders,
  sectorOf,
  truckLoad,
} from './fleet';
import '../../styles/logistics.css';

export function RoutesPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const initialTruck =
    (location.state as { truckId?: string } | null)?.truckId ??
    new URLSearchParams(location.search).get('truck') ??
    'T01';

  const [truckId, setTruckId] = useState(initialTruck);
  const [stopId, setStopId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [error, setError] = useState('');

  const truck = FLEET.find((t) => t.id === truckId) ?? FLEET[0];
  const stops = useMemo(
    () => (state ? routeOrders(state, truck.plate) : []),
    [state, truck.plate],
  );

  if (!state) return null;

  const allActive = activeOrders(state);
  const current = stops.find((o) => o.id === stopId) ?? stops[0] ?? null;
  const load = truckLoad(state, truck, allActive);
  const done = 0;
  const pending = stops.length;
  const currentClient = current ? client(state, current.clientId) : null;
  const lineKeys = current
    ? current.lines.map((l) => `${current.id}:${l.productId}`)
    : [];
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
        }),
      );
      toast('Entrega confirmada.');
      setDeliveryOpen(false);
      setChecked({});
      setStopId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="log-page log-routes-page">
      <PageHead
        eyebrow="Operativo"
        title="Mi ruta"
        desc="Paradas del día, mapa de entrega y checklist por camión."
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

      <div className="log-route-tabs" role="tablist" aria-label="Camiones">
        {FLEET.map((t) => {
          const n = routeOrders(state, t.plate).length;
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
              {t.baseOccupancy === 0 && n === 0 ? (
                <span className="log-tab-badge">Despacho</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="log-route-statusbar">
        <Badge text={stops.length ? 'En ruta' : 'Disponible'} color={stops.length ? 'blue' : 'green'} />
        <strong>
          {truck.label} · {truck.plate}
        </strong>
        <span>{truck.driver}</span>
        <span>{Math.round(load.realKg || load.kg)} kg</span>
        <div className="log-route-progress">
          <div className="log-bar is-green">
            <span style={{ width: `${stops.length ? Math.round((done / Math.max(1, stops.length)) * 100) : 0}%` }} />
          </div>
          <small>
            {done} de {stops.length || pending} pedidos · {pending} por hacer
          </small>
        </div>
      </div>

      <div className="log-route-workspace">
        <aside className="log-panel log-stops-panel">
          <header>
            <h2>Paradas de hoy</h2>
            <p>{stops.length} entregas en {truck.city}</p>
          </header>
          {stops.length ? (
            <ul className="log-stop-list">
              {stops.map((o, i) => {
                const c = client(state, o.clientId);
                const active = (current?.id ?? '') === o.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={`log-stop-btn ${active ? 'is-active' : ''}`}
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
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="log-empty">Este camión no tiene paradas en ruta. Asigna pedidos desde Distribución.</p>
          )}
        </aside>

        <section className="log-panel log-map-panel">
          <RouteMap
            state={state}
            orders={stops}
            city={truck.city}
            activeId={current?.id}
            onSelect={(id) => {
              setStopId(id);
              setChecked({});
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
                  Siguiente {stops.findIndex((o) => o.id === current.id) + 1} · {current.id}
                </span>
                <strong>{currentClient.name}</strong>
                <p>
                  {sectorOf(state, current)}, {currentClient.address}
                </p>
                <small>
                  {packagesOf(current)} producto(s) · {currentClient.contact}
                </small>
                <a
                  className="btn primary full"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${currentClient.address} ${cityOf(state, current)}`)}`}
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
                        onChange={() => setChecked((prev) => ({ ...prev, [key]: !prev[key] }))}
                      />
                      <span>
                        {p?.name ?? l.productId} × {l.qty}
                        <small>{orderWeight(state, { ...current, lines: [l] }).toFixed(1)} kg</small>
                      </span>
                    </label>
                  );
                })}
                <p className="log-check-hint">
                  Marca todos los productos para habilitar la confirmación de entrega.
                </p>
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
              </div>
            </>
          ) : (
            <p className="log-empty">Selecciona una parada o despacha pedidos a este camión.</p>
          )}
        </aside>
      </div>

      <p className="log-route-footnote">
        Las rutas con etiqueta Despacho se aprueban en Distribución. Historial de camiones anteriores en{' '}
        <button type="button" className="linkish" onClick={() => navigate('/logistica/historial')}>
          Historial de rutas
        </button>
        .
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
              <input id="route-person" name="person" required defaultValue={currentClient?.contact} />
            </div>
            <div className="field">
              <label htmlFor="route-notes">Observaciones</label>
              <textarea id="route-notes" name="notes" />
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
