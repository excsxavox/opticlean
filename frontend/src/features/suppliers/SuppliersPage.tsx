import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { money } from '../../shared/lib/inventory';
import { Btn, Empty, PageHead } from '../../shared/components/ui';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { Select } from '../../shared/components/Select';
import type { AppState, Supplier } from '../../shared/types';
import '../../styles/clients.css';

function debtOf(state: AppState, supplierId: string) {
  return (state.supplierBills ?? [])
    .filter((bill) => bill.supplierId === supplierId)
    .reduce((total, bill) => {
      const paid = (state.supplierPayments ?? [])
        .filter((payment) => payment.billId === bill.id)
        .reduce((sum, payment) => sum + payment.amount, 0);
      return total + Math.max(0, Math.round((bill.total - paid) * 100) / 100);
    }, 0);
}

function billBalance(state: AppState, billId: string, total: number) {
  const paid = (state.supplierPayments ?? [])
    .filter((payment) => payment.billId === billId)
    .reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export function SuppliersPage() {
  const { state, applyResponse, toast } = useAppState();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    return (state.suppliers ?? [])
      .map((supplier) => ({ supplier, debt: debtOf(state, supplier.id) }))
      .filter(({ supplier }) => {
        if (!q) return true;
        return [supplier.name, supplier.taxId, supplier.contact, supplier.email, supplier.phone]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'es'));
  }, [state, query]);

  if (!state) return null;

  const selected = rows.find((row) => row.supplier.id === selectedId) ?? null;
  const bills = selected
    ? (state.supplierBills ?? []).filter((bill) => bill.supplierId === selected.supplier.id)
    : [];

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      name: data.name,
      taxId: data.taxId,
      contact: data.contact,
      phone: data.phone,
      email: data.email,
      leadTimeDays: Number(data.leadTimeDays || 7),
      terms: data.terms,
    };
    try {
      applyResponse(editing ? await api.updateSupplier(editing.id, body) : await api.addSupplier(body));
      toast(editing ? 'Proveedor actualizado.' : 'Proveedor registrado.');
      setEditing(null);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el proveedor.');
    } finally {
      setBusy(false);
    }
  };

  const formSupplier = editing;

  return (
    <div className="page">
      <PageHead
        eyebrow="Abastecimiento"
        title="Proveedores"
        desc="RUC, contacto y lo que la empresa les debe."
        actions={
          <Btn
            variant="primary"
            icon="plus"
            onClick={() => {
              setCreating(true);
              setEditing(null);
              setError('');
            }}
          >
            Nuevo proveedor
          </Btn>
        }
      />
      <div className="cli-toolbar">
        <div className="cli-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre o RUC…"
            aria-label="Buscar proveedores"
          />
        </div>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="fc-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Contacto</th>
                <th>Entrega</th>
                <th>Deuda</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ supplier, debt }) => (
                <tr key={supplier.id} className={selectedId === supplier.id ? 'is-selected' : ''}>
                  <td>
                    <button type="button" className="fx-link" onClick={() => setSelectedId(supplier.id)}>
                      {supplier.name}
                    </button>
                  </td>
                  <td>{supplier.taxId || 'Sin RUC'}</td>
                  <td>{supplier.contact || supplier.phone || supplier.email || '—'}</td>
                  <td>{supplier.leadTimeDays} días</td>
                  <td>{money(debt)}</td>
                  <td>
                    <Btn
                      size="small"
                      onClick={() => {
                        setEditing(supplier);
                        setCreating(false);
                        setError('');
                      }}
                    >
                      Editar
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin proveedores" desc="Registra el primero con su RUC de 13 dígitos." />
      )}

      {selected ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>
            {selected.supplier.name} · deuda {money(selected.debt)}
          </h2>
          <p>
            {selected.supplier.terms || 'Sin condiciones'} · {selected.supplier.email || 'Sin correo'} ·{' '}
            {selected.supplier.phone || 'Sin teléfono'}
          </p>
          {bills.length ? (
            <ul className="commercial-list">
              {bills.map((bill) => (
                <li key={bill.id}>
                  {bill.number} · {bill.date} · {money(bill.total)} · saldo {money(billBalance(state, bill.id, bill.total))}
                </li>
              ))}
            </ul>
          ) : (
            <p>No hay facturas de este proveedor. La deuda aparece cuando se registra la factura de una orden recibida.</p>
          )}
          <h3>Lo que vende</h3>
          <ul>
            {(state.offerings ?? [])
              .filter((offer) => offer.supplierId === selected.supplier.id)
              .map((offer) => (
                <li key={offer.id}>
                  {state.products.find((item) => item.id === offer.productId)?.name ?? offer.productId} · {offer.supplierSku} ·{' '}
                  {money(offer.unitCost)} · mínimo {offer.minQty}
                  <Btn size="small" onClick={() => void api.deleteOffering(offer.id).then(applyResponse).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo quitar.'))}>
                    Quitar
                  </Btn>
                </li>
              ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = Object.fromEntries(new FormData(event.currentTarget));
              void api
                .addOffering({
                  supplierId: selected.supplier.id,
                  productId: data.productId,
                  supplierSku: data.supplierSku,
                  unitCost: Number(data.unitCost),
                  minQty: Number(data.minQty),
                })
                .then((response) => {
                  applyResponse(response);
                  toast('Producto agregado al catálogo del proveedor.');
                  event.currentTarget.reset();
                })
                .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo agregar.'));
            }}
          >
            <div className="form-grid">
              <Select name="productId" required defaultValue="">
                <option value="" disabled>Producto</option>
                {state.products.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
              <input name="supplierSku" required placeholder="Código del proveedor" aria-label="Código del proveedor" />
              <input name="unitCost" type="number" min={0} step="0.01" required placeholder="Costo" aria-label="Costo" />
              <input name="minQty" type="number" min={1} step={1} required placeholder="Mínimo" aria-label="Pedido mínimo" />
            </div>
            <Btn type="submit" size="small">Agregar al catálogo</Btn>
          </form>
        </section>
      ) : null}

      {creating || formSupplier ? (
        <Modal
          title={formSupplier ? `Editar · ${formSupplier.name}` : 'Nuevo proveedor'}
          subtitle="El RUC es obligatorio y no se puede repetir."
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          footer={
            <ModalActions
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
              submitLabel={busy ? 'Guardando…' : 'Guardar'}
              formId="supplier-form"
              icon="save"
            />
          }
        >
          <form id="supplier-form" onSubmit={(event) => void save(event)}>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="sup-name">Nombre</label>
                <input id="sup-name" name="name" defaultValue={formSupplier?.name} required />
              </div>
              <div className="field">
                <label htmlFor="sup-tax">RUC</label>
                <input
                  id="sup-tax"
                  name="taxId"
                  inputMode="numeric"
                  pattern="\d{13}"
                  minLength={13}
                  maxLength={13}
                  defaultValue={formSupplier?.taxId}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="sup-lead">Días de entrega</label>
                <input id="sup-lead" name="leadTimeDays" type="number" min={0} defaultValue={formSupplier?.leadTimeDays ?? 7} />
              </div>
              <div className="field">
                <label htmlFor="sup-contact">Contacto</label>
                <input id="sup-contact" name="contact" defaultValue={formSupplier?.contact} />
              </div>
              <div className="field">
                <label htmlFor="sup-phone">Teléfono</label>
                <input id="sup-phone" name="phone" defaultValue={formSupplier?.phone} />
              </div>
              <div className="field full">
                <label htmlFor="sup-email">Correo</label>
                <input id="sup-email" name="email" type="email" defaultValue={formSupplier?.email} />
              </div>
              <div className="field full">
                <label htmlFor="sup-terms">Condiciones</label>
                <input id="sup-terms" name="terms" defaultValue={formSupplier?.terms} placeholder="Crédito 30 días, pedido mínimo…" />
              </div>
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
