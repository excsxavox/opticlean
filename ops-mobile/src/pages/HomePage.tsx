import { Link } from 'react-router-dom';
import { clearSession } from '../auth';
import { Icon, Logo } from '../components/Icon';
import { available, clientName, money, stock } from '../lib/inventory';
import type { AppState } from '../types';

export function HomePage({ state }: { state: AppState }) {
  const pending = state.orders.filter((o) => o.status === 'Por preparar');
  const low = state.products.filter((p) => available(state, p.id) < p.min);
  const recent = state.receipts.slice(0, 4);
  const stockValue = state.products.reduce((n, p) => n + stock(state, p.id) * p.price, 0);

  return (
    <div className="page">
      <header className="brand-bar">
        <Logo />
        <div>
          <strong>
            OPTI<span>CLEAN</span> <em>AI</em>
          </strong>
          <small>Operación móvil</small>
        </div>
        <button
          type="button"
          className="btn ghost small"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            clearSession();
            window.location.assign('/login');
          }}
        >
          Salir
        </button>
      </header>

      <section className="welcome">
        <div className="eyebrow">Bienvenida, {state.settings.operator.split(' ')[0]}</div>
        <h1>Ingreso y picking en piso</h1>
        <p>
          {pending.length} pedidos por preparar · {low.length} productos bajo mínimo.
        </p>
        <div className="button-row">
          <Link className="btn primary" to="/recibir?scan=1">
            <Icon name="scan" /> Escanear QR
          </Link>
          <Link className="btn welcome-secondary" to="/recibir">
            <Icon name="edit" /> Ingreso manual
          </Link>
        </div>
      </section>

      <div className="kpis">
        <article className="kpi">
          <div className="kpi-label">
            Inventario <Icon name="chart" />
          </div>
          <div className="kpi-value">{money(stockValue)}</div>
          <div className="kpi-foot">{state.settings.warehouse}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">
            Pedidos <Icon name="orders" />
          </div>
          <div className="kpi-value">
            {pending.length}
            <small>pend.</small>
          </div>
          <div className="kpi-foot">Operador: {state.settings.operator}</div>
        </article>
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">
            <Icon name="spark" /> Accesos rápidos
          </span>
        </div>
        <div className="quick-grid">
          <Link className="quick-card" to="/inventario">
            <Icon name="box" />
            <strong>Inventario</strong>
            <small>Stock y mínimos</small>
          </Link>
          <Link className="quick-card" to="/pedidos">
            <Icon name="orders" />
            <strong>Pedidos</strong>
            <small>Preparar picking</small>
          </Link>
          <Link className="quick-card" to="/bodega">
            <Icon name="warehouse" />
            <strong>Bodega</strong>
            <small>Ubicaciones</small>
          </Link>
          <Link className="quick-card" to="/recibir">
            <Icon name="receive" />
            <strong>Recepción</strong>
            <small>Guía IA</small>
          </Link>
        </div>
      </section>

      {low.length ? (
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              <Icon name="alert" /> Bajo mínimo
            </span>
            <Link className="btn ghost small" to="/inventario?filter=low">
              Ver
            </Link>
          </div>
          <ul className="data-list">
            {low.slice(0, 4).map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <span>{p.id} · mín. {p.min}</span>
                </div>
                <em className="badge amber">{available(state, p.id)} u.</em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Últimas recepciones</span>
        </div>
        {recent.length ? (
          <ul className="data-list">
            {recent.map((r) => {
              const p = state.products.find((x) => x.id === r.productId);
              return (
                <li key={r.id}>
                  <div>
                    <strong>{p?.name ?? r.productId}</strong>
                    <span>
                      {r.qty} u. → {r.loc}
                    </span>
                  </div>
                  <em className="badge blue">{r.batch}</em>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-copy">Aún no hay recepciones registradas.</p>
        )}
      </section>

      {pending.length ? (
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Pedidos por preparar</span>
            <Link className="btn ghost small" to="/pedidos">
              Abrir
            </Link>
          </div>
          <ul className="data-list">
            {pending.slice(0, 3).map((o) => (
              <li key={o.id}>
                <div>
                  <strong>{o.id}</strong>
                  <span>{clientName(state, o.clientId)} · {o.priority}</span>
                </div>
                <em className="badge amber">{o.lines.length} ítems</em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
