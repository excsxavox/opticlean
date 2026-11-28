import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { money, product } from '../../shared/lib/inventory';
import { Badge, Btn, Empty, Kpi, KpiGrid, PageHead } from '../../shared/components/ui';
import { SegmentedControl } from '../../shared/components/Tabs';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { Menu, MoreButton } from '../../shared/components/Menu';
import { Modal } from '../../shared/components/Modal';
import type { AppState, CustomerQuote, SalesChannel } from '../../shared/types';
import '../../styles/quote-list.css';

const channelLabel: Record<SalesChannel, string> = {
  ejecutivo: 'Ejecutivo',
  portal: 'Portal',
  reposicion: 'Reposición',
};

type QuoteView = CustomerQuote['status'] | 'Vencida';

const tabs = ['Todas', 'Abierta', 'Ganada', 'Perdida', 'Vencida'] as const;
type Tab = (typeof tabs)[number];
const tabLabel: Record<Tab, string> = {
  Todas: 'Todas',
  Abierta: 'Abiertas',
  Ganada: 'Ganadas',
  Perdida: 'Perdidas',
  Vencida: 'Vencidas',
};

const statusTone: Record<QuoteView, string> = {
  Abierta: 'blue',
  Ganada: 'green',
  Perdida: 'red',
  Vencida: 'amber',
};

const PAGE_SIZE = 8;
/** Una cotización abierta "vence pronto" si le quedan estos días o menos. */
const SOON_DAYS = 3;

const todayIso = () => new Date().toISOString().slice(0, 10);

function viewOf(quote: CustomerQuote, today: string): QuoteView {
  return quote.status === 'Abierta' && quote.validUntil < today ? 'Vencida' : quote.status;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

const dateFormat = new Intl.DateTimeFormat('es-EC', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatDate = (iso: string) => {
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(time) ? iso : dateFormat.format(time);
};

function amountsOf(quote: CustomerQuote, state: AppState) {
  const ivaOf = (productId: string) => product(state, productId)?.ivaRate ?? 0.15;
  const subtotal = quote.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
  const tax = quote.lines.reduce(
    (sum, line) => sum + line.qty * line.unitPrice * ivaOf(line.productId),
    0,
  );
  const discount = Math.min(quote.discount ?? 0, subtotal);
  const share = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  const total = Math.round((subtotal - discount + tax * share) * 100) / 100;
  return { subtotal, discount, tax: tax * share, total };
}

const unitsOf = (quote: CustomerQuote) => quote.lines.reduce((sum, line) => sum + line.qty, 0);

function validityHint(quote: CustomerQuote, status: QuoteView, today: string) {
  if (status === 'Abierta') {
    const days = daysBetween(today, quote.validUntil);
    if (days === 0) return { text: 'Vence hoy', soon: true };
    return { text: days === 1 ? 'Queda 1 día' : `Quedan ${days} días`, soon: days <= SOON_DAYS };
  }
  if (status === 'Vencida') {
    const days = daysBetween(quote.validUntil, today);
    return { text: days === 1 ? 'Hace 1 día' : `Hace ${days} días`, soon: false };
  }
  return null;
}

export function QuotesPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Todas');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const quotes = useMemo(() => state?.quotes ?? [], [state?.quotes]);
  if (!state) return null;

  const today = todayIso();
  const clientName = (id: string) => state.clients.find((item) => item.id === id)?.name ?? id;
  const rows = quotes.map((quote) => ({
    quote,
    status: viewOf(quote, today),
    client: clientName(quote.clientId),
    ...amountsOf(quote, state),
  }));

  const countOf = (value: Tab) =>
    value === 'Todas' ? rows.length : rows.filter((row) => row.status === value).length;
  const sumOf = (list: typeof rows) => list.reduce((sum, row) => sum + row.total, 0);
  const open = rows.filter((row) => row.status === 'Abierta');
  const won = rows.filter((row) => row.status === 'Ganada');
  const decided = won.length + countOf('Perdida') + countOf('Vencida');
  const soon = open.filter((row) => daysBetween(today, row.quote.validUntil) <= SOON_DAYS).length;

  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (tab === 'Todas' || row.status === tab) &&
      (!needle ||
        [row.quote.number, row.client, row.quote.orderId ?? ''].some((text) =>
          text.toLowerCase().includes(needle),
        )),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const detail = rows.find((row) => row.quote.id === detailId);

  const changeTab = (value: Tab) => {
    setTab(value);
    setPage(1);
  };

  const act = async (id: string, win: boolean) => {
    if (busyId) return;
    setError('');
    setBusyId(id);
    try {
      applyResponse(win ? await api.winQuote(id) : await api.loseQuote(id));
      toast(
        win
          ? 'Cotización ganada. El pedido ya está por preparar.'
          : 'Cotización marcada como perdida.',
      );
      setDetailId(null);
    } catch (err) {
      setDetailId(null);
      setError(err instanceof Error ? err.message : 'No se pudo actualizar.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="qt-page">
      <PageHead
        eyebrow="Ventas"
        title="Cotizaciones"
        desc="Precio y vigencia antes de convertir la oferta en pedido."
        actions={
          <>
            <Btn icon="orders" onClick={() => navigate('/pedidos')}>
              Volver a pedidos
            </Btn>
            <Btn variant="primary" icon="plus" onClick={() => navigate('/cotizaciones/nueva')}>
              Nueva cotización
            </Btn>
          </>
        }
      />
      {error ? (
        <div className="form-error visible" role="alert">
          {error}
        </div>
      ) : null}

      <KpiGrid label="Resumen de cotizaciones">
        <Kpi
          label="Abiertas"
          icon="file"
          tone="primary"
          value={open.length}
          caption={soon ? `${soon} por vencer en ${SOON_DAYS} días o menos` : 'Vigentes'}
          captionTone={soon ? 'warning' : undefined}
          active={tab === 'Abierta'}
          onClick={() => changeTab(tab === 'Abierta' ? 'Todas' : 'Abierta')}
        />
        <Kpi
          label="Valor abierto"
          icon="chart"
          value={money(sumOf(open))}
          caption="Con IVA y descuentos"
        />
        <Kpi
          label="Ganadas"
          icon="check"
          tone="success"
          value={won.length}
          caption={`${money(sumOf(won))} convertidos en pedido`}
          active={tab === 'Ganada'}
          onClick={() => changeTab(tab === 'Ganada' ? 'Todas' : 'Ganada')}
        />
        <Kpi
          label="Tasa de cierre"
          icon="chart"
          value={decided ? `${Math.round((won.length / decided) * 100)}%` : '—'}
          caption={decided ? `${won.length} de ${decided} cerradas` : 'Sin cotizaciones cerradas'}
        />
      </KpiGrid>

      {rows.length ? (
        <section className="panel qt-panel">
          <div className="qt-toolbar">
            <SegmentedControl
              label="Estado de cotizaciones"
              value={tab}
              onValueChange={changeTab}
              items={tabs.map((value) => ({ value, label: tabLabel[value], count: countOf(value) }))}
            />
            <SearchInput
              className="qt-search"
              aria-label="Buscar cotización"
              placeholder="Buscar número, cliente o pedido…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              onClear={() => setQuery('')}
            />
          </div>

          {filtered.length ? (
            <div className="table-scroll">
              <table className="qt-table">
                <thead>
                  <tr>
                    <th>Cotización</th>
                    <th>Cliente</th>
                    <th>Vigencia</th>
                    <th className="qt-num">Total</th>
                    <th>Estado</th>
                    <th className="qt-actions-col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ quote, status, client, total, discount }) => {
                    const hint = validityHint(quote, status, today);
                    return (
                      <tr key={quote.id}>
                        <td>
                          <button
                            type="button"
                            className="qt-number"
                            onClick={() => setDetailId(quote.id)}
                          >
                            {quote.number}
                          </button>
                          <small>Creada el {formatDate(quote.date)}</small>
                        </td>
                        <td>
                          <strong>{client}</strong>
                          <small>Canal {channelLabel[quote.channel]}</small>
                        </td>
                        <td>
                          {formatDate(quote.validUntil)}
                          {hint ? (
                            <small className={hint.soon ? 'qt-soon' : undefined}>{hint.text}</small>
                          ) : null}
                        </td>
                        <td className="qt-num">
                          <strong>{money(total)}</strong>
                          <small>
                            {unitsOf(quote)} u.{discount > 0 ? ` · desc. ${money(discount)}` : ''}
                          </small>
                        </td>
                        <td>
                          <Badge text={status} color={statusTone[status]} />
                          {quote.orderId ? <small>Pedido {quote.orderId}</small> : null}
                        </td>
                        <td>
                          <div className="qt-actions">
                            <Btn size="small" icon="eye" onClick={() => setDetailId(quote.id)}>
                              Ver
                            </Btn>
                            {status === 'Abierta' ? (
                              <Btn
                                size="small"
                                variant="primary"
                                icon="check"
                                disabled={busyId !== null}
                                onClick={() => void act(quote.id, true)}
                              >
                                Ganar
                              </Btn>
                            ) : null}
                            {quote.status === 'Abierta' ? (
                              <Menu
                                label={`Más acciones de ${quote.number}`}
                                trigger={<MoreButton label={`Más acciones de ${quote.number}`} />}
                                items={[
                                  {
                                    label: 'Marcar como perdida',
                                    icon: 'close',
                                    tone: 'danger',
                                    disabled: busyId !== null,
                                    onSelect: () => void act(quote.id, false),
                                  },
                                ]}
                              />
                            ) : (
                              <span className="qt-actions-spacer" aria-hidden />
                            )}
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
              title="No hay cotizaciones con este filtro"
              desc="Cambia de pestaña o ajusta la búsqueda."
            />
          )}
          <Pagination
            label="Paginación de cotizaciones"
            className="qt-pagination"
            page={safePage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </section>
      ) : (
        <Empty
          title="Sin cotizaciones"
          desc="Crea la primera con cliente, productos, margen de vigencia y condiciones."
        />
      )}

      {detail ? (
        <Modal
          title={detail.quote.number}
          subtitle={`${detail.client} · ${formatDate(detail.quote.date)}`}
          onClose={() => setDetailId(null)}
          footer={
            <div className="qt-actions">
              <Btn onClick={() => setDetailId(null)}>Cerrar</Btn>
              {detail.quote.status === 'Abierta' ? (
                <Btn
                  icon="close"
                  disabled={busyId !== null}
                  onClick={() => void act(detail.quote.id, false)}
                >
                  Marcar como perdida
                </Btn>
              ) : null}
              {detail.status === 'Abierta' ? (
                <Btn
                  variant="primary"
                  icon="check"
                  disabled={busyId !== null}
                  onClick={() => void act(detail.quote.id, true)}
                >
                  Ganar y crear pedido
                </Btn>
              ) : null}
            </div>
          }
        >
          <div className="qt-detail">
            <div className="qt-detail-top">
              <Badge text={detail.status} color={statusTone[detail.status]} />
              <span>
                Canal {channelLabel[detail.quote.channel]} · Válida hasta{' '}
                {formatDate(detail.quote.validUntil)}
                {detail.quote.orderId ? ` · Pedido ${detail.quote.orderId}` : ''}
              </span>
            </div>
            <ul className="qt-lines">
              {detail.quote.lines.map((line, index) => (
                <li key={`${line.productId}-${index}`}>
                  <div>
                    <strong>{product(state, line.productId)?.name ?? line.productId}</strong>
                    <small>
                      {line.qty} u. × {money(line.unitPrice)}
                    </small>
                  </div>
                  <span>{money(line.qty * line.unitPrice)}</span>
                </li>
              ))}
            </ul>
            <dl className="qt-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(detail.subtotal)}</dd>
              </div>
              {detail.discount > 0 ? (
                <div>
                  <dt>Descuento</dt>
                  <dd>−{money(detail.discount)}</dd>
                </div>
              ) : null}
              <div>
                <dt>IVA</dt>
                <dd>{money(detail.tax)}</dd>
              </div>
              <div className="qt-total-row">
                <dt>Total</dt>
                <dd>{money(detail.total)}</dd>
              </div>
            </dl>
            {detail.quote.note ? <p className="qt-note">{detail.quote.note}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
