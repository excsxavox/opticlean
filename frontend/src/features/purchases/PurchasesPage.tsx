import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { available, product } from '../../shared/lib/inventory';
import { Badge, Btn, Empty, Kpi, PageHead, ProductCell } from '../../shared/components/ui';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { dateShort } from '../../shared/lib/inventory';

export function PurchasesPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [prefillProduct, setPrefillProduct] = useState('');
  const [error, setError] = useState('');

  if (!state) return null;

  const low = state.products.filter((p) => available(state, p.id) < p.min);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.addPurchase({
          productId: data.productId,
          qty: Number(data.qty),
          date: data.date,
          notes: data.notes,
        }),
      );
      toast('Solicitud registrada.');
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const openNew = (productId?: string) => {
    setPrefillProduct(productId ?? state.products[0]?.id ?? '');
    setModalOpen(true);
    setError('');
  };

  return (
    <>
      <PageHead
        eyebrow="Abastecimiento"
        title="Órdenes de compra"
        desc="Anticipa faltantes y registra solicitudes de reposición."
        actions={
          <Btn variant="primary" icon="plus" onClick={() => openNew()}>
            Nueva solicitud
          </Btn>
        }
      />
      <div className="kpis">
        <Kpi label="Bajo mínimo" value={low.length} unit="SKU" foot="Según disponibilidad" icon="alert" />
        <Kpi label="Solicitudes" value={state.purchases.length} unit="" foot="Pendientes de recepción" icon="orders" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Reposición sugerida</span>
          <Badge text="Revisión" color="amber" />
        </div>
        {low.length ? (
          <div className="table-scroll">
            <table>
              <tbody>
                {low.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <ProductCell name={p.name} id={p.id} category={p.category} />
                    </td>
                    <td>{available(state, p.id)} u.</td>
                    <td>{p.min} u.</td>
                    <td>
                      <Btn variant="small" icon="plus" onClick={() => openNew(p.id)}>
                        Solicitar
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Inventario OK" desc="Todos los productos cumplen el mínimo." />
        )}
      </section>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <span className="panel-title">Solicitudes de compra</span>
        </div>
        {state.purchases.length ? (
          <div className="table-scroll">
            <table>
              <tbody>
                {state.purchases.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.id}</strong>
                      <span className="sub">{dateShort(o.date)}</span>
                    </td>
                    <td>{product(state, o.productId)?.name}</td>
                    <td>{o.qty} u.</td>
                    <td>
                      <Btn
                        variant="small"
                        icon="receive"
                        onClick={() => navigate('/recepcion', { state: { productId: o.productId } })}
                      >
                        Ir a recepción
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin solicitudes" desc="Crea la primera solicitud interna." />
        )}
      </section>

      {modalOpen ? (
        <Modal
          title="Nueva solicitud de compra"
          subtitle="Registro interno; no se envía al proveedor."
          onClose={() => setModalOpen(false)}
          footer={
            <ModalActions onCancel={() => setModalOpen(false)} submitLabel="Registrar" formId="purchase-form" icon="save" />
          }
        >
          <form id="purchase-form" onSubmit={submit}>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="pur-product">Producto</label>
                <select id="pur-product" name="productId" defaultValue={prefillProduct}>
                  {state.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} / {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pur-qty">Cantidad</label>
                <input id="pur-qty" name="qty" type="number" min={1} defaultValue={12} required />
              </div>
              <div className="field">
                <label htmlFor="pur-date">Fecha</label>
                <input id="pur-date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </div>
              <div className="field full">
                <label htmlFor="pur-notes">Observaciones</label>
                <textarea id="pur-notes" name="notes" maxLength={300} />
              </div>
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </>
  );
}
