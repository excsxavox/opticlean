import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { money, orderValue } from '../../shared/lib/inventory';
import { Badge, Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';

export function ClientsPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  if (!state) return null;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(await api.addClient(data));
      toast('Cliente registrado.');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Relaciones comerciales"
        title="Clientes"
        desc="Pedidos y datos de entrega."
        actions={
          <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>
            Nuevo cliente
          </Btn>
        }
      />
      <div className="client-grid">
        {state.clients.map((c) => {
          const os = state.orders.filter((o) => o.clientId === c.id);
          return (
            <section className="panel client-card" key={c.id}>
              <div className="client-card-head">
                <span className="avatar">
                  {c.name
                    .split(' ')
                    .slice(0, 2)
                    .map((t) => t[0])
                    .join('')}
                </span>
                <div>
                  <h3>{c.name}</h3>
                  <Badge text={c.type} color="blue" />
                </div>
              </div>
              <p>
                <Icon name="users" />
                {c.contact}
              </p>
              <p>
                <Icon name="pin" />
                {c.address}
              </p>
              <p>
                <Icon name="mail" />
                {c.email}
              </p>
              <div className="client-card-footer">
                <span>
                  {os.length} pedidos · {money(os.reduce((n, o) => n + orderValue(state, o), 0))}
                </span>
                <Btn variant="ghost" icon="plus" onClick={() => navigate('/pedidos/nuevo', { state: { clientId: c.id } })}>
                  Crear pedido
                </Btn>
              </div>
            </section>
          );
        })}
      </div>

      {open ? (
        <Modal
          title="Nuevo cliente"
          subtitle="Datos de contacto y entrega."
          onClose={() => setOpen(false)}
          footer={<ModalActions onCancel={() => setOpen(false)} submitLabel="Guardar" formId="client-form" icon="save" />}
        >
          <form id="client-form" onSubmit={submit}>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="cl-name">Nombre</label>
                <input id="cl-name" name="name" required />
              </div>
              <div className="field">
                <label htmlFor="cl-person">Contacto</label>
                <input id="cl-person" name="contact" required />
              </div>
              <div className="field">
                <label htmlFor="cl-type">Sector</label>
                <select id="cl-type" name="type">
                  <option>Corporativo</option>
                  <option>Hotelería</option>
                  <option>Salud</option>
                  <option>Restauración</option>
                  <option>Industrial</option>
                </select>
              </div>
              <div className="field full">
                <label htmlFor="cl-address">Dirección</label>
                <input id="cl-address" name="address" required />
              </div>
              <div className="field full">
                <label htmlFor="cl-email">Correo</label>
                <input id="cl-email" name="email" type="email" required />
              </div>
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </>
  );
}
