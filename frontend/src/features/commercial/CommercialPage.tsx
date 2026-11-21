import { FormEvent, useMemo, useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { api } from '../../shared/api/client';
import { client, invoiceBalance, money, product } from '../../shared/lib/inventory';
import { Btn, Empty, PageHead, Panel } from '../../shared/components/ui';
import { Select } from '../../shared/components/Select';
import type { AppState, CycleCount, Metrics } from '../../shared/types';
import '../../styles/commercial.css';

type Tab = 'docs' | 'ledger' | 'prices' | 'stock' | 'supply' | 'recall';

const TABS: { id: Tab; label: string }[] = [
  { id: 'docs', label: 'Documentos' },
  { id: 'ledger', label: 'Cartera' },
  { id: 'prices', label: 'Precios' },
  { id: 'stock', label: 'Bodega' },
  { id: 'supply', label: 'Reposición' },
  { id: 'recall', label: 'Retiro' },
];

export function CommercialPage() {
  const { state, applyResponse, toast } = useAppState();
  const { user } = useAuth();
  /** Separación de funciones: bodega solicita, administración aprueba. */
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('docs');
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('Devolución de cliente');
  const [restock, setRestock] = useState(true);
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payMethod, setPayMethod] = useState('Transferencia');
  const [billPurchase, setBillPurchase] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billTotal, setBillTotal] = useState('');
  const [supplierBillId, setSupplierBillId] = useState('');
  const [supplierPay, setSupplierPay] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [listName, setListName] = useState('');
  const [listType, setListType] = useState('');
  const [listProduct, setListProduct] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [listMin, setListMin] = useState('1');
  const [specialClient, setSpecialClient] = useState('');
  const [specialProduct, setSpecialProduct] = useState('');
  const [specialPrice, setSpecialPrice] = useState('');
  const [adjustLot, setAdjustLot] = useState('');
  const [adjustQty, setAdjustQty] = useState('1');
  const [adjustKind, setAdjustKind] = useState('Merma');
  const [adjustReason, setAdjustReason] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [transferLot, setTransferLot] = useState('');
  const [transferQty, setTransferQty] = useState('1');
  const [transferTo, setTransferTo] = useState('');
  const [receiveLocs, setReceiveLocs] = useState<Record<string, string>>({});
  const [returnLot, setReturnLot] = useState('');
  const [returnSupplier, setReturnSupplier] = useState('');
  const [supplierReturnQty, setSupplierReturnQty] = useState('1');
  const [supplierReturnReason, setSupplierReturnReason] = useState('');
  const [recallBatch, setRecallBatch] = useState('');
  const [recallRows, setRecallRows] = useState<Awaited<ReturnType<typeof api.recall>> | null>(null);
  const [supply, setSupply] = useState<Awaited<ReturnType<typeof api.replenishment>>['groups'] | null>(null);

  const run = async (fn: () => Promise<{ state: AppState; metrics: Metrics } | void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fn();
      if (response) applyResponse(response);
      toast(ok);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  };

  const readyOrders = useMemo(
    () =>
      (state?.orders ?? []).filter(
        (order) =>
          ['Preparado', 'En ruta', 'Entregado'].includes(order.status) &&
          !order.id.startsWith('PED-H') &&
          !(state?.invoices ?? []).some((invoice) => invoice.orderId === order.id && invoice.status === 'Emitida'),
      ),
    [state],
  );

  if (!state) return null;
  const draftCount: CycleCount | undefined = (state.cycleCounts ?? []).find((count) => count.status === 'Borrador');
  const inTransit = (state.transfers ?? []).filter((transfer) => transfer.status === 'En tránsito');
  const quarantine = state.lots.filter((lot) => lot.loc === 'CUARENTENA' && lot.qty > 0);
  const clientTypes = [...new Set(state.clients.map((item) => item.type).filter(Boolean))];

  const onInvoice = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.issueInvoice(orderId), 'Factura emitida.');
  };

  return (
    <div className="page commercial-page">
      <PageHead
        eyebrow="Gestión"
        title="Comercial"
        desc="Factura, guía, cartera, precios y devoluciones. El número es interno hasta conectar el certificado de la empresa ante el SRI."
      />
      <div className="commercial-tabs" role="tablist">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-on' : ''} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'docs' ? (
        <div className="commercial-grid">
          <Panel title="Emitir factura">
            <form className="form-grid" onSubmit={onInvoice}>
              <div className="field">
                <label htmlFor="com-order">Pedido preparado</label>
                <Select id="com-order" value={orderId} onChange={(event) => setOrderId(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {readyOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.id} · {client(state, order.clientId)?.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Emitir factura</Btn>
            </form>
          </Panel>
          <Panel title="Facturas">
            {(state.invoices ?? []).length ? (
              <div className="table-scroll">
                <table className="fc-table">
                  <thead>
                    <tr><th>Número</th><th>Pedido</th><th>Cliente</th><th>Total</th><th>Saldo</th><th></th></tr>
                  </thead>
                  <tbody>
                    {(state.invoices ?? []).map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.number}</td>
                        <td>{invoice.orderId}</td>
                        <td>{client(state, invoice.clientId)?.name}</td>
                        <td>{money(invoice.total)}</td>
                        <td>{money(invoiceBalance(state, invoice.id))}</td>
                        <td>
                          {(() => {
                            const guide = (state.guides ?? []).find(
                              (item) => item.orderId === invoice.orderId && item.kind === 'Venta' && item.status === 'Emitida',
                            );
                            return guide ? (
                              <span>{guide.number}</span>
                            ) : (
                              <Btn size="small" disabled={busy} onClick={() => void run(() => api.issueGuide({ orderId: invoice.orderId }), 'Guía de remisión emitida.')}>Guía</Btn>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Sin facturas" desc="Emite la primera desde un pedido preparado." />
            )}
          </Panel>
          <Panel title="Nota de crédito">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const invoice = (state.invoices ?? []).find((item) => item.id === invoiceId);
                const lines = (invoice?.lines ?? [])
                  .map((line, index) => ({
                    productId: line.productId,
                    qty: Number(returnQtys[`${line.productId}:${line.batch ?? index}`] ?? 0),
                    ...(line.batch ? { batch: line.batch } : {}),
                    restock,
                  }))
                  .filter((line) => line.qty > 0);
                if (!lines.length) {
                  toast('Indica la cantidad a devolver de al menos un producto.');
                  return;
                }
                void run(
                  () => api.issueCreditNote({ invoiceId, reason: returnReason, lines }),
                  restock ? 'Nota emitida. El lote volvió a cuarentena.' : 'Nota de crédito emitida.',
                );
              }}
            >
              <div className="field">
                <label htmlFor="com-invoice">Factura</label>
                <Select
                  id="com-invoice"
                  value={invoiceId}
                  onChange={(event) => {
                    setInvoiceId(event.target.value);
                    setReturnQtys({});
                  }}
                  required
                >
                  <option value="">Selecciona</option>
                  {(state.invoices ?? []).filter((invoice) => invoice.status === 'Emitida').map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>{invoice.number} · saldo {money(invoiceBalance(state, invoice.id))}</option>
                  ))}
                </Select>
              </div>
              {(state.invoices ?? []).find((item) => item.id === invoiceId)?.lines.map((line, index) => {
                const key = `${line.productId}:${line.batch ?? index}`;
                return (
                <div className="field" key={key}>
                  <label htmlFor={`com-return-${key}`}>
                    {product(state, line.productId)?.name ?? line.productId}
                    {line.batch ? ` · lote ${line.batch}` : ''} · facturado {line.qty}
                  </label>
                  <input
                    id={`com-return-${key}`}
                    type="number"
                    min={0}
                    max={line.qty}
                    value={returnQtys[key] ?? 0}
                    onChange={(event) =>
                      setReturnQtys((current) => ({ ...current, [key]: Number(event.target.value) }))
                    }
                  />
                </div>
                );
              })}
              <div className="field">
                <label htmlFor="com-return-reason">Motivo</label>
                <input id="com-return-reason" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} required />
              </div>
              <label className="commercial-check">
                <input type="checkbox" checked={restock} onChange={(event) => setRestock(event.target.checked)} />
                Reingresar el lote a cuarentena
              </label>
              <Btn type="submit" variant="primary" disabled={busy}>Emitir nota</Btn>
            </form>
          </Panel>
          <Panel title="Guías">
            {(state.guides ?? []).length ? (
              <ul className="commercial-list">
                {(state.guides ?? []).map((guide) => (
                  <li key={guide.id}>{guide.number} · {guide.kind} · {guide.origin} → {guide.destination}</li>
                ))}
              </ul>
            ) : <Empty title="Sin guías" desc="Se emiten desde la factura o al trasladar entre bodegas." />}
          </Panel>
        </div>
      ) : null}

      {tab === 'ledger' ? (
        <div className="commercial-grid">
          <Panel title="Cobro de cliente">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.collectPayment({ invoiceId, amount: Number(payAmount), method: payMethod, reference: payRef }), 'Abono registrado.');
              }}
            >
              <div className="field">
                <label htmlFor="com-pay-invoice">Factura</label>
                <Select id="com-pay-invoice" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {(state.invoices ?? []).map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>{invoice.number} · {money(invoiceBalance(state, invoice.id))}</option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-pay-amount">Monto</label>
                <input id="com-pay-amount" type="number" min="0.01" step="0.01" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="com-pay-method">Método</label>
                <Select id="com-pay-method" value={payMethod} onChange={(event) => setPayMethod(event.target.value)}>
                  <option>Transferencia</option>
                  <option>Efectivo</option>
                  <option>Cheque</option>
                  <option>Retención</option>
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-pay-ref">Referencia</label>
                <input id="com-pay-ref" value={payRef} onChange={(event) => setPayRef(event.target.value)} required />
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Registrar abono</Btn>
            </form>
            <ul className="commercial-list">
              {(state.customerPayments ?? []).map((payment) => (
                <li key={payment.id}>{payment.id} · {payment.method} · {money(payment.amount)} · {payment.reference}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Factura y pago a proveedor">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.billSupplier({ purchaseId: billPurchase, number: billNumber, total: Number(billTotal) }), 'Factura de proveedor registrada.');
              }}
            >
              <div className="field">
                <label htmlFor="com-po">Orden recibida</label>
                <Select id="com-po" value={billPurchase} onChange={(event) => setBillPurchase(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.purchases.filter((purchase) => (purchase.received ?? 0) > 0).map((purchase) => (
                    <option key={purchase.id} value={purchase.id}>{purchase.id} · recibido {purchase.received} u.</option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-bill-no">Número</label>
                <input id="com-bill-no" value={billNumber} onChange={(event) => setBillNumber(event.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="com-bill-total">Total</label>
                <input id="com-bill-total" type="number" min="0.01" step="0.01" value={billTotal} onChange={(event) => setBillTotal(event.target.value)} required />
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Registrar factura</Btn>
            </form>
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.paySupplier({ billId: supplierBillId, amount: Number(supplierPay), method: payMethod, reference: supplierRef }), 'Pago a proveedor registrado.');
              }}
            >
              <div className="field">
                <label htmlFor="com-bill">Factura por pagar</label>
                <Select id="com-bill" value={supplierBillId} onChange={(event) => setSupplierBillId(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {(state.supplierBills ?? []).map((bill) => (
                    <option key={bill.id} value={bill.id}>{bill.number} · {money(bill.total)}</option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-supplier-pay">Monto</label>
                <input id="com-supplier-pay" type="number" min="0.01" step="0.01" value={supplierPay} onChange={(event) => setSupplierPay(event.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="com-supplier-ref">Referencia</label>
                <input id="com-supplier-ref" value={supplierRef} onChange={(event) => setSupplierRef(event.target.value)} required />
              </div>
              <Btn type="submit" disabled={busy}>Pagar</Btn>
            </form>
          </Panel>
        </div>
      ) : null}

      {tab === 'prices' ? (
        <div className="commercial-grid">
          <Panel title="Lista por tipo de cliente">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const existing = (state.priceLists ?? []).find((list) => list.clientType === listType);
                const item = { productId: listProduct, price: Number(listPrice), minQty: Number(listMin) || 1 };
                const items = existing
                  ? [...existing.items.filter((row) => !(row.productId === item.productId && row.minQty === item.minQty)), item]
                  : [item];
                void run(
                  () => api.savePriceList({ id: existing?.id, name: listName, clientType: listType, items }),
                  existing ? 'Precio agregado a la lista.' : 'Lista de precios guardada.',
                );
              }}
            >
              <div className="field">
                <label htmlFor="com-list-name">Nombre</label>
                <input id="com-list-name" value={listName} onChange={(event) => setListName(event.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="com-list-type">Tipo de cliente</label>
                <Select id="com-list-type" value={listType} onChange={(event) => setListType(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {clientTypes.map((type) => <option key={type}>{type}</option>)}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-list-product">Producto</label>
                <Select id="com-list-product" value={listProduct} onChange={(event) => setListProduct(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-list-price">Precio</label>
                <input id="com-list-price" type="number" min="0" step="0.01" value={listPrice} onChange={(event) => setListPrice(event.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="com-list-min">Desde cantidad</label>
                <input id="com-list-min" type="number" min="1" value={listMin} onChange={(event) => setListMin(event.target.value)} />
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Guardar lista</Btn>
            </form>
            <ul className="commercial-list">
              {(state.priceLists ?? []).map((list) => (
                <li key={list.id}>{list.name} · {list.clientType} · {list.items.length} precios</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Precio pactado">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.saveClientPrice({ clientId: specialClient, productId: specialProduct, price: Number(specialPrice) }), 'Precio del cliente guardado.');
              }}
            >
              <div className="field">
                <label htmlFor="com-special-client">Cliente</label>
                <Select id="com-special-client" value={specialClient} onChange={(event) => setSpecialClient(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-special-product">Producto</label>
                <Select id="com-special-product" value={specialProduct} onChange={(event) => setSpecialProduct(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-special-price">Precio</label>
                <input id="com-special-price" type="number" min="0" step="0.01" value={specialPrice} onChange={(event) => setSpecialPrice(event.target.value)} required />
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Guardar</Btn>
            </form>
          </Panel>
        </div>
      ) : null}

      {tab === 'stock' ? (
        <div className="commercial-grid">
          <Panel title="Ajuste con aprobación">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.requestAdjustment({ lotId: adjustLot, qty: Number(adjustQty), kind: adjustKind, reason: adjustReason }), 'Ajuste enviado a aprobación.');
              }}
            >
              <div className="field">
                <label htmlFor="com-lot">Lote</label>
                <Select id="com-lot" value={adjustLot} onChange={(event) => setAdjustLot(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.lots.filter((lot) => lot.qty > 0 && lot.loc !== 'CUARENTENA').map((lot) => (
                    <option key={lot.id} value={lot.id}>{product(state, lot.productId)?.name} · {lot.batch} · {lot.qty} u. · {lot.loc}</option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-adjust-qty">Cantidad</label>
                <input id="com-adjust-qty" type="number" min={1} value={adjustQty} onChange={(event) => setAdjustQty(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="com-adjust-kind">Tipo</label>
                <Select id="com-adjust-kind" value={adjustKind} onChange={(event) => setAdjustKind(event.target.value)}>
                  <option>Merma</option>
                  <option>Daño</option>
                  <option>Vencimiento</option>
                  <option>Cuarentena</option>
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-adjust-reason">Motivo</label>
                <input id="com-adjust-reason" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} required />
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Solicitar</Btn>
            </form>
            <ul className="commercial-list">
              {(state.adjustments ?? []).filter((item) => item.status === 'Pendiente').map((item) => (
                <li key={item.id}>
                  {item.id} · {item.kind} · {item.qty} u. · {item.reason}
                  {item.requestedBy ? ` · solicitó ${item.requestedBy}` : ''}
                  {isAdmin ? (
                    <Btn size="small" disabled={busy} onClick={() => void run(() => api.approveAdjustment(item.id), 'Ajuste aplicado.')}>Aprobar</Btn>
                  ) : (
                    <span className="fx-chip amber">Espera aprobación de administración</span>
                  )}
                </li>
              ))}
            </ul>
            {quarantine.length ? (
              <p>En cuarentena: {quarantine.map((lot) => `${product(state, lot.productId)?.name} ${lot.qty} u.`).join(', ')}</p>
            ) : <p>No hay mercadería en cuarentena.</p>}
          </Panel>
          <Panel title="Conteo">
            <Btn
              disabled={busy}
              onClick={() => void run(async () => {
                const response = await api.startCycleCount();
                const opened = response.state.cycleCounts?.find((count) => count.status === 'Borrador');
                const next: Record<string, number> = {};
                for (const line of opened?.lines ?? []) next[line.lotId] = line.systemQty;
                setCounts(next);
                return response;
              }, 'Conteo abierto con el stock del sistema.')}
            >
              Abrir conteo
            </Btn>
            {draftCount ? (
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () => api.applyCycleCount(draftCount.id, draftCount.lines.map((line) => ({ lotId: line.lotId, countedQty: counts[line.lotId] ?? line.systemQty }))),
                    'Conteo aplicado.',
                  );
                }}
              >
                <div className="commercial-count">
                {draftCount.lines.map((line) => (
                  <div className="field" key={line.lotId}>
                    <label htmlFor={`cnt-${line.lotId}`}>{product(state, line.productId)?.name} · {line.loc} · sistema {line.systemQty}</label>
                    <input
                      id={`cnt-${line.lotId}`}
                      type="number"
                      min={0}
                      value={counts[line.lotId] ?? line.systemQty}
                      onChange={(event) => setCounts((prev) => ({ ...prev, [line.lotId]: Number(event.target.value) }))}
                    />
                  </div>
                ))}
                </div>
                {isAdmin ? (
                  <Btn type="submit" variant="primary" disabled={busy}>Aplicar diferencias</Btn>
                ) : (
                  <p className="fx-muted">Administración revisa y aplica las diferencias del conteo.</p>
                )}
              </form>
            ) : null}
          </Panel>
          <Panel title="Traslado entre bodegas">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.shipTransfer({ toWarehouseId: transferTo, lines: [{ lotId: transferLot, qty: Number(transferQty) }] }), 'Traslado en tránsito.');
              }}
            >
              <div className="field">
                <label htmlFor="com-transfer-lot">Lote de la bodega activa</label>
                <Select id="com-transfer-lot" value={transferLot} onChange={(event) => setTransferLot(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.lots.filter((lot) => lot.qty > 0 && lot.loc !== 'CUARENTENA' && (lot.warehouseId ?? state.settings.activeWarehouseId) === state.settings.activeWarehouseId).map((lot) => (
                    <option key={lot.id} value={lot.id}>{product(state, lot.productId)?.name} · {lot.qty} u.</option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-transfer-qty">Cantidad</label>
                <input id="com-transfer-qty" type="number" min={1} value={transferQty} onChange={(event) => setTransferQty(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="com-transfer-to">Destino</label>
                <Select id="com-transfer-to" value={transferTo} onChange={(event) => setTransferTo(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.warehouses.filter((warehouse) => warehouse.id !== state.settings.activeWarehouseId).map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </Select>
              </div>
              <Btn type="submit" variant="primary" disabled={busy}>Enviar</Btn>
            </form>
            {inTransit.map((transfer) => (
              <form
                key={transfer.id}
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () => api.receiveTransfer(transfer.id, transfer.lines.map((line) => ({ lotId: line.lotId, loc: receiveLocs[line.lotId] || '' }))),
                    'Traslado recibido.',
                  );
                }}
              >
                <p>{transfer.id} en tránsito hacia {state.warehouses.find((warehouse) => warehouse.id === transfer.toWarehouseId)?.name}</p>
                {transfer.lines.map((line) => (
                  <div className="field" key={line.lotId}>
                    <label htmlFor={`loc-${line.lotId}`}>{product(state, line.productId)?.name} · {line.qty} u.</label>
                    <input id={`loc-${line.lotId}`} placeholder="Ubicación destino, ej. A-01-01-D" value={receiveLocs[line.lotId] ?? ''} onChange={(event) => setReceiveLocs((prev) => ({ ...prev, [line.lotId]: event.target.value }))} required />
                  </div>
                ))}
                <Btn type="submit" disabled={busy}>Recibir</Btn>
                <Btn type="button" disabled={busy} onClick={() => void run(() => api.issueGuide({ transferId: transfer.id }), 'Guía de traslado emitida.')}>Guía</Btn>
              </form>
            ))}
          </Panel>
          <Panel title="Devolución al proveedor">
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.returnToSupplier({ lotId: returnLot, qty: Number(supplierReturnQty), supplierId: returnSupplier, reason: supplierReturnReason }), 'Devolución al proveedor registrada.');
              }}
            >
              <div className="field">
                <label htmlFor="com-return-lot">Lote</label>
                <Select id="com-return-lot" value={returnLot} onChange={(event) => setReturnLot(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {state.lots.filter((lot) => lot.qty > 0).map((lot) => (
                    <option key={lot.id} value={lot.id}>{product(state, lot.productId)?.name} · {lot.batch}</option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-return-supplier">Proveedor</label>
                <Select id="com-return-supplier" value={returnSupplier} onChange={(event) => setReturnSupplier(event.target.value)} required>
                  <option value="">Selecciona</option>
                  {(state.suppliers ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="com-dpr-qty">Cantidad</label>
                <input id="com-dpr-qty" type="number" min={1} value={supplierReturnQty} onChange={(event) => setSupplierReturnQty(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="com-dpr-reason">Motivo</label>
                <input id="com-dpr-reason" value={supplierReturnReason} onChange={(event) => setSupplierReturnReason(event.target.value)} required />
              </div>
              {isAdmin ? (
                <Btn type="submit" variant="primary" disabled={busy}>Devolver</Btn>
              ) : (
                <p className="fx-muted">Solo administración registra devoluciones al proveedor.</p>
              )}
            </form>
          </Panel>
        </div>
      ) : null}

      {tab === 'supply' ? (
        <Panel title="Órdenes sugeridas por proveedor">
          <div className="commercial-actions">
            <Btn disabled={busy} onClick={() => void run(async () => { setSupply((await api.replenishment()).groups); }, 'Sugerencia actualizada.')}>Calcular</Btn>
            <Btn variant="primary" disabled={busy} onClick={() => void run(() => api.createReplenishment(), 'Órdenes de compra creadas.')}>Crear órdenes</Btn>
          </div>
          {(supply ?? []).length ? (
            <ul className="commercial-list">
              {(supply ?? []).map((group) => (
                <li key={group.supplierId}>
                  <strong>{group.supplierName}</strong> · llega en {group.leadTimeDays} días
                  <ul>
                    {group.lines.map((line) => (
                      <li key={line.productId}>{line.name}: {line.packQty} {line.packCode} × {line.unitsPerPack} · costo {money(line.unitPrice)} · {line.reason}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : <Empty title="Sin cálculo" desc="Calcula para ver qué está bajo el mínimo y a qué proveedor pedirlo." />}
        </Panel>
      ) : null}

      {tab === 'recall' ? (
        <Panel title="Retiro de lote">
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setRecallRows(await api.recall(recallBatch));
              }, 'Búsqueda de lote lista.');
            }}
          >
            <div className="field">
              <label htmlFor="com-recall">Lote</label>
              <input id="com-recall" value={recallBatch} onChange={(event) => setRecallBatch(event.target.value)} required />
            </div>
            <Btn type="submit" variant="primary" disabled={busy}>Buscar</Btn>
          </form>
          {recallRows ? (
            <>
              <p>Stock aún en bodega: {recallRows.stock.length ? recallRows.stock.map((lot) => `${lot.qty} u. en ${lot.loc}`).join(', ') : 'ninguno'}.</p>
              {recallRows.clients.length ? (
                <div className="table-scroll">
                  <table className="fc-table">
                    <thead><tr><th>Pedido</th><th>Cliente</th><th>Cantidad</th><th>Estado</th><th>Fecha</th></tr></thead>
                    <tbody>
                      {recallRows.clients.map((row) => (
                        <tr key={`${row.orderId}-${row.productId}`}>
                          <td>{row.orderId}</td>
                          <td>{row.clientName}</td>
                          <td>{row.qty}</td>
                          <td>{row.status}</td>
                          <td>{row.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>Ningún pedido preparado salió con ese lote.</p>}
            </>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
