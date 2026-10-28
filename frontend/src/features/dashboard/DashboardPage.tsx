import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import {
  available,
  client,
  money,
  num,
  orderValue,
  qtyAt,
  statusColor,
  stock,
} from '../../shared/lib/inventory';
import { Badge, Btn, Kpi, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';

export function DashboardPage() {
  const { state, meta } = useAppState();
  const navigate = useNavigate();
  if (!state || !meta) return null;

  const totalCells = meta.locations.length;
  const occupied = meta.locations.filter((l) => qtyAt(state, l.id) > 0).length;
  const pending = state.orders.filter((o) => o.status === 'Por preparar');
  const low = state.products.filter((p) => available(state, p.id) < p.min);
  const stockValue = state.products.reduce((n, p) => n + stock(state, p.id) * p.price, 0);

  return (
    <>
      <PageHead
        eyebrow="Centro de operaciones"
        title="Todo conectado. Todo bajo control."
        desc="Una visión clara de tu inventario y los próximos pasos."
        actions={<Btn variant="primary" icon="plus" onClick={() => navigate('/pedidos/nuevo')}>Nuevo pedido</Btn>}
      />
      <section className="welcome">
        <div>
          <div className="eyebrow">Bienvenida, {state.settings.operator.split(' ')[0]}</div>
          <h2>La operación empieza aquí.</h2>
          <p>
            Tienes {pending.length} pedidos por preparar y {low.length} producto
            {low.length === 1 ? '' : 's'} que requieren reposición.
          </p>
          <Btn variant="primary" icon="warehouse" onClick={() => navigate('/bodega')}>
            Explorar mi bodega
          </Btn>
        </div>
      </section>
      <div className="kpis">
        <Kpi label="Valor del inventario" value={money(stockValue)} unit="" foot="Valor a precio de venta" icon="chart" />
        <Kpi
          label="Unidades disponibles"
          value={num(state.products.reduce((n, p) => n + available(state, p.id), 0))}
          unit="u."
          foot="Descontando reservas"
          icon="box"
        />
        <Kpi
          label="Pedidos activos"
          value={state.orders.filter((o) => o.status !== 'Entregado').length}
          unit=""
          foot="Preparación, despacho y entrega"
          icon="orders"
        />
        <Kpi
          label="Ocupación de bodega"
          value={`${Math.round((occupied / Math.max(totalCells, 1)) * 100)}%`}
          unit=""
          foot={`${occupied}/${totalCells} posiciones con producto`}
          icon="warehouse"
        />
      </div>
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Inventario por línea</span>
            <Badge text="Unidades físicas" color="blue" />
          </div>
          <div className="metric-chart">
            {meta.categories.map((c) => {
              const q = state.products.filter((p) => p.category === c).reduce((n, p) => n + stock(state, p.id), 0);
              const max = Math.max(
                ...meta.categories.map((cat) =>
                  state.products.filter((p) => p.category === cat).reduce((n, p) => n + stock(state, p.id), 0),
                ),
              );
              return (
                <div className="chart-col" key={c}>
                  <div className="bar" style={{ height: `${(q / max) * 80}%` }}>
                    <span>{q}</span>
                  </div>
                  <label>{c}</label>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Tu siguiente acción</span>
            <Icon name="spark" />
          </div>
          <div className="task-item">
            <Icon name="orders" />
            <div className="task-info">
              <strong>Preparar {pending.length} pedidos</strong>
              <small>Consulta posiciones y lotes sugeridos.</small>
            </div>
            <button type="button" className="icon-btn" onClick={() => navigate('/bodega')}>
              <Icon name="chevron" />
            </button>
          </div>
          <div className="task-item">
            <Icon name="alert" />
            <div className="task-info">
              <strong>{low.length} productos bajo mínimo</strong>
              <small>Anticipa el siguiente abastecimiento.</small>
            </div>
            <button type="button" className="icon-btn" onClick={() => navigate('/compras')}>
              <Icon name="chevron" />
            </button>
          </div>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <span className="panel-title">Pedidos recientes</span>
          <Btn variant="ghost" icon="arrow" onClick={() => navigate('/pedidos')}>
            Ver todos
          </Btn>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {state.orders.slice(0, 4).map((o) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
