import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { client, money, orderValue, statusColor } from '../../shared/lib/inventory';
import { Badge, Btn, Empty, Kpi, PageHead } from '../../shared/components/ui';
import { Modal } from '../../shared/components/Modal';

const tabs = ['Todos', 'Por preparar', 'Preparado', 'En ruta', 'Entregado', 'Incidencia'] as const;

export function OrdersPage() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof tabs)[number]>('Todos');
  const [detailId, setDetailId] = useState<string | null>(null);

  if (!state) return null;

  const list = state.orders.filter((o) => tab === 'Todos' || o.status === tab);
  const detail = detailId ? state.orders.find((o) => o.id === detailId) : null;

  return (
    <>
      <PageHead
        eyebrow="Gestión de pedidos"
        title="Del pedido a la entrega"
        desc="Disponibilidad, preparación y seguimiento en un mismo flujo."
        actions={
          <Btn variant="primary" icon="plus" onClick={() => navigate('/pedidos/nuevo')}>
            Nuevo pedido
          </Btn>
        }
      />
      <div className="kpis">
        <Kpi label="Registrados" value={state.orders.length} unit="pedidos" foot="Todos los estados" icon="orders" />
        <Kpi
          label="Por preparar"
          value={state.orders.filter((o) => o.status === 'Por preparar').length}
          unit=""
          foot="Stock reservado"
          icon="box"
        />
        <Kpi
          label="Entregados"
          value={state.orders.filter((o) => o.status === 'Entregado').length}
          unit=""
          foot="Confirmados"
          icon="check"
          color="positive"
        />
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            <small>{state.orders.filter((o) => t === 'Todos' || o.status === t).length}</small>
          </button>
        ))}
      </div>
      <section className="panel">
        {list.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
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
                      <Btn
                        variant="small"
                        icon={o.status === 'Por preparar' ? 'route' : 'eye'}
                        onClick={() =>
                          o.status === 'Por preparar'
                            ? navigate('/bodega', { state: { pick: o.id } })
                            : setDetailId(o.id)
                        }
                      >
                        {o.status === 'Por preparar' ? 'Preparar' : 'Ver'}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No hay pedidos" desc="Los pedidos aparecerán aquí." />
        )}
      </section>

      {detail ? (
        <Modal
          title={detail.id}
          subtitle={client(state, detail.clientId)?.name}
          onClose={() => setDetailId(null)}
        >
          <Badge text={detail.status} color={statusColor(detail.status)} />
          {detail.lines.map((l) => (
            <div className="invoice-line" key={l.productId}>
              <span>
                {state.products.find((p) => p.id === l.productId)?.name} × {l.qty}
              </span>
            </div>
          ))}
          <div className="invoice-line total">
            <span>Total</span>
            <strong>{money(orderValue(state, detail))}</strong>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
