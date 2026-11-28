import { useState } from 'react';
import { Badge, Btn, Empty } from '../../shared/components/ui';
import { SearchInput } from '../../shared/components/SearchInput';
import { api, downloadPackingDocument } from '../../shared/api/client';
import { Input } from '../../shared/components/Input';
import { client, product } from '../../shared/lib/inventory';
import type { AppState, Order } from '../../shared/types';
import { ParcelCard } from './ParcelCard';
import {
  defaultBoxCode,
  HAZARD_TEXT,
  keyOf,
  kg,
  m3,
  packedQty,
  packingProblems,
  packStatus,
  parcelsOf,
  pickLines,
  unitsOf,
  type PickLine,
} from './packingModel';
import type { RunAction } from './PackingPage';

type Props = {
  state: AppState;
  orders: Order[];
  run: RunAction;
  busy: boolean;
  toast: (message: string) => void;
};

export function PackStation({ state, orders, run, busy, toast }: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [code, setCode] = useState('');
  const [lastScan, setLastScan] = useState('');

  const needle = query.trim().toLowerCase();
  const queue = orders
    .map((order) => ({ order, buyer: client(state, order.clientId) }))
    .filter(
      ({ order, buyer }) =>
        !needle ||
        [order.id, buyer?.name ?? '', buyer?.city ?? ''].some((v) => v.toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(!!a.order.packing) - Number(!!b.order.packing) ||
        Number(a.order.priority !== 'Alta') - Number(b.order.priority !== 'Alta') ||
        (a.buyer?.city ?? '').localeCompare(b.buyer?.city ?? '', 'es') ||
        a.order.id.localeCompare(b.order.id),
    );
  const order = orders.find((item) => item.id === selectedId) ?? queue[0]?.order;

  if (!orders.length) {
    return <Empty title="Nada preparado" desc="El empaque empieza cuando el pedido ya tiene lote de salida." />;
  }

  return (
    <div className="pk-split">
      <aside className="pk-queue" aria-label="Pedidos por empacar">
        <SearchInput
          aria-label="Buscar pedido por número, cliente o ciudad"
          placeholder="Pedido, cliente o ciudad…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
        />
        <ul>
          {queue.map(({ order: item, buyer }) => {
            const status = packStatus(state, item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === order?.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setActiveId('');
                    setLastScan('');
                  }}
                >
                  <span className="pk-queue-top">
                    <strong>{item.id}</strong>
                    <Badge text={status.label} color={status.tone} />
                  </span>
                  <span>{buyer?.name ?? item.clientId}</span>
                  <small>
                    {buyer?.city ?? 'Sin ciudad'} · {unitsOf(item)} u.
                    {item.priority === 'Alta' ? <b> · Prioridad alta</b> : null}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
        {queue.length ? null : <p className="pk-muted">Sin resultados.</p>}
      </aside>

      {order ? renderOrder(order) : null}
    </div>
  );

  function renderOrder(current: Order) {
    const buyer = client(state, current.clientId);
    const parcels = parcelsOf(state, current.id);
    const lines = pickLines(current);
    const closed = Boolean(current.packing);
    const status = packStatus(state, current);
    const active = parcels.find((p) => p.id === activeId) ?? parcels.at(-1);
    const activeNumber = active ? parcels.indexOf(active) + 1 : 0;
    // Lo que ya está en un bulto cuenta como verificado.
    const verifiedOf = (line: PickLine) =>
      closed
        ? line.qty
        : Math.min(line.qty, Math.max(current.packCounts?.[line.key] ?? 0, packedQty(parcels, line.key)));
    const count = (line: PickLine, qty: number) =>
      void run(() => api.countUnits(current.id, { productId: line.productId, batch: line.batch, qty }));
    const scan = () => {
      const value = code.trim();
      if (!value) return;
      setCode('');
      setSelectedId(current.id);
      // El campo queda listo para la siguiente lectura de la pistola.
      void run(async () => {
        const res = await api.scanUnit(current.id, value);
        setLastScan(`+1 ${res.scanned}`);
        return res;
      }).then((ok) => {
        if (!ok) setLastScan('');
      });
    };
    const download = (kind: 'labels' | 'list') =>
      void downloadPackingDocument(current.id, kind).catch((err) =>
        toast(err instanceof Error ? err.message : 'No se pudo descargar.'),
      );
    const total = unitsOf(current);
    const verified = lines.reduce((n, line) => n + verifiedOf(line), 0);
    const problems = closed ? [] : packingProblems(state, current);
    const parcelKg = parcels.reduce((n, p) => n + p.weightKg, 0);
    const parcelM3 = parcels.reduce((n, p) => n + p.volumeM3, 0);

    const putInParcel = (line: PickLine) => {
      if (!active) return;
      const pending = verifiedOf(line) - packedQty(parcels, line.key);
      const contents = active.contents ?? [];
      const exists = contents.some((c) => keyOf(c.productId, c.batch) === line.key);
      const next = exists
        ? contents.map((c) => (keyOf(c.productId, c.batch) === line.key ? { ...c, qty: c.qty + pending } : c))
        : [...contents, { productId: line.productId, batch: line.batch, qty: pending }];
      void run(() => api.editParcel(active.id, { contents: next }));
    };

    return (
      <div className="pk-work">
        <section className="panel pk-card">
          <div className="pk-card-head">
            <div>
              <h2>
                {current.id} · {buyer?.name ?? current.clientId}
              </h2>
              <p className="pk-muted">
                {[buyer?.city, buyer?.sector].filter(Boolean).join(', ') || buyer?.address}
                {current.notes ? ` · ${current.notes}` : ''}
              </p>
            </div>
            <Badge text={status.label} color={status.tone} />
          </div>

          <div className="pk-progress">
            <span>
              Verificado {verified} de {total} unidades
            </span>
            <div className="pk-bar">
              <i
                className={verified === total ? 'is-done' : undefined}
                style={{ width: `${total ? (verified / total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {closed ? null : (
            <form
              className="pk-scan"
              onSubmit={(event) => {
                event.preventDefault();
                scan();
              }}
            >
              <label className="pk-field">
                <span>Escanear (pistola o código escrito + Enter)</span>
                <Input
                  autoComplete="off"
                  placeholder="Código de barras o SKU"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <Btn type="submit" disabled={!code.trim()}>
                Contar
              </Btn>
              <span className="pk-muted" role="status">
                {lastScan}
              </span>
            </form>
          )}

          <ul className="pk-lines">
            {lines.map((line) => {
              const item = product(state, line.productId);
              const inside = packedQty(parcels, line.key);
              const done = verifiedOf(line);
              const hazard = HAZARD_TEXT[item?.hazardClass ?? 'none'];
              return (
                <li key={line.key}>
                  <div>
                    <strong>{item?.name ?? line.productId}</strong>
                    {hazard ? <Badge text={hazard} color="amber" /> : null}
                    {item?.fragile ? <Badge text="Frágil" color="purple" /> : null}
                    <small>
                      Lote {line.batch || 's/l'}
                      {line.loc ? ` · ${line.loc}` : ''} · verificado {done}/{line.qty} · en bulto{' '}
                      {inside}/{line.qty}
                    </small>
                  </div>
                  <div className="pk-line-actions">
                    {closed || inside >= line.qty ? (
                      <Badge text={closed ? 'Completo' : 'En bulto'} color="green" />
                    ) : (
                      <>
                        {done < line.qty ? (
                          <>
                            <Btn
                              size="small"
                              aria-label={`Contar una unidad de ${item?.name ?? line.productId}`}
                              disabled={busy}
                              onClick={() => count(line, done + 1)}
                            >
                              +1
                            </Btn>
                            <Btn
                              size="small"
                              disabled={busy}
                              onClick={() => count(line, line.qty)}
                            >
                              Verificar {line.qty}
                            </Btn>
                          </>
                        ) : null}
                        {done > inside ? (
                          <Btn
                            size="small"
                            variant="primary"
                            disabled={busy || !active}
                            title={active ? undefined : 'Crea un bulto primero'}
                            onClick={() => putInParcel(line)}
                          >
                            {active ? `Meter ${done - inside} en bulto ${activeNumber}` : 'Crea un bulto'}
                          </Btn>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel pk-card">
          <div className="pk-card-head">
            <h2>Bultos</h2>
            {closed ? null : (
              <Btn
                size="small"
                icon="plus"
                disabled={busy}
                onClick={() => {
                  setActiveId('');
                  void run(() => api.addParcel({ orderId: current.id, boxCode: defaultBoxCode(state) }));
                }}
              >
                Nuevo bulto
              </Btn>
            )}
          </div>

          {parcels.length ? (
            <div className="pk-parcels">
              {parcels.map((parcel, index) => (
                <ParcelCard
                  key={parcel.id}
                  state={state}
                  parcel={parcel}
                  index={index}
                  count={parcels.length}
                  closed={closed}
                  active={parcel.id === active?.id}
                  busy={busy}
                  onActivate={() => setActiveId(parcel.id)}
                  onChange={(patch) => void run(() => api.editParcel(parcel.id, patch))}
                  onRemove={() => void run(() => api.removeParcel(parcel.id), 'Bulto eliminado.')}
                />
              ))}
            </div>
          ) : (
            <p className="pk-muted">Crea el primer bulto para meter los productos verificados.</p>
          )}

          <div className="pk-foot">
            {closed ? (
              <>
                <span>
                  <b>{parcels.length}</b> bulto(s) · {kg(parcelKg)} kg · {m3(parcelM3)} m³
                  {current.packing?.closedBy ? ` · empacó ${current.packing.closedBy}` : ''}
                </span>
                <span className="pk-foot-actions">
                  <Btn icon="download" onClick={() => download('labels')}>
                    Etiquetas PDF
                  </Btn>
                  <Btn icon="download" onClick={() => download('list')}>
                    Lista de empaque PDF
                  </Btn>
                </span>
                {current.stagedPlate ? (
                  <span className="pk-muted">Cargado en {current.stagedPlate}. Retira la carga para reabrir.</span>
                ) : (
                  <Btn disabled={busy} onClick={() => void run(() => api.reopenPacking(current.id), 'Empaque reabierto.')}>
                    Reabrir empaque
                  </Btn>
                )}
              </>
            ) : (
              <>
                <span className="pk-muted">{problems[0] ?? 'Todo listo para cerrar.'}</span>
                <Btn
                  variant="primary"
                  icon="check"
                  disabled={busy || problems.length > 0}
                  onClick={() => {
                    setSelectedId(current.id);
                    void run(() => api.closePacking(current.id), `${current.id} quedó empacado.`);
                  }}
                >
                  Cerrar empaque
                </Btn>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }
}
