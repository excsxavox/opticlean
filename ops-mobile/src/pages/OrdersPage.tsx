import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { AuthUser } from '../auth';
import { Icon } from '../components/Icon';
import { isAssignedToMe } from '../lib/assignments';
import { clientName, statusTone } from '../lib/inventory';
import type { AppState, Order, PickStep } from '../types';

type OrdersTab = 'pendientes' | 'preparados' | 'en_ruta';

function isActiveOrder(o: Order) {
  return !o.id.startsWith('PED-H');
}

export function OrdersPage({
  state,
  user,
  onRefresh,
}: {
  state: AppState;
  user: AuthUser;
  onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Order | null>(null);
  const [steps, setSteps] = useState<PickStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<OrdersTab>('pendientes');

  const counts = useMemo(() => {
    const active = state.orders.filter(isActiveOrder);
    return {
      pendientes: active.filter(
        (o) => o.status === 'Por preparar' && isAssignedToMe(o, user),
      ).length,
      preparados: active.filter((o) => o.status === 'Preparado').length,
      enRuta: active.filter((o) => o.status === 'En ruta' || o.status === 'Incidencia').length,
    };
  }, [state.orders, user]);

  const orders = useMemo(() => {
    return state.orders
      .filter((o) => {
        if (!isActiveOrder(o)) return false;
        if (tab === 'pendientes') {
          return o.status === 'Por preparar' && isAssignedToMe(o, user);
        }
        if (tab === 'preparados') return o.status === 'Preparado';
        return o.status === 'En ruta' || o.status === 'Incidencia';
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }, [state.orders, tab, user]);

  const openOrder = async (order: Order) => {
    setSelected(order);
    setError('');
    setSteps([]);
    try {
      const plan = await api.pickPlan(order.id);
      setSteps(Array.isArray(plan) ? plan : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el plan');
    }
  };

  const prepare = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.prepareOrder(selected.id);
      await onRefresh();
      setSelected(null);
      setSteps([]);
      setTab('preparados');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar');
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <div className="page">
        <header className="topbar-inline">
          <button type="button" className="icon-btn" onClick={() => setSelected(null)} aria-label="Volver">
            <Icon name="back" />
          </button>
          <div>
            <div className="eyebrow">Picking</div>
            <strong>{selected.id}</strong>
          </div>
          <em className={`badge ${statusTone(selected.status)}`}>{selected.status}</em>
        </header>

        <section className="panel">
          <div className="panel-body">
            <p className="meta-line">{clientName(state, selected.clientId)}</p>
            <p className="meta-line">Prioridad: {selected.priority} · {selected.date}</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              <Icon name="route" /> Ruta de picking (FEFO)
            </span>
          </div>
          <p className="subtle" style={{ margin: '0 14px 8px' }}>
            Sale primero el lote con fecha de entrada más antigua.
          </p>
          <ul className="pick-list">
            {(steps.length ? steps : selected.lines).map((step, i) => {
              const p = state.products.find((x) => x.id === step.productId);
              return (
                <li key={`${step.productId}-${i}`}>
                  <span className="pick-number">{i + 1}</span>
                  <div>
                    <strong>{p?.name ?? step.productId}</strong>
                    <span>
                      {step.qty} u.
                      {'loc' in step && step.loc ? ` · ${step.loc}` : ''}
                      {'batch' in step && step.batch ? ` · ${step.batch}` : ''}
                      {'receivedAt' in step && step.receivedAt
                        ? ` · entrada ${step.receivedAt}`
                        : ''}
                      {'expiry' in step && step.expiry ? ` · vence ${step.expiry}` : ''}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {error ? <p className="form-error visible">{error}</p> : null}

        {selected.status === 'Por preparar' ? (
          <button type="button" className="btn primary full sticky-cta" disabled={busy} onClick={() => void prepare()}>
            <Icon name="check" />
            {busy ? 'Preparando…' : 'Marcar preparado'}
          </button>
        ) : null}
      </div>
    );
  }

  const emptyCopy =
    tab === 'pendientes'
      ? 'Aún no te asignaron pedidos.'
      : tab === 'preparados'
        ? 'No hay pedidos preparados.'
        : 'No hay pedidos en ruta.';

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">Operación</div>
        <h1>Pedidos</h1>
        <p>Prepara picking con la ruta sugerida por ubicación.</p>
      </header>

      <div className="dsp-tabs" role="tablist" aria-label="Estado de pedidos">
        <button
          type="button"
          role="tab"
          className={tab === 'pendientes' ? 'is-active' : ''}
          aria-selected={tab === 'pendientes'}
          onClick={() => setTab('pendientes')}
        >
          Por preparar <span>{counts.pendientes}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'preparados' ? 'is-active' : ''}
          aria-selected={tab === 'preparados'}
          onClick={() => setTab('preparados')}
        >
          Preparados <span>{counts.preparados}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'en_ruta' ? 'is-active' : ''}
          aria-selected={tab === 'en_ruta'}
          onClick={() => setTab('en_ruta')}
        >
          En ruta <span>{counts.enRuta}</span>
        </button>
      </div>

      {tab === 'preparados' && orders.length ? (
        <Link className="btn primary full" to="/empaque">
          <Icon name="box" /> Empacar pedidos preparados
        </Link>
      ) : null}

      <section className="panel">
        <ul className="data-list">
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" className="list-btn" onClick={() => void openOrder(o)}>
                <div>
                  <strong>{o.id}</strong>
                  <span>
                    {clientName(state, o.clientId)} · {o.lines.length} ítems
                  </span>
                </div>
                <em className={`badge ${statusTone(o.status)}`}>{o.status}</em>
              </button>
            </li>
          ))}
        </ul>
        {!orders.length ? <p className="empty-copy">{emptyCopy}</p> : null}
      </section>
    </div>
  );
}
