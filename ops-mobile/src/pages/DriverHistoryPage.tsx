import { useMemo } from 'react';
import type { AuthUser } from '../auth';
import { clientOf, orderWeight, truckByPlate } from '../lib/fleet';
import type { AppState } from '../types';

export function DriverHistoryPage({ state, user }: { state: AppState; user: AuthUser }) {
  const truck = truckByPlate(user.truckPlate);
  const delivered = useMemo(
    () =>
      state.orders
        .filter(
          (o) =>
            !o.id.startsWith('PED-H') &&
            o.status === 'Entregado' &&
            (o.vehicle === truck.plate || !o.vehicle),
        )
        .slice(0, 20),
    [state.orders, truck.plate],
  );

  return (
    <div className="page drv-page">
      <header className="drv-top">
        <div>
          <div className="eyebrow">Conductor · Historial</div>
          <h1>Entregas recientes</h1>
          <p>
            {truck.label} · {truck.plate}
          </p>
        </div>
      </header>

      <section className="card">
        {delivered.length ? (
          <ul className="drv-history">
            {delivered.map((o) => (
              <li key={o.id}>
                <strong>
                  {o.id} · {clientOf(state, o.clientId)?.name}
                </strong>
                <small>
                  {o.date} · {orderWeight(state, o).toFixed(1)} kg · {o.status}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">Aún no hay entregas registradas para este camión.</p>
        )}
      </section>
    </div>
  );
}
