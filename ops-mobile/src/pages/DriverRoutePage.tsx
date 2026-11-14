import { useMemo, useState } from 'react';
import { api } from '../api';
import { clearSession, type AuthUser } from '../auth';
import { RouteMap } from '../components/RouteMap';
import { Icon } from '../components/Icon';
import {
  clientOf,
  fmtHours,
  orderWeight,
  packagesOf,
  productOf,
  routeOrders,
  sectorOf,
  truckByPlate,
} from '../lib/fleet';
import type { AppState } from '../types';

type Props = {
  state: AppState;
  user: AuthUser;
  onRefresh: () => Promise<void>;
};

export function DriverRoutePage({ state, user, onRefresh }: Props) {
  const truck = truckByPlate(user.truckPlate);
  const stops = useMemo(() => routeOrders(state, truck.plate), [state, truck.plate]);
  const [stopId, setStopId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [person, setPerson] = useState('');
  const [notes, setNotes] = useState('');

  const current = stops.find((o) => o.id === stopId) ?? stops[0] ?? null;
  const currentClient = current ? clientOf(state, current.clientId) : null;
  const lineKeys = current ? current.lines.map((l) => `${current.id}:${l.productId}`) : [];
  const allChecked = lineKeys.length > 0 && lineKeys.every((k) => checked[k]);
  const loadKg = Math.round(stops.reduce((n, o) => n + orderWeight(state, o), 0));

  const confirmDelivery = async () => {
    if (!current || !allChecked || !person.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.delivery({ orderId: current.id, person: person.trim(), notes });
      await onRefresh();
      setChecked({});
      setPerson('');
      setNotes('');
      setStopId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page drv-page">
      <header className="drv-top">
        <div>
          <div className="eyebrow">Conductor · Mi ruta</div>
          <h1>{truck.label}</h1>
          <p>
            {truck.plate} · {user.name} · {truck.city}
          </p>
        </div>
        <div className="drv-top-actions">
          <span className={`drv-pill ${stops.length ? 'route' : 'idle'}`}>
            {stops.length ? 'En ruta' : 'Sin despacho'}
          </span>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              clearSession();
              window.location.assign('/login');
            }}
          >
            Salir
          </button>
        </div>
      </header>

      <section className="drv-status card">
        <div>
          <strong>{loadKg} kg</strong>
          <small>carga actual</small>
        </div>
        <div>
          <strong>{stops.length}</strong>
          <small>paradas</small>
        </div>
        <div>
          <strong>{fmtHours(truck.etaHours)}</strong>
          <small>ETA</small>
        </div>
      </section>

      <section className="drv-map-wrap card">
        <div className="drv-section-head">
          <h2>Mapa de ruta</h2>
          <small>Leaflet + OpenStreetMap</small>
        </div>
        <RouteMap
          state={state}
          orders={stops}
          city={truck.city}
          activeId={current?.id}
          onSelect={(id) => {
            setStopId(id);
            setChecked({});
          }}
        />
      </section>

      <section className="card">
        <div className="drv-section-head">
          <h2>Paradas de hoy</h2>
          <small>{stops.length} entregas</small>
        </div>
        {stops.length ? (
          <ul className="drv-stops">
            {stops.map((o, i) => {
              const c = clientOf(state, o.clientId);
              const active = current?.id === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    className={`drv-stop ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      setStopId(o.id);
                      setChecked({});
                    }}
                  >
                    <span className="drv-stop-num">{i + 1}</span>
                    <span>
                      <strong>{c?.name ?? o.clientId}</strong>
                      <small>
                        {o.id} · {sectorOf(state, o)} · {packagesOf(o)} prod.
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="subtle">
            Aún no tienes pedidos despachados. El bodeguero debe usar <strong>Enviar camión</strong> en
            Distribución.
          </p>
        )}
      </section>

      {current && currentClient ? (
        <section className="card drv-current">
          <div className="drv-current-banner">
            <span>
              Siguiente {(stops.findIndex((o) => o.id === current.id) + 1) || 1} · {current.id}
            </span>
            <strong>{currentClient.name}</strong>
            <p>
              {sectorOf(state, current)}, {currentClient.address}
            </p>
            <a
              className="btn primary full"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${currentClient.address} ${truck.city}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="pin" /> Cómo llegar
            </a>
          </div>

          <h3>Checklist de entrega</h3>
          {current.lines.map((l) => {
            const key = `${current.id}:${l.productId}`;
            const p = productOf(state, l.productId);
            return (
              <label key={key} className="drv-check">
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

          <label className="field">
            <span>Quien recibe</span>
            <input
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              placeholder={currentClient.contact || 'Nombre'}
            />
          </label>
          <label className="field">
            <span>Observaciones</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>

          {error ? <p className="login-error">{error}</p> : null}
          <button
            type="button"
            className="btn primary full"
            disabled={!allChecked || !person.trim() || busy}
            onClick={() => void confirmDelivery()}
          >
            <Icon name="check" />
            {busy ? 'Confirmando…' : 'Confirmar entrega'}
          </button>
          <p className="subtle" style={{ marginTop: 8 }}>
            Marca todos los productos y escribe quién recibe para habilitar la entrega.
          </p>
        </section>
      ) : null}
    </div>
  );
}
