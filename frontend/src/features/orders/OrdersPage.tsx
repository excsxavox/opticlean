import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { canAccessPath } from '../../shared/auth/permissions';
import { api } from '../../shared/api/client';
import {
  client,
  invoiceBalance,
  money,
  orderValue,
  orderWeight,
  product,
  statusColor,
} from '../../shared/lib/inventory';
import { Badge, Btn, Empty, Kpi, KpiGrid, PageHead, Button } from '../../shared/components/ui';
import { SegmentedControl } from '../../shared/components/Tabs';
import { Select } from '../../shared/components/Select';
import { Modal } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/Icon';
import { AssignPicker } from './AssignPicker';
import '../../styles/orders.css';
import { Pagination } from '../../shared/components/Pagination';
import { Input } from '../../shared/components/Input';

const tabs = [
  'Todos',
  'Esperando stock',
  'Por preparar',
  'Preparado',
  'En ruta',
  'Entregado',
  'Incidencia',
] as const;
const PAGE_SIZE = 8;

function isLiveOrder(id: string) {
  return !id.startsWith('PED-H');
}

export function OrdersPage() {
  const { state, applyResponse, toast } = useAppState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof tabs)[number]>('Por preparar');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [bodegueroCount, setBodegueroCount] = useState(0);
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Transferencia');
  const [payRef, setPayRef] = useState('');
  const [billBusy, setBillBusy] = useState(false);
  const canCancel = user?.role === 'admin' || user?.role === 'ops';
  const canBill = user?.role === 'admin';

  const confirmCancel = async () => {
    if (!cancelling || cancelBusy) return;
    setCancelBusy(true);
    try {
      applyResponse(await api.cancelOrder(cancelling.id, cancelling.reason));
      toast(`Pedido ${cancelling.id} cancelado.`);
      setCancelling(null);
      setDetailId(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cancelar el pedido.');
    } finally {
      setCancelBusy(false);
    }
  };
  const location = useLocation();
  const [params] = useSearchParams();
  const query = (params.get('q') ?? '').trim().toLowerCase();

  // Abre el detalle cuando se llega desde una orden de compra enlazada.
  useEffect(() => {
    const open = (location.state as { open?: string } | null)?.open;
    if (!open) return;
    setTab('Todos');
    setDetailId(open);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const liveOrders = useMemo(
    () => (state ? state.orders.filter((o) => isLiveOrder(o.id)) : []),
    [state],
  );

  const counts = useMemo(() => {
    const by = (status: string) => liveOrders.filter((o) => o.status === status).length;
    const pending = liveOrders.filter((o) => o.status === 'Por preparar');
    return {
      todos: liveOrders.length,
      esperando: by('Esperando stock'),
      porPreparar: by('Por preparar'),
      preparado: by('Preparado'),
      enRuta: by('En ruta'),
      entregado: by('Entregado'),
      incidencia: by('Incidencia'),
      sinAsignar: pending.filter((o) => !o.assignedToUserId).length,
    };
  }, [liveOrders]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    void api
      .listUsers({ role: 'ops', activeOnly: true })
      .then((res) => {
        if (!cancelled) setBodegueroCount(res.users.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  useEffect(() => {
    if (query) setTab('Todos');
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  const today = new Date().toISOString().slice(0, 10);
  // Abiertas y todavía vigentes.
  const openQuotes = (state?.quotes ?? []).filter(
    (quote) => quote.status === 'Abierta' && quote.validUntil >= today,
  ).length;
  if (!state) return null;

  const list = liveOrders.filter((o) => {
    if (tab !== 'Todos' && o.status !== tab) return false;
    if (!query) return true;
    const name = client(state, o.clientId)?.name ?? '';
    return o.id.toLowerCase().includes(query) || name.toLowerCase().includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageList = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const detail = detailId ? liveOrders.find((o) => o.id === detailId) : null;
  const detailClient = detail ? client(state, detail.clientId) : null;
  const detailTotal = detail ? orderValue(state, detail) : 0;
  const detailKg = detail ? orderWeight(state, detail) : 0;
  const detailInvoice = detail
    ? (state.invoices ?? []).find((item) => item.orderId === detail.id && item.status === 'Emitida')
    : undefined;
  const detailBalance = detailInvoice ? invoiceBalance(state, detailInvoice.id) : 0;

  const emitInvoice = async () => {
    if (!detail || billBusy) return;
    setBillBusy(true);
    try {
      applyResponse(await api.issueInvoice(detail.id));
      toast('Factura emitida.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo emitir la factura.');
    } finally {
      setBillBusy(false);
    }
  };

  const collect = async () => {
    if (!detailInvoice || billBusy) return;
    setBillBusy(true);
    try {
      applyResponse(
        await api.collectPayment({
          invoiceId: detailInvoice.id,
          amount: Number(payAmount),
          method: payMethod,
          reference: payRef,
        }),
      );
      setPayAmount('');
      setPayRef('');
      toast('Abono registrado.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo registrar el abono.');
    } finally {
      setBillBusy(false);
    }
  };

  const tabCount = (t: (typeof tabs)[number]) => {
    if (t === 'Todos') return counts.todos;
    if (t === 'Esperando stock') return counts.esperando;
    if (t === 'Por preparar') return counts.porPreparar;
    if (t === 'Preparado') return counts.preparado;
    if (t === 'En ruta') return counts.enRuta;
    if (t === 'Entregado') return counts.entregado;
    return counts.incidencia;
  };

  return (
    <div className="ord-page">
      <PageHead
        eyebrow="Gestión de pedidos"
        title="Del pedido a la entrega"
        desc="Disponibilidad, preparación y seguimiento en un mismo flujo."
        actions={
          <>
            {canAccessPath(user, '/cotizaciones') ? (
              <Btn icon="file" onClick={() => navigate('/cotizaciones')}>
                Cotizaciones
                {openQuotes > 0 ? (
                  <span className="orders-quotes-count" title="Cotizaciones abiertas">
                    {openQuotes}
                  </span>
                ) : null}
              </Btn>
            ) : null}
            <Btn variant="primary" icon="plus" onClick={() => navigate('/pedidos/nuevo')}>
              Nuevo pedido
            </Btn>
          </>
        }
      />

      <KpiGrid>
        <Kpi
          label="En operación"
          value={counts.todos}
          unit="pedidos"
          foot="Sin historial demo"
          icon="orders"
        />
        <Kpi
          label="Por preparar"
          value={counts.porPreparar}
          unit=""
          foot={
            user?.role === 'admin' ? `${counts.sinAsignar} sin asignar` : 'Pendientes de picking'
          }
          icon="box"
        />
        <Kpi
          label="Bodegueros"
          value={user?.role === 'admin' ? bodegueroCount : counts.preparado + counts.enRuta}
          unit=""
          foot={
            user?.role === 'admin'
              ? 'Activos para asignar'
              : `${counts.preparado} listos · ${counts.enRuta} en ruta`
          }
          icon={user?.role === 'admin' ? 'warehouse' : 'truck'}
        />
        <Kpi
          label="Entregados"
          value={counts.entregado}
          unit=""
          foot="Confirmados"
          icon="check"
          color="positive"
        />
      </KpiGrid>

      <SegmentedControl
        label="Estado de pedidos"
        value={tab}
        onValueChange={setTab}
        items={tabs.map((t) => ({ value: t, label: t, count: tabCount(t) }))}
        className="ord-status-filter"
      />

      <section className="panel">
        {list.length ? (
          <div className="table-scroll">
            <table className="ord-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Destino</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Bodeguero</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageList.map((o) => {
                  const c = client(state, o.clientId);
                  return (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.id}</strong>
                        <small>
                          {o.date} · {o.priority}
                          {o.vehicle ? ` · ${o.vehicle}` : ''}
                        </small>
                      </td>
                      <td>
                        <strong>{c?.name ?? o.clientId}</strong>
                        <small>{c?.type ?? 'Cliente'}</small>
                      </td>
                      <td>
                        {c?.city ?? '—'}
                        <small>{c?.sector ?? c?.address ?? ''}</small>
                      </td>
                      <td>
                        <strong>{money(orderValue(state, o))}</strong>
                        <small>
                          {o.lines.length + (o.kits?.length ?? 0)} ítems ·{' '}
                          {orderWeight(state, o).toFixed(0)} kg
                        </small>
                      </td>
                      <td>
                        <Badge text={o.status} color={statusColor(o.status)} />
                      </td>
                      <td>
                        <AssignPicker order={o} compact />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Btn variant="small" icon="eye" onClick={() => setDetailId(o.id)}>
                            Ver
                          </Btn>
                          {o.status === 'Por preparar' ? (
                            <Btn
                              variant="small"
                              icon="route"
                              onClick={() => navigate('/bodega', { state: { pick: o.id } })}
                            >
                              Preparar
                            </Btn>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No hay pedidos en este estado"
            desc="Cambia de pestaña o crea un nuevo pedido."
          />
        )}
        {list.length ? (
          <Pagination
            label="Paginación de pedidos"
            className="ord-pagination"
            page={safePage}
            pageCount={pageCount}
            total={list.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {detail && detailClient ? (
        <Modal
          title={detail.id}
          subtitle={`${detailClient.name} · ${detail.date}`}
          onClose={() => setDetailId(null)}
          footer={
            <div className="ord-actions">
              <Btn onClick={() => setDetailId(null)}>Cerrar</Btn>
              {canCancel &&
              ['Esperando stock', 'Por preparar', 'Preparado'].includes(detail.status) ? (
                <Btn icon="close" onClick={() => setCancelling({ id: detail.id, reason: '' })}>
                  Cancelar pedido
                </Btn>
              ) : null}
              {detail.status === 'Por preparar' ? (
                <Btn
                  variant="primary"
                  icon="route"
                  onClick={() => {
                    setDetailId(null);
                    navigate('/bodega', { state: { pick: detail.id } });
                  }}
                >
                  Ir a preparar
                </Btn>
              ) : null}
              {detail.status === 'Preparado' ? (
                <Btn
                  variant="primary"
                  icon="truck"
                  onClick={() => {
                    setDetailId(null);
                    navigate('/logistica');
                  }}
                >
                  Ir a distribución
                </Btn>
              ) : null}
            </div>
          }
        >
          <div className="ord-detail">
            <div className="ord-detail-top">
              <Badge text={detail.status} color={statusColor(detail.status)} />
              <Badge
                text={detail.priority}
                color={detail.priority === 'Alta' ? 'amber' : 'muted'}
              />
              {detail.vehicle ? <Badge text={detail.vehicle} color="blue" /> : null}
            </div>
            {detail.status === 'Esperando stock' ? (
              <div className="no-shortage" role="status">
                <Icon name="alert" />
                <div>
                  <strong>Esperando stock</strong>
                  <p>
                    {(detail.shortages ?? [])
                      .map(
                        (s) =>
                          `Faltan ${s.qty} u. de ${product(state, s.productId)?.name ?? s.productId}`,
                      )
                      .join(' · ') || 'Falta mercadería para completar el pedido.'}
                    . Pasa a «Por preparar» automáticamente al recibir.
                  </p>
                  {detail.purchaseIds?.length ? (
                    <p>
                      Órdenes de compra:{' '}
                      {detail.purchaseIds.map((id, i) => (
                        <span key={id}>
                          {i ? ', ' : ''}
                          <Button
                            variant="link"
                            className="fx-link"
                            onClick={() => navigate('/compras', { state: { focus: id } })}
                          >
                            {id}
                          </Button>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {detail.status === 'Por preparar' || detail.assignedToName ? (
              <div className="ord-assign-block">
                <AssignPicker order={detail} />
              </div>
            ) : null}

            <div className="ord-meta">
              <article>
                <span>Cliente</span>
                <strong>{detailClient.name}</strong>
              </article>
              <article>
                <span>Contacto</span>
                <strong>{detailClient.contact || '—'}</strong>
              </article>
              <article>
                <span>Entrega</span>
                <strong>
                  {detailClient.city ?? '—'}
                  {detailClient.sector ? ` · ${detailClient.sector}` : ''}
                </strong>
              </article>
              <article>
                <span>Dirección</span>
                <strong>{detailClient.address}</strong>
              </article>
              <article>
                <span>Peso estimado</span>
                <strong>{detailKg.toFixed(1)} kg</strong>
              </article>
              <article>
                <span>Ítems</span>
                <strong>
                  {detail.lines.length + (detail.kits?.length ?? 0)} líneas ·{' '}
                  {detail.lines.reduce((n, l) => n + l.qty, 0) +
                    (detail.kits ?? []).reduce((n, kit) => n + kit.qty, 0)}{' '}
                  u.
                </strong>
              </article>
            </div>

            {detail.notes ? (
              <div className="ord-notes">
                <Icon name="file" /> Notas: {detail.notes}
              </div>
            ) : null}

            {detail.deliveredTo ? (
              <div
                className="ord-notes"
                style={{ background: '#eefaf4', borderColor: '#b7e0cb', color: '#1f7a4d' }}
              >
                Entregado a {detail.deliveredTo}
                {detail.deliveredAt
                  ? ` · ${new Date(detail.deliveredAt).toLocaleString('es-EC')}`
                  : ''}
              </div>
            ) : null}

            <ul className="ord-lines">
              {(detail.kits ?? []).map((kit) => {
                const bundle = state.bundles?.find((item) => item.id === kit.bundleId);
                return (
                  <li key={kit.bundleId}>
                    <div>
                      <strong>{bundle?.name ?? kit.bundleId}</strong>
                      <small>Paquete × {kit.qty} · reserva componentes</small>
                    </div>
                    <em>{money((bundle?.price ?? 0) * kit.qty)}</em>
                  </li>
                );
              })}
              {detail.lines.map((l) => {
                const p = product(state, l.productId);
                const lineTotal = (p?.price ?? 0) * l.qty;
                return (
                  <li key={l.productId}>
                    <div>
                      <strong>{p?.name ?? l.productId}</strong>
                      <small>
                        {l.productId} · {p?.category ?? 'Producto'} · {money(p?.price ?? 0)} c/u ×{' '}
                        {l.qty}
                      </small>
                    </div>
                    <em>{money(lineTotal)}</em>
                  </li>
                );
              })}
            </ul>

            <div className="ord-total">
              <span>Total del pedido</span>
              <strong>{money(detailTotal)}</strong>
            </div>

            {['Preparado', 'En ruta', 'Entregado'].includes(detail.status) ? (
              <div className="ord-notes">
                {detailInvoice ? (
                  <p>
                    <strong>{detailInvoice.number}</strong>
                    {' · '}
                    total {money(detailInvoice.total)} · saldo {money(detailBalance)}
                    {detailInvoice.lines.some((line) => line.batch)
                      ? ` · lotes ${detailInvoice.lines
                          .map((line) => line.batch)
                          .filter(Boolean)
                          .join(', ')}`
                      : ''}
                  </p>
                ) : canBill ? (
                  <Btn variant="primary" disabled={billBusy} onClick={() => void emitInvoice()}>
                    Emitir factura
                  </Btn>
                ) : (
                  <p>La factura la emite administración cuando el pedido ya está preparado.</p>
                )}
                {canBill && detailInvoice && detailBalance > 0 ? (
                  <form
                    className="form-grid"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void collect();
                    }}
                  >
                    <div className="field">
                      <label htmlFor="ord-pay-amount">Abono</label>
                      <input
                        id="ord-pay-amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={detailBalance}
                        value={payAmount}
                        onChange={(event) => setPayAmount(event.target.value)}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ord-pay-method">Método</label>
                      <Select
                        id="ord-pay-method"
                        value={payMethod}
                        onChange={(event) => setPayMethod(event.target.value)}
                      >
                        <option>Transferencia</option>
                        <option>Efectivo</option>
                        <option>Cheque</option>
                        <option>Retención</option>
                      </Select>
                    </div>
                    <div className="field">
                      <label htmlFor="ord-pay-ref">Referencia</label>
                      <input
                        id="ord-pay-ref"
                        value={payRef}
                        onChange={(event) => setPayRef(event.target.value)}
                        required
                      />
                    </div>
                    <Btn type="submit" variant="primary" disabled={billBusy}>
                      Registrar abono
                    </Btn>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {cancelling ? (
        <Modal
          title={`Cancelar ${cancelling.id}`}
          subtitle="Si ya estaba preparado, la mercadería vuelve a bodega. Las órdenes de compra del faltante siguen abiertas."
          onClose={() => setCancelling(null)}
          footer={
            <>
              <Btn onClick={() => setCancelling(null)}>Volver</Btn>
              <Btn
                variant="primary"
                icon="close"
                disabled={cancelBusy || !cancelling.reason.trim()}
                onClick={() => void confirmCancel()}
              >
                Cancelar pedido
              </Btn>
            </>
          }
        >
          <div className="field full">
            <label htmlFor="ord-cancel-reason">Motivo</label>
            <Input
              id="ord-cancel-reason"
              value={cancelling.reason}
              placeholder="Ej.: el cliente ya no lo necesita"
              onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
