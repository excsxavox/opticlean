import { useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { client, orderWeight, statusColor } from '../../shared/lib/inventory';
import { Badge, Btn, Empty, Kpi, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';

export function LogisticsPage() {
  const { state, applyResponse, toast } = useAppState();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [deliveryOrder, setDeliveryOrder] = useState<string | null>(null);
  const [incidentOrder, setIncidentOrder] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!state) return null;

  const transit = state.orders.filter((o) => ['En ruta', 'Incidencia'].includes(o.status));
  const ready = state.orders.filter((o) => o.status === 'Preparado');
  const weight = transit.reduce((n, o) => n + orderWeight(state, o), 0);

  const submitDispatch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const ids = [...new FormData(e.currentTarget).getAll('orders')] as string[];
    try {
      applyResponse(await api.dispatch(ids));
      toast('Despacho confirmado.');
      setDispatchOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
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
    <>
      <PageHead
        eyebrow="Logística y distribución"
        title="Cada entrega, bajo control"
        desc="Organiza la carga y registra el resultado."
        actions={
          <Btn variant="primary" icon="truck" onClick={() => setDispatchOpen(true)}>
            Planificar despacho
          </Btn>
        }
      />
      <div className="kpis">
        <Kpi label="Listos" value={ready.length} unit="pedidos" foot="Preparación finalizada" icon="box" />
        <Kpi label="En ruta" value={transit.length} unit="" foot="Incluye incidencias" icon="route" />
        <Kpi label="Carga" value={weight.toFixed(1)} unit="kg" foot="Capacidad 650 kg" icon="truck" />
      </div>
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              <Icon name="route" />
              Paradas del despacho
            </span>
          </div>
          <div className="panel-body">
            {transit.length ? (
              transit.map((o) => (
                <div className="route-stop" key={o.id}>
                  <span className="stop-number">{o.id.slice(-2)}</span>
                  <div className="route-stop-body">
                    <strong>{client(state, o.clientId)?.name}</strong>
                    <p>{client(state, o.clientId)?.address}</p>
                    <Badge text={o.status} color={statusColor(o.status)} />
                    <div className="button-row">
                      <Btn variant="green" icon="check" onClick={() => setDeliveryOrder(o.id)}>
                        Confirmar entrega
                      </Btn>
                      <Btn icon="alert" onClick={() => setIncidentOrder(o.id)}>
                        Novedad
                      </Btn>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Sin pedidos en ruta" desc="Planifica un despacho." />
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Listos para salir</span>
            <Badge text={String(ready.length)} color="blue" />
          </div>
          {ready.map((o) => (
            <div className="task-item" key={o.id}>
              <Icon name="box" />
              <div className="task-info">
                <strong>{o.id}</strong>
                <small>
                  {client(state, o.clientId)?.name} · {orderWeight(state, o).toFixed(1)} kg
                </small>
              </div>
            </div>
          ))}
        </section>
      </div>

      {dispatchOpen ? (
        <Modal
          title="Planificar despacho"
          subtitle="Vehículo GBA-2041 · máx. 650 kg / 8 m³"
          onClose={() => setDispatchOpen(false)}
          footer={
            <ModalActions onCancel={() => setDispatchOpen(false)} submitLabel="Confirmar despacho" formId="dispatch-form" icon="truck" />
          }
        >
          <form id="dispatch-form" onSubmit={submitDispatch}>
            {ready.map((o) => (
              <label key={o.id} className="pick-item">
                <input type="checkbox" name="orders" value={o.id} defaultChecked />
                <div>
                  <div className="product-title">
                    {o.id} · {client(state, o.clientId)?.name}
                  </div>
                  <div className="product-code">{orderWeight(state, o).toFixed(1)} kg</div>
                </div>
              </label>
            ))}
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}

      {deliveryOrder ? (
        <Modal
          title="Confirmar entrega"
          subtitle={deliveryOrder}
          onClose={() => setDeliveryOrder(null)}
          footer={
            <ModalActions onCancel={() => setDeliveryOrder(null)} submitLabel="Registrar entrega" formId="delivery-form" icon="check" />
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
    </>
  );
}
