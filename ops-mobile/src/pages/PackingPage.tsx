import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { QrScanner } from '../components/QrScanner';
import { clientName } from '../lib/inventory';
import type { AppState, Order, Parcel } from '../types';

/** Debe coincidir con backend/src/domain/packing.service.ts (el servidor es quien valida). */
const DEFAULT_BOXES = [
  { code: 'S', label: 'Caja S', dims: { l: 40, w: 30, h: 30 }, tareKg: 0.4 },
  { code: 'M', label: 'Caja M', dims: { l: 60, w: 40, h: 40 }, tareKg: 0.4 },
  { code: 'G', label: 'Caja G', dims: { l: 80, w: 60, h: 50 }, tareKg: 0.4 },
];

const keyOf = (productId: string, batch: string | undefined) => `${productId}|${batch ?? ''}`;

function pickLines(order: Order) {
  const map = new Map<string, { key: string; productId: string; batch: string; loc: string; qty: number }>();
  for (const pick of order.picks ?? []) {
    const key = keyOf(pick.productId, pick.batch);
    const current = map.get(key);
    if (current) current.qty += pick.qty;
    else map.set(key, { key, productId: pick.productId, batch: pick.batch ?? '', loc: pick.loc ?? '', qty: pick.qty });
  }
  return [...map.values()];
}

const packedQty = (parcels: Parcel[], key: string) =>
  parcels.reduce(
    (sum, parcel) =>
      sum + (parcel.contents ?? []).reduce((n, l) => n + (keyOf(l.productId, l.batch) === key ? l.qty : 0), 0),
    0,
  );

type Props = { state: AppState; onRefresh: () => Promise<void> };

export function PackingPage({ state, onRefresh }: Props) {
  const [current, setCurrent] = useState<AppState>(state);
  const [selectedId, setSelectedId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [boxCode, setBoxCode] = useState('');
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setCurrent(state), [state]);

  const orders = current.orders.filter((o) => o.status === 'Preparado' && !o.id.startsWith('PED-H'));
  const order = orders.find((o) => o.id === selectedId);

  const run = useCallback(
    async (action: () => Promise<{ state: AppState; scanned?: string }>, success?: string) => {
      setBusy(true);
      setError('');
      setMessage('');
      try {
        const res = await action();
        setCurrent(res.state);
        setMessage(res.scanned ? `+1 ${res.scanned}` : (success ?? ''));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const orderId = order?.id ?? '';
  const scan = useCallback(
    (value: string) => {
      setCamera(false);
      setCode('');
      if (orderId && value.trim()) void run(() => api.scanUnit(orderId, value.trim()));
    },
    [orderId, run],
  );

  const back = () => {
    setSelectedId('');
    setActiveId('');
    setError('');
    setMessage('');
    void onRefresh();
  };

  if (!order) {
    return (
      <div className="page">
        <header className="page-head">
          <div className="eyebrow">Operación</div>
          <h1>Empaque</h1>
          <p>Escanea lo preparado, arma los bultos y ciérralos.</p>
        </header>
        <section className="panel">
          {orders.length ? (
            <ul className="data-list">
              {[...orders]
                .sort((a, b) => Number(!!a.packing) - Number(!!b.packing) || a.id.localeCompare(b.id))
                .map((o) => (
                  <li key={o.id}>
                    <button type="button" className="list-btn" onClick={() => setSelectedId(o.id)}>
                      <div>
                        <strong>{o.id}</strong>
                        <span>{clientName(current, o.clientId)}</span>
                        <small>
                          {pickLines(o).reduce((n, l) => n + l.qty, 0)} unidades
                          {o.priority === 'Alta' ? ' · Prioridad alta' : ''}
                        </small>
                      </div>
                      <em className={`badge ${o.packing ? 'green' : 'amber'}`}>
                        {o.stagedPlate ? `En ${o.stagedPlate}` : o.packing ? 'Empacado' : 'Por empacar'}
                      </em>
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="subtle pkm-pad">No hay pedidos preparados.</p>
          )}
        </section>
      </div>
    );
  }

  const parcels = (current.parcels ?? []).filter((p) => p.orderId === order.id);
  const closed = Boolean(order.packing);
  const lines = pickLines(order);
  const verifiedOf = (line: { key: string; qty: number }) =>
    closed ? line.qty : Math.min(line.qty, Math.max(order.packCounts?.[line.key] ?? 0, packedQty(parcels, line.key)));
  const active = parcels.find((p) => p.id === activeId) ?? parcels.at(-1);
  const boxes = current.settings.packingBoxes?.length ? current.settings.packingBoxes : DEFAULT_BOXES;
  const chosenBox = boxes.some((b) => b.code === boxCode) ? boxCode : boxes[Math.floor((boxes.length - 1) / 2)].code;
  const nameOf = (id: string) => current.products.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="page">
      <header className="topbar-inline">
        <button type="button" className="icon-btn" onClick={back} aria-label="Volver">
          <Icon name="back" />
        </button>
        <div>
          <div className="eyebrow">Empaque</div>
          <strong>{order.id}</strong>
        </div>
        <em className={`badge ${closed ? 'green' : 'amber'}`}>{closed ? 'Empacado' : 'Por empacar'}</em>
      </header>
      <p className="meta-line">{clientName(current, order.clientId)}</p>

      {closed ? null : (
        <form
          className="pkm-scan"
          onSubmit={(event) => {
            event.preventDefault();
            scan(code);
          }}
        >
          <button type="button" className="btn primary full" disabled={busy} onClick={() => setCamera(true)}>
            <Icon name="scan" /> Escanear con la cámara
          </button>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Lector o código + Enter"
            aria-label="Código de barras o SKU"
            autoComplete="off"
            enterKeyHint="done"
          />
        </form>
      )}
      {camera ? <QrScanner onClose={() => setCamera(false)} onDetect={scan} /> : null}

      <p className="dsp-msg" role="status" hidden={!message}>
        {message}
      </p>
      {error ? (
        <p className="login-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="panel">
        <ul className="data-list">
          {lines.map((line) => {
            const done = verifiedOf(line);
            const inside = packedQty(parcels, line.key);
            return (
              <li key={line.key} className="pkm-line">
                <div>
                  <strong>{nameOf(line.productId)}</strong>
                  <small>
                    Lote {line.batch || 's/l'}
                    {line.loc ? ` · ${line.loc}` : ''} · contado {done}/{line.qty} · en bulto {inside}/{line.qty}
                  </small>
                </div>
                <div className="pkm-actions">
                  {!closed && done < line.qty ? (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api.countUnits(order.id, { productId: line.productId, batch: line.batch, qty: done + 1 }),
                        )
                      }
                    >
                      +1
                    </button>
                  ) : null}
                  {!closed && done > inside && active ? (
                    <button
                      type="button"
                      className="btn primary small"
                      disabled={busy}
                      onClick={() => {
                        const contents = active.contents ?? [];
                        const add = done - inside;
                        const next = contents.some((c) => keyOf(c.productId, c.batch) === line.key)
                          ? contents.map((c) =>
                              keyOf(c.productId, c.batch) === line.key ? { ...c, qty: c.qty + add } : c,
                            )
                          : [...contents, { productId: line.productId, batch: line.batch, qty: add }];
                        void run(() => api.editParcel(active.id, { contents: next }));
                      }}
                    >
                      Meter {done - inside} en bulto {parcels.indexOf(active) + 1}
                    </button>
                  ) : null}
                  {inside >= line.qty ? <em className="badge green">Listo</em> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {parcels.map((parcel, index) => (
        <ParcelBlock
          key={parcel.id}
          parcel={parcel}
          index={index}
          closed={closed}
          active={parcel.id === active?.id}
          busy={busy}
          nameOf={nameOf}
          onActivate={() => setActiveId(parcel.id)}
          onWeight={(weightKg) => void run(() => api.editParcel(parcel.id, { weightKg }), 'Peso guardado.')}
          onNote={(weightNote) => void run(() => api.editParcel(parcel.id, { weightNote }), 'Motivo guardado.')}
          onRemove={() => void run(() => api.removeParcel(parcel.id), 'Bulto eliminado.')}
        />
      ))}

      {closed ? (
        order.stagedPlate ? (
          <p className="subtle">Cargado en {order.stagedPlate}.</p>
        ) : (
          <button
            type="button"
            className="btn full"
            disabled={busy}
            onClick={() => void run(() => api.reopenPacking(order.id), 'Empaque reabierto.')}
          >
            Reabrir empaque
          </button>
        )
      ) : (
        <div className="pkm-foot">
          <select value={chosenBox} onChange={(e) => setBoxCode(e.target.value)} aria-label="Tipo de caja">
            {boxes.map((box) => (
              <option key={box.code} value={box.code}>
                {box.label} · {box.dims.l}×{box.dims.w}×{box.dims.h} cm
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn full"
            disabled={busy}
            onClick={() => {
              setActiveId('');
              void run(() => api.addParcel({ orderId: order.id, boxCode: chosenBox }));
            }}
          >
            <Icon name="plus" /> Nuevo bulto
          </button>
          <button
            type="button"
            className="btn primary full"
            disabled={busy || !parcels.length}
            onClick={() => void run(() => api.closePacking(order.id), 'Empaque cerrado.')}
          >
            <Icon name="check" /> Cerrar empaque
          </button>
        </div>
      )}
    </div>
  );
}

function ParcelBlock({
  parcel,
  index,
  closed,
  active,
  busy,
  nameOf,
  onActivate,
  onWeight,
  onNote,
  onRemove,
}: {
  parcel: Parcel;
  index: number;
  closed: boolean;
  active: boolean;
  busy: boolean;
  nameOf: (id: string) => string;
  onActivate: () => void;
  onWeight: (kg: number) => void;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const [weight, setWeight] = useState(parcel.weightKg ? String(parcel.weightKg) : '');
  const [note, setNote] = useState(parcel.weightNote ?? '');
  useEffect(() => setWeight(parcel.weightKg ? String(parcel.weightKg) : ''), [parcel.weightKg]);
  useEffect(() => setNote(parcel.weightNote ?? ''), [parcel.weightNote]);

  return (
    <section className={`panel pkm-parcel${active && !closed ? ' is-active' : ''}`}>
      <strong>
        Bulto {index + 1} · {parcel.id}
      </strong>
      <ul>
        {(parcel.contents ?? []).map((line) => (
          <li key={keyOf(line.productId, line.batch)}>
            {line.qty} × {nameOf(line.productId)}
          </li>
        ))}
        {parcel.contents?.length ? null : <li>Vacío</li>}
      </ul>
      <label className="field">
        <span>Peso real (kg)</span>
        <input
          inputMode="decimal"
          value={weight}
          disabled={closed}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={() => {
            const value = Number(weight.replace(',', '.'));
            if (weight.trim() && Number.isFinite(value) && value !== parcel.weightKg) onWeight(value);
          }}
        />
      </label>
      {closed ? null : (
        <>
          <label className="field">
            <span>Motivo (solo si el peso no coincide)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note.trim() !== (parcel.weightNote ?? '')) onNote(note);
              }}
            />
          </label>
          <div className="pkm-actions">
            <button type="button" className="btn small" disabled={active} onClick={onActivate}>
              {active ? 'En uso' : 'Usar este'}
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={onRemove}>
              Quitar
            </button>
          </div>
        </>
      )}
    </section>
  );
}
