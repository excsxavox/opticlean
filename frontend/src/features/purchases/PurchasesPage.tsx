import { useEffect, useMemo, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { product, statusColor } from '../../shared/lib/inventory';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { can } from '../../shared/auth/permissions';
import { isRaw } from '../../shared/lib/bom';
import { packsOf, purchaseLines } from '../../shared/lib/wholesale';
import { ImportDialog } from '../imports/ImportDialog';
import { buildForecast, suggestedPurchaseQty, type ConfidenceLevel } from '../../shared/lib/forecast';
import { Badge, Btn, Empty, Kpi, KpiGrid, PageHead, ProductCell } from '../../shared/components/ui';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { dateShort, num } from '../../shared/lib/inventory';
import { Icon } from '../../shared/components/Icon';
import { ReceivePurchaseDialog } from './ReceivePurchaseDialog';
import '../../styles/forecast.css';

const confidenceLabel: Record<ConfidenceLevel, string> = {
  low: 'Aprendiendo',
  medium: 'Media',
  high: 'Alta',
};

export function PurchasesPage() {
  const { state, applyResponse, toast } = useAppState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [prefillProduct, setPrefillProduct] = useState('');
  const [prefillQty, setPrefillQty] = useState(12);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<Array<{ productId: string; qty: number; packCode: string; unitPrice: number }>>([]);
  const [error, setError] = useState('');
  const [receivingId, setReceivingId] = useState('');
  const [closing, setClosing] = useState<{ id: string; reason: string } | null>(null);
  const [focusId, setFocusId] = useState('');

  const forecast = useMemo(() => (state ? buildForecast(state) : null), [state]);

  useEffect(() => {
    const focus = (location.state as { focus?: string } | null)?.focus;
    if (!focus) return;
    setFocusId(focus);
    window.setTimeout(() => document.getElementById(`po-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }, [location.state]);

  useEffect(() => {
    const navState = location.state as { productId?: string; qty?: number } | null;
    if (!navState?.productId || !state) return;
    setPrefillProduct(navState.productId);
    setPrefillQty(navState.qty ?? suggestedPurchaseQty(state, navState.productId));
    setModalOpen(true);
    setError('');
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, state]);

  if (!state || !forecast) return null;

  const canManage = can(user, 'warehouse');
  const urgent = forecast.recommendations.filter((r) => r.urgency === 'now' || r.productionRisk);
  const soon = forecast.recommendations.filter((r) => r.urgency === 'soon' && !r.productionRisk);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.addPurchase({
          supplierId: supplierId || undefined,
          date: data.date,
          expectedDate: data.expectedDate,
          notes: data.notes,
          lines,
        }),
      );
      toast('Orden de compra registrada.');
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const saveSupplier = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.addSupplier({
          name: data.name,
          taxId: data.taxId,
          contact: data.contact,
          email: data.email,
          phone: data.phone,
          leadTimeDays: Number(data.leadTimeDays || 7),
          terms: data.terms,
        }),
      );
      toast('Proveedor guardado.');
      setSupplierOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo guardar el proveedor.');
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm(`¿Cancelar la orden ${id}? Lo ya recibido se mantiene en bodega.`)) return;
    try {
      applyResponse(await api.cancelPurchase(id));
      toast(`Orden ${id} cancelada.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cancelar la orden.');
    }
  };

  const closeShort = async () => {
    if (!closing) return;
    try {
      applyResponse(await api.closePurchase(closing.id, closing.reason));
      toast(`Orden ${closing.id} cerrada con faltante.`);
      setClosing(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cerrar la orden.');
    }
  };

  const openNew = (productId?: string, qty?: number) => {
    const id = productId ?? state.products[0]?.id ?? '';
    const amount = qty ?? (id ? suggestedPurchaseQty(state, id) : 12);
    const item = state.products.find((p) => p.id === id);
    setPrefillProduct(id);
    setPrefillQty(amount);
    setSupplierId(item?.supplierId ?? state.suppliers?.[0]?.id ?? '');
    setLines([{ productId: id, qty: Math.max(1, Math.round(amount)), packCode: 'unidad', unitPrice: item?.price ?? 0 }]);
    setModalOpen(true);
    setError('');
  };

  return (
    <>
      <PageHead
        eyebrow="Abastecimiento inteligente"
        title="Órdenes de compra"
        desc="La previsión mejora con cada pedido y despacho para anticipar faltantes y proteger la producción."
        actions={
          canManage ? (
            <>
              <Btn icon="receive" onClick={() => setImportOpen(true)}>
                Importar
              </Btn>
              <Btn icon="plus" onClick={() => setSupplierOpen(true)}>
                Proveedor
              </Btn>
              <Btn variant="primary" icon="plus" onClick={() => openNew()}>
                Nueva orden
              </Btn>
            </>
          ) : null
        }
      />

      <KpiGrid>
        <Kpi label="Urgente ahora" tone={urgent.length ? 'danger' : 'default'} value={urgent.length} unit="SKU" foot="Quiebre o riesgo de producción" icon="alert" />
        <Kpi label="Pronóstico pronto" value={soon.length} unit="SKU" foot={`Lead time ${forecast.leadDays} días`} icon="calendar" />
        <Kpi label="Riesgo producción" value={forecast.productionRisks.length} unit="" foot="BOM / materia prima" icon="layers" />
        <Kpi
          label="Aprendizaje del modelo"
          value={`${forecast.learningScore}%`}
          unit=""
          foot="Sube con más historial estable"
          icon="spark"
        />
      </KpiGrid>

      <section className="fc-banner" aria-label="Insight de previsión">
        <Icon name="spark" />
        <div>
          <strong>Previsión adaptativa</strong>
          <p>{forecast.insight}</p>
        </div>
        <Btn icon="chart" onClick={() => navigate('/reportes')}>Ver reportes</Btn>
      </section>

      <section className="panel fc-panel">
        <div className="panel-head">
          <span className="panel-title">Recomendaciones de abastecimiento</span>
          <Badge text={`${forecast.recommendations.length} activas`} color="blue" />
        </div>
        {forecast.recommendations.length ? (
          <div className="table-scroll">
            <table className="fc-table">
              <thead>
                <tr>
                  <th>Prioridad</th>
                  <th>Ítem</th>
                  <th>Cobertura</th>
                  <th>Sugerido</th>
                  <th>Confianza</th>
                  <th>Motivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {forecast.recommendations.slice(0, 16).map((row) => (
                  <tr key={row.productId} className={row.productionRisk ? 'fc-row-risk' : row.urgency === 'now' ? 'fc-row-now' : ''}>
                    <td>
                      <span className={`fc-urgency fc-urgency-${row.productionRisk ? 'risk' : row.urgency}`}>
                        {row.productionRisk ? 'Producción' : row.urgency === 'now' ? 'Ahora' : row.urgency === 'soon' ? 'Pronto' : 'Vigilancia'}
                      </span>
                    </td>
                    <td>
                      <ProductCell
                        name={row.name}
                        id={row.productId}
                        category={`${row.kind === 'raw' ? 'Insumo' : 'Producto'} · ${row.category}`}
                      />
                      {row.blocksParents > 0 && (
                        <small className="fc-parents">Bloquea {row.blocksParents}: {row.parentNames.slice(0, 2).join(', ')}{row.parentNames.length > 2 ? '…' : ''}</small>
                      )}
                    </td>
                    <td>
                      <strong>{row.daysCover === null ? '—' : `${row.daysCover}d`}</strong>
                      <small className="sub">{num(row.available)} disp. · mín. {num(row.min)}</small>
                      <div className="fc-learn" title={`Aprendizaje ${(row.learningWeight * 100).toFixed(0)}%`}>
                        <span style={{ width: `${Math.max(8, row.learningWeight * 100)}%` }} />
                      </div>
                    </td>
                    <td>
                      <strong>{num(row.suggestedQty)}</strong>
                      <small className="sub">~{row.dailyDemand.toFixed(1)} uds/día</small>
                    </td>
                    <td>
                      <span className={`fc-conf fc-conf-${row.confidence}`}>
                        {confidenceLabel[row.confidence]} · {row.confidenceScore}%
                      </span>
                    </td>
                    <td className="fc-reason">{row.reason}</td>
                    <td>
                      {canManage ? (
                        <Btn variant="small" icon="plus" onClick={() => openNew(row.productId, row.suggestedQty || undefined)}>
                          Solicitar
                        </Btn>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin recomendaciones" desc="El inventario cubre el horizonte. El modelo sigue aprendiendo en segundo plano." />
        )}
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <span className="panel-title">Solicitudes de compra</span>
        </div>
        {state.purchases.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Proveedor</th>
                  <th>Líneas</th>
                  <th>Recibido</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.purchases.map((o) => {
                  const status = o.status ?? 'Abierta';
                  const open = status === 'Abierta' || status === 'Parcial';
                  const linesOf = purchaseLines(o);
                  const supplier = state.suppliers?.find((item) => item.id === o.supplierId);
                  const isAdmin = user?.role === 'admin';
                  return (
                    <tr key={o.id} id={`po-${o.id}`} className={focusId === o.id ? 'is-new' : undefined}>
                      <td>
                        <strong>{o.id}</strong>
                        <span className="sub">{dateShort(o.date)}</span>
                        {o.orderIds?.length ? (
                          <span className="sub">
                            Para{' '}
                            {o.orderIds.map((id, i) => (
                              <span key={id}>
                                {i ? ', ' : ''}
                                <button type="button" className="fx-link" onClick={() => navigate('/pedidos', { state: { open: id } })}>
                                  {id}
                                </button>
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {o.closeReason ? <span className="sub">Cerrada: {o.closeReason}</span> : null}
                      </td>
                      <td>{supplier?.name ?? 'Sin proveedor'}</td>
                      <td>
                        {linesOf.map((line) => (
                          <div key={`${o.id}-${line.productId}`}>
                            {product(state, line.productId)?.name ?? line.productId}
                            <span className="sub">
                              {' '}
                              {line.qty} {line.packCode}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td>
                        {o.received ?? 0} / {o.qty} u.
                      </td>
                      <td>
                        <Badge text={status} color={statusColor(status)} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {open && canManage ? (
                          <>
                            <Btn variant="small" icon="receive" onClick={() => setReceivingId(o.id)}>
                              Recibir
                            </Btn>{' '}
                            {status === 'Parcial' ? (
                              isAdmin ? (
                                <Btn variant="small" icon="check" onClick={() => setClosing({ id: o.id, reason: '' })}>
                                  Cerrar con faltante
                                </Btn>
                              ) : null
                            ) : (
                              <Btn variant="small" icon="close" onClick={() => void cancel(o.id)}>
                                Cancelar
                              </Btn>
                            )}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin solicitudes" desc="Crea la primera desde una recomendación del modelo." />
        )}
      </section>

      {receivingId && state.purchases.some((p) => p.id === receivingId) ? (
        <ReceivePurchaseDialog
          state={state}
          purchase={state.purchases.find((p) => p.id === receivingId)!}
          onClose={() => setReceivingId('')}
        />
      ) : null}

      {closing ? (
        <Modal
          title={`Cerrar ${closing.id} con faltante`}
          subtitle="Lo recibido se queda en bodega. El faltante ya no se espera del proveedor."
          onClose={() => setClosing(null)}
          footer={
            <>
              <Btn onClick={() => setClosing(null)}>Volver</Btn>
              <Btn variant="primary" icon="check" disabled={!closing.reason.trim()} onClick={() => void closeShort()}>
                Cerrar orden
              </Btn>
            </>
          }
        >
          <div className="field full">
            <label htmlFor="po-close-reason">Motivo</label>
            <input
              id="po-close-reason"
              value={closing.reason}
              placeholder="Ej.: el proveedor no tiene más stock"
              onChange={(e) => setClosing({ ...closing, reason: e.target.value })}
            />
          </div>
        </Modal>
      ) : null}

      {modalOpen ? (
        <Modal
          title="Nueva solicitud de compra"
          subtitle="Cantidad prellenada por la previsión adaptativa (puedes ajustarla)."
          onClose={() => setModalOpen(false)}
          footer={
            <ModalActions onCancel={() => setModalOpen(false)} submitLabel="Registrar" formId="purchase-form" icon="save" />
          }
        >
          <form id="purchase-form" onSubmit={submit} key={`${prefillProduct}-${prefillQty}`}>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="pur-supplier">Proveedor</label>
                <Select id="pur-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Sin proveedor</option>
                  {(state.suppliers ?? []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                      {supplier.taxId ? ` · ${supplier.taxId}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              {lines.map((line, index) => {
                const item = state.products.find((p) => p.id === line.productId);
                const packs = packsOf(item);
                return (
                  <div className="field full" key={`${line.productId}-${index}`}>
                    <label>Línea {index + 1}</label>
                    <div className="form-grid">
                      <Select
                        aria-label={`Producto ${index + 1}`}
                        value={line.productId}
                        onChange={(e) => {
                          const next = state.products.find((p) => p.id === e.target.value);
                          setLines((current) =>
                            current.map((row, i) =>
                              i === index
                                ? { ...row, productId: e.target.value, unitPrice: next?.price ?? row.unitPrice }
                                : row,
                            ),
                          );
                        }}
                      >
                        {state.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {isRaw(p) ? 'MP' : 'PT'} · {p.name}
                          </option>
                        ))}
                      </Select>
                      <input
                        aria-label={`Cantidad ${index + 1}`}
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((row, i) => (i === index ? { ...row, qty: Number(e.target.value) } : row)),
                          )
                        }
                        required
                      />
                      <Select
                        aria-label={`Empaque ${index + 1}`}
                        value={line.packCode}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((row, i) => (i === index ? { ...row, packCode: e.target.value } : row)),
                          )
                        }
                      >
                        {packs.map((pack) => (
                          <option key={pack.code} value={pack.code}>
                            {pack.label} × {pack.units}
                          </option>
                        ))}
                      </Select>
                      <input
                        aria-label={`Precio ${index + 1}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((row, i) => (i === index ? { ...row, unitPrice: Number(e.target.value) } : row)),
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}
              <div className="field">
                <label htmlFor="pur-date">Fecha</label>
                <input id="pur-date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </div>
              <div className="field">
                <label htmlFor="pur-expected">Llegada esperada</label>
                <input id="pur-expected" name="expectedDate" type="date" />
              </div>
              <div className="field full">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const item = state.products[0];
                    if (!item) return;
                    setLines((current) => [
                      ...current,
                      { productId: item.id, qty: 1, packCode: 'unidad', unitPrice: item.price },
                    ]);
                  }}
                >
                  Añadir línea
                </button>
              </div>
              <div className="field full">
                <label htmlFor="pur-notes">Observaciones</label>
                <textarea
                  id="pur-notes"
                  name="notes"
                  maxLength={300}
                  defaultValue={
                    forecast.recommendations.find((r) => r.productId === prefillProduct)?.reason?.slice(0, 280) ?? ''
                  }
                />
              </div>
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
      {importOpen ? (
        <ImportDialog
          kind="purchase"
          onClose={() => setImportOpen(false)}
          onDone={(message) => {
            setImportOpen(false);
            toast(message);
          }}
        />
      ) : null}
      {supplierOpen ? (
        <Modal
          title="Nuevo proveedor"
          subtitle="RUC, contacto y tiempo de entrega para las compras al por mayor."
          onClose={() => setSupplierOpen(false)}
          footer={<ModalActions onCancel={() => setSupplierOpen(false)} submitLabel="Guardar" formId="supplier-form" icon="save" />}
        >
          <form id="supplier-form" onSubmit={(e) => void saveSupplier(e)}>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="sup-name">Nombre</label>
                <input id="sup-name" name="name" required />
              </div>
              <div className="field">
                <label htmlFor="sup-tax">RUC</label>
                <input id="sup-tax" name="taxId" inputMode="numeric" pattern="\d{13}" minLength={13} maxLength={13} required />
              </div>
              <div className="field">
                <label htmlFor="sup-lead">Días de entrega</label>
                <input id="sup-lead" name="leadTimeDays" type="number" min={0} defaultValue={7} />
              </div>
              <div className="field">
                <label htmlFor="sup-contact">Contacto</label>
                <input id="sup-contact" name="contact" />
              </div>
              <div className="field">
                <label htmlFor="sup-phone">Teléfono</label>
                <input id="sup-phone" name="phone" />
              </div>
              <div className="field full">
                <label htmlFor="sup-email">Correo</label>
                <input id="sup-email" name="email" type="email" />
              </div>
              <div className="field full">
                <label htmlFor="sup-terms">Condiciones</label>
                <input id="sup-terms" name="terms" placeholder="Crédito 30 días, pedido mínimo…" />
              </div>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
