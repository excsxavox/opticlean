import { useEffect, useMemo, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { api } from '../../shared/api/client';
import {
  creditAvailable,
  creditUsed,
  invoiceBalance,
  money,
  orderValue,
  outstandingReceivable,
  statusColor,
} from '../../shared/lib/inventory';
import { Badge, Btn, PageHead } from '../../shared/components/ui';
import { resolveBusinessRules } from '../../shared/lib/businessRules';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';
import type { Client, Order } from '../../shared/types';
import '../../styles/clients.css';

type CreditFilter = 'all' | 'ok' | 'tight' | 'full';
type ViewMode = 'list' | 'cards';
type DetailTab = 'resumen' | 'pedidos' | 'credito' | 'cuenta';
type SortMode = 'name' | 'orders' | 'credit';

const PAGE_SIZE = 8;
const CLIENT_TYPES = ['Corporativo', 'Hotelería', 'Salud', 'Restauración', 'Institucional', 'Retail', 'Industrial', 'Mayorista'];

function ClientFields({
  client,
  isAdmin,
  idPrefix,
  creditDefault = 0,
}: {
  client?: Client;
  isAdmin: boolean;
  idPrefix: string;
  creditDefault?: number;
}) {
  return (
    <div className="form-grid">
      <div className="field full">
        <label htmlFor={`${idPrefix}-name`}>Nombre</label>
        <input id={`${idPrefix}-name`} name="name" defaultValue={client?.name} required />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-tax`}>RUC</label>
        <input
          id={`${idPrefix}-tax`}
          name="taxId"
          inputMode="numeric"
          pattern="\d{13}"
          minLength={13}
          maxLength={13}
          defaultValue={client?.taxId}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-person`}>Contacto</label>
        <input id={`${idPrefix}-person`} name="contact" defaultValue={client?.contact} required />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-phone`}>Teléfono</label>
        <input id={`${idPrefix}-phone`} name="phone" defaultValue={client?.phone} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-type`}>Tipo de cliente</label>
        <Select id={`${idPrefix}-type`} name="type" defaultValue={client?.type || 'Corporativo'}>
          {(client?.type && !CLIENT_TYPES.includes(client.type) ? [client.type, ...CLIENT_TYPES] : CLIENT_TYPES).map((type) => (
            <option key={type}>{type}</option>
          ))}
        </Select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-city`}>Ciudad de entrega</label>
        <input id={`${idPrefix}-city`} name="city" defaultValue={client?.city} />
      </div>
      <div className="field full">
        <label htmlFor={`${idPrefix}-address`}>Dirección</label>
        <input id={`${idPrefix}-address`} name="address" defaultValue={client?.address} required />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-email`}>Correo</label>
        <input id={`${idPrefix}-email`} name="email" type="email" defaultValue={client?.email} required />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-cadence`}>Reposición cada (días)</label>
        <input
          id={`${idPrefix}-cadence`}
          name="reorderEveryDays"
          type="number"
          min={1}
          step={1}
          defaultValue={client?.reorderEveryDays ?? ''}
        />
      </div>
      {isAdmin ? (
        <>
          <div className="field">
            <label htmlFor={`${idPrefix}-credit`}>Límite de crédito (USD)</label>
            <input
              id={`${idPrefix}-credit`}
              name="creditLimit"
              type="number"
              min={0}
              step={50}
              defaultValue={client?.creditLimit ?? creditDefault}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-terms`}>Plazo de pago (días)</label>
            <input
              id={`${idPrefix}-terms`}
              name="paymentTermsDays"
              type="number"
              min={0}
              step={1}
              defaultValue={client?.paymentTermsDays ?? 30}
              required
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t[0]?.toUpperCase() ?? '')
    .join('');
}

function clientOrders(state: { orders: Order[] }, clientId: string) {
  return state.orders.filter((o) => o.clientId === clientId && !o.id.startsWith('PED-H'));
}

export function ClientsPage() {
  const { state, applyResponse, toast } = useAppState();
  const { user } = useAuth();
  /** Cupo y plazo de crédito los fija administración. */
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [creditDraft, setCreditDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [sector, setSector] = useState('all');
  const [creditFilter, setCreditFilter] = useState<CreditFilter>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortMode>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('resumen');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const sectors = useMemo(
    () =>
      [...new Set((state?.clients ?? []).map((c) => c.type).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'es'),
      ),
    [state?.clients],
  );

  const rules = resolveBusinessRules(state?.settings);

  const rows = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    const creditRules = resolveBusinessRules(state.settings);
    const list = state.clients
      .map((c) => {
        const orders = clientOrders(state, c.id);
        const limit = c.creditLimit ?? 0;
        const used = creditUsed(state, c.id);
        const available = creditAvailable(state, c.id);
        const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
        return { client: c, orders, limit, used, available, pct };
      })
      .filter(({ client: c, pct }) => {
        if (sector !== 'all' && c.type !== sector) return false;
        if (creditFilter === 'ok' && pct >= creditRules.creditOkMaxPct) return false;
        if (
          creditFilter === 'tight' &&
          (pct < creditRules.creditOkMaxPct || pct >= creditRules.creditTightMaxPct)
        )
          return false;
        if (creditFilter === 'full' && pct < creditRules.creditTightMaxPct) return false;
        if (!q) return true;
        return [c.name, c.contact, c.email, c.address, c.id, c.sector, c.city, c.phone, c.taxId]
          .join(' ')
          .toLowerCase()
          .includes(q);
      });

    list.sort((a, b) => {
      if (sort === 'orders')
        return (
          b.orders.length - a.orders.length || a.client.name.localeCompare(b.client.name, 'es')
        );
      if (sort === 'credit')
        return b.available - a.available || a.client.name.localeCompare(b.client.name, 'es');
      return a.client.name.localeCompare(b.client.name, 'es');
    });
    return list;
  }, [state, query, sector, creditFilter, sort]);

  useEffect(() => {
    setPage(1);
  }, [query, sector, creditFilter, sort, view]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeFrom = rows.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const rangeTo = Math.min(safePage * PAGE_SIZE, rows.length);

  if (!state) return null;

  const selected =
    rows.find((r) => r.client.id === selectedId) ??
    (selectedId
      ? (() => {
          const c = state.clients.find((x) => x.id === selectedId);
          if (!c) return null;
          const orders = clientOrders(state, c.id);
          const limit = c.creditLimit ?? 0;
          const used = creditUsed(state, c.id);
          return {
            client: c,
            orders,
            limit,
            used,
            available: creditAvailable(state, c.id),
            pct: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
          };
        })()
      : null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await api.addClient(data);
      applyResponse(res);
      toast('Cliente registrado.');
      setOpen(false);
      const created = res.state.clients.at(-1);
      if (created) setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const saveCredit = async () => {
    if (!editId || busy) return;
    setBusy(true);
    setError('');
    try {
      applyResponse(await api.updateClient(editId, { creditLimit: Number(creditDraft) }));
      toast('Límite de crédito actualizado.');
      setEditId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const editing = editId ? state.clients.find((c) => c.id === editId) : null;
  const profiling = profileId ? state.clients.find((c) => c.id === profileId) : null;

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profileId || busy) return;
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const body: Record<string, unknown> = {
      name: data.name,
      taxId: data.taxId,
      contact: data.contact,
      phone: data.phone,
      type: data.type,
      city: data.city,
      address: data.address,
      email: data.email,
      reorderEveryDays: data.reorderEveryDays ? Number(data.reorderEveryDays) : undefined,
    };
    if (isAdmin) {
      body.creditLimit = Number(data.creditLimit);
      body.paymentTermsDays = Number(data.paymentTermsDays);
    }
    try {
      applyResponse(await api.updateClient(profileId, body));
      toast('Cliente actualizado.');
      setProfileId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el cliente.');
    } finally {
      setBusy(false);
    }
  };

  const openCredit = (c: Client) => {
    setEditId(c.id);
    setCreditDraft(String(c.creditLimit ?? 0));
    setError('');
    setMenuId(null);
  };

  return (
    <div className={`cli-page ${selected ? 'has-selection' : ''}`}>
      <PageHead
        eyebrow="Cartera comercial"
        title="Clientes"
        desc="Puntos de entrega, contactos y crédito de cada cliente."
        actions={
          <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>
            Nuevo cliente
          </Btn>
        }
      />

      <div className="cli-toolbar">
        <div className="cli-search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, RUC o contacto…"
            aria-label="Buscar clientes"
          />
        </div>
        <label className="cli-select">
          <span>Sector</span>
          <Select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="all">Todos</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <label className="cli-select">
          <span>Crédito</span>
          <Select
            value={creditFilter}
            onChange={(e) => setCreditFilter(e.target.value as CreditFilter)}
          >
            <option value="all">Todos</option>
            <option value="ok">Con holgura</option>
            <option value="tight">Cerca del límite</option>
            <option value="full">Cupo alto</option>
          </Select>
        </label>
        <div className="cli-view-toggle" role="group" aria-label="Vista">
          <button
            type="button"
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            Lista
          </button>
          <button
            type="button"
            className={view === 'cards' ? 'active' : ''}
            onClick={() => setView('cards')}
          >
            Tarjetas
          </button>
        </div>
      </div>

      <div className="cli-workspace">
        <section className="cli-directory panel">
          <div className="cli-directory-head">
            <h2>
              Directorio de clientes <em>{rows.length}</em>
            </h2>
            <label className="cli-sort">
              Ordenar
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                <option value="name">Nombre</option>
                <option value="orders">Pedidos</option>
                <option value="credit">Cupo disponible</option>
              </Select>
            </label>
          </div>

          {view === 'list' ? (
            rows.length ? (
              <div className="cli-table-scroll">
                <table className="cli-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th className="cli-num">Pedidos</th>
                      <th>Cupo disponible</th>
                      <th className="cli-actions-col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ client: c, orders, limit, available }) => (
                      <tr
                        key={c.id}
                        className={selected?.client.id === c.id ? 'is-selected' : ''}
                        onClick={() => {
                          setSelectedId(c.id);
                          setTab('resumen');
                        }}
                      >
                        <td>
                          <div className="cli-cell-client">
                            <span className="cli-avatar">{initials(c.name)}</span>
                            <span>
                              <strong>{c.name}</strong>
                              <small>
                                {c.taxId ? `${c.taxId} · ` : ''}
                                {c.type}
                                {c.contact ? ` · ${c.contact}` : ''}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td className="cli-num">{orders.length}</td>
                        <td>
                          <div className="cli-cupo">
                            <strong className={available <= 0 ? 'is-tight' : ''}>
                              {money(available)}
                            </strong>
                            <small>de {money(limit)}</small>
                          </div>
                        </td>
                        <td className="cli-actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="cli-row-actions">
                            <Btn
                              variant="small"
                              icon="plus"
                              onClick={() =>
                                navigate('/pedidos/nuevo', { state: { clientId: c.id } })
                              }
                            >
                              Pedido
                            </Btn>
                            <div className="cli-more-wrap">
                              <button
                                type="button"
                                className="cli-more-btn"
                                aria-label={`Más acciones de ${c.name}`}
                                onClick={() => setMenuId(menuId === c.id ? null : c.id)}
                              >
                                <span />
                                <span />
                                <span />
                              </button>
                              {menuId === c.id ? (
                                <div className="cli-more-menu" role="menu">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setSelectedId(c.id);
                                      setTab('resumen');
                                      setMenuId(null);
                                    }}
                                  >
                                    Ver ficha
                                  </button>
                                  {isAdmin ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => openCredit(c)}
                                    >
                                      Editar crédito
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="cli-empty">No hay clientes con estos filtros.</div>
            )
          ) : (
            <div className="cli-cards">
              {pageRows.map(({ client: c, orders, limit, used, available, pct }) => (
                <button
                  type="button"
                  key={c.id}
                  className={`cli-card ${selected?.client.id === c.id ? 'is-selected' : ''}`}
                  onClick={() => {
                    setSelectedId(c.id);
                    setTab('resumen');
                  }}
                >
                  <div className="cli-card-head">
                    <span className="cli-avatar">{initials(c.name)}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <Badge text={c.type} color="blue" />
                    </div>
                  </div>
                  <p>{c.contact}</p>
                  <div className="cli-cupo">
                    <strong>{money(available)}</strong>
                    <small>
                      de {money(limit)} · usado {money(used)} ({pct}%)
                    </small>
                  </div>
                  <span className="cli-card-foot">
                    {orders.length} pedidos ·{' '}
                    {money(orders.reduce((n, o) => n + orderValue(state, o), 0))}
                  </span>
                </button>
              ))}
              {!pageRows.length ? (
                <div className="cli-empty">No hay clientes con estos filtros.</div>
              ) : null}
            </div>
          )}

          {rows.length ? (
            <div className="cli-pagination" aria-label="Paginación de clientes">
              <span>
                Mostrando {rangeFrom}–{rangeTo} de {rows.length}
              </span>
              <div>
                <button
                  type="button"
                  disabled={safePage <= 1}
                  aria-label="Página anterior"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <Icon name="back" />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === safePage ? 'is-active' : ''}
                    aria-current={n === safePage ? 'page' : undefined}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={safePage >= pageCount}
                  aria-label="Página siguiente"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {selected ? (
          <aside className="cli-detail panel" aria-label="Ficha del cliente">
            <header className="cli-detail-head">
              <span className="cli-avatar lg">{initials(selected.client.name)}</span>
              <div>
                <h2>{selected.client.name}</h2>
                <Badge text={selected.client.type} color="blue" />
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Cerrar ficha"
                onClick={() => setSelectedId(null)}
              >
                <Icon name="close" />
              </button>
            </header>

            <div className="cli-tabs" role="tablist">
              {(
                [
                  ['resumen', 'Resumen'],
                  ['pedidos', 'Pedidos'],
                  ['cuenta', 'Estado de cuenta'],
                  ['credito', 'Crédito'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={tab === id ? 'active' : ''}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'resumen' ? (
              <div className="cli-detail-body">
                <dl className="cli-info">
                  <div>
                    <dt>RUC</dt>
                    <dd>{selected.client.taxId || 'Sin RUC'}</dd>
                  </div>
                  <div>
                    <dt>Contacto</dt>
                    <dd>{selected.client.contact}</dd>
                  </div>
                  <div>
                    <dt>Correo</dt>
                    <dd>{selected.client.email}</dd>
                  </div>
                  <div>
                    <dt>Teléfono</dt>
                    <dd>{selected.client.phone || 'Sin teléfono'}</dd>
                  </div>
                  <div>
                    <dt>Ciudad</dt>
                    <dd>{selected.client.city || 'Sin ciudad'}</dd>
                  </div>
                  <div>
                    <dt>Dirección</dt>
                    <dd>{selected.client.address}</dd>
                  </div>
                  <div>
                    <dt>Plazo</dt>
                    <dd>{selected.client.paymentTermsDays ?? 30} días</dd>
                  </div>
                  <div>
                    <dt>Reposición</dt>
                    <dd>{selected.client.reorderEveryDays ? `cada ${selected.client.reorderEveryDays} días` : 'Sin cadencia'}</dd>
                  </div>
                  <div>
                    <dt>Por cobrar</dt>
                    <dd>{money(outstandingReceivable(state, selected.client.id))}</dd>
                  </div>
                </dl>

                <div className="cli-credit-box">
                  <div className="cli-credit-box-head">
                    <strong>Cupo de crédito</strong>
                    {isAdmin ? (
<button type="button" onClick={() => openCredit(selected.client)}>
                      Editar
                    </button>
) : null}
                  </div>
                  <div className="cli-credit-stats">
                    <div>
                      <span>Límite</span>
                      <strong>{money(selected.limit)}</strong>
                    </div>
                    <div>
                      <span>Comprometido</span>
                      <strong>{money(selected.used)}</strong>
                    </div>
                    <div>
                      <span>Disponible</span>
                      <strong className="is-ok">{money(selected.available)}</strong>
                    </div>
                  </div>
                  <div className="cli-credit-bar">
                    <span style={{ width: `${selected.pct}%` }} />
                  </div>
                  <button type="button" className="cli-text-link" onClick={() => setTab('pedidos')}>
                    Ver pedidos que usan el cupo
                  </button>
                </div>

                <div className="cli-orders-summary">
                  <strong>{selected.orders.length} pedidos</strong>
                  <span>
                    {money(selected.orders.reduce((n, o) => n + orderValue(state, o), 0))}
                  </span>
                </div>
              </div>
            ) : null}

            {tab === 'cuenta' ? (
              <div className="cli-detail-body">
                <div className="cli-orders-summary">
                  <strong>Saldo por cobrar</strong>
                  <span>{money(outstandingReceivable(state, selected.client.id))}</span>
                </div>
                <ul className="cli-order-list">
                  {(state.invoices ?? [])
                    .filter((invoice) => invoice.clientId === selected.client.id && invoice.status === 'Emitida')
                    .map((invoice) => (
                      <li key={invoice.id}>
                        <div>
                          <strong>{invoice.number}</strong>
                          <small>
                            {invoice.date} · {invoice.orderId}
                          </small>
                        </div>
                        <div className="cli-order-meta">
                          <span>{money(invoice.total)}</span>
                          <small>saldo {money(invoiceBalance(state, invoice.id))}</small>
                        </div>
                      </li>
                    ))}
                  {(state.creditNotes ?? [])
                    .filter((note) => note.clientId === selected.client.id && note.status === 'Emitida')
                    .map((note) => (
                      <li key={note.id}>
                        <div>
                          <strong>{note.number}</strong>
                          <small>{note.date} · nota de crédito</small>
                        </div>
                        <span>-{money(note.total)}</span>
                      </li>
                    ))}
                  {(state.customerPayments ?? [])
                    .filter((payment) => payment.clientId === selected.client.id)
                    .map((payment) => (
                      <li key={payment.id}>
                        <div>
                          <strong>{payment.reference}</strong>
                          <small>
                            {payment.date} · {payment.method}
                          </small>
                        </div>
                        <span>-{money(payment.amount)}</span>
                      </li>
                    ))}
                </ul>
                {(state.invoices ?? []).some((invoice) => invoice.clientId === selected.client.id) ? null : (
                  <p className="cli-credit-note">Todavía no hay facturas para este cliente.</p>
                )}
              </div>
            ) : null}

            {tab === 'pedidos' ? (
              <div className="cli-detail-body">
                {selected.orders.length ? (
                  <ul className="cli-order-list">
                    {selected.orders
                      .slice()
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((o) => (
                        <li key={o.id}>
                          <div>
                            <strong>{o.id}</strong>
                            <small>
                              {o.date} · {o.status}
                            </small>
                          </div>
                          <div className="cli-order-meta">
                            <Badge text={o.status} color={statusColor(o.status)} />
                            <em>{money(orderValue(state, o))}</em>
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="cli-empty">Sin pedidos registrados.</p>
                )}
              </div>
            ) : null}

            {tab === 'credito' ? (
              <div className="cli-detail-body">
                <div className="cli-credit-box">
                  <div className="cli-credit-stats">
                    <div>
                      <span>Límite</span>
                      <strong>{money(selected.limit)}</strong>
                    </div>
                    <div>
                      <span>Comprometido</span>
                      <strong>{money(selected.used)}</strong>
                    </div>
                    <div>
                      <span>Disponible</span>
                      <strong className="is-ok">{money(selected.available)}</strong>
                    </div>
                  </div>
                  <div className="cli-credit-bar">
                    <span
                      style={{ width: `${selected.pct}%` }}
                      className={
                        selected.pct >= rules.creditTightMaxPct
                          ? 'is-red'
                          : selected.pct >= rules.creditOkMaxPct
                            ? 'is-amber'
                            : ''
                      }
                    />
                  </div>
                  <p className="cli-credit-note">
                    El cupo comprometido corresponde a pedidos abiertos (por preparar, en ruta,
                    etc.).
                  </p>
                  <Btn variant="primary" disabled={!isAdmin} onClick={() => openCredit(selected.client)}>
                    Ajustar límite
                  </Btn>
                </div>
              </div>
            ) : null}

            <footer className="cli-detail-foot">
              <Btn
                variant="primary"
                icon="plus"
                onClick={() =>
                  navigate('/pedidos/nuevo', { state: { clientId: selected.client.id } })
                }
              >
                Crear pedido
              </Btn>
              <button
                type="button"
                className="cli-text-link"
                onClick={() => {
                  setProfileId(selected.client.id);
                  setError('');
                }}
              >
                Editar cliente
              </button>
            </footer>
          </aside>
        ) : null}
      </div>

      {open ? (
        <Modal
          title="Nuevo cliente"
          subtitle="Datos de contacto, entrega y crédito."
          onClose={() => setOpen(false)}
          footer={
            <ModalActions
              onCancel={() => setOpen(false)}
              submitLabel="Guardar"
              formId="client-form"
              icon="save"
            />
          }
        >
          <form id="client-form" onSubmit={submit}>
            <ClientFields idPrefix="cl" isAdmin={isAdmin} creditDefault={rules.defaultCreditLimit} />
            {!isAdmin ? <small>El cupo y el plazo los asigna administración.</small> : null}
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}

      {profiling ? (
        <Modal
          title={`Editar · ${profiling.name}`}
          subtitle="RUC, entrega, contacto y, si eres administración, cupo y plazo."
          onClose={() => setProfileId(null)}
          footer={
            <ModalActions
              onCancel={() => setProfileId(null)}
              submitLabel={busy ? 'Guardando…' : 'Guardar'}
              formId="client-edit-form"
              icon="save"
            />
          }
        >
          <form id="client-edit-form" onSubmit={(event) => void saveProfile(event)}>
            <ClientFields key={profiling.id} idPrefix="edit" client={profiling} isAdmin={isAdmin} />
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal
          title={`Crédito · ${editing.name}`}
          subtitle="Define el límite autorizado para pedidos abiertos."
          onClose={() => setEditId(null)}
          footer={
            <>
              <Btn onClick={() => setEditId(null)}>Cancelar</Btn>
              <Btn variant="primary" disabled={busy} onClick={() => void saveCredit()}>
                {busy ? 'Guardando…' : 'Guardar límite'}
              </Btn>
            </>
          }
        >
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="edit-credit">Límite de crédito (USD)</label>
              <input
                id="edit-credit"
                type="number"
                min={0}
                step={50}
                value={creditDraft}
                onChange={(e) => setCreditDraft(e.target.value)}
              />
            </div>
            <p className="subtle" style={{ gridColumn: '1 / -1', margin: 0 }}>
              Usado actual: {money(creditUsed(state, editing.id))} · Disponible con este límite:{' '}
              {money(Math.max(0, Number(creditDraft || 0) - creditUsed(state, editing.id)))}
            </p>
          </div>
          {error ? <div className="form-error visible">{error}</div> : null}
        </Modal>
      ) : null}
    </div>
  );
}
