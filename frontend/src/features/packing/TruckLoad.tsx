import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Btn, Empty } from '../../shared/components/ui';
import { Input } from '../../shared/components/Input';
import { Select } from '../../shared/components/Select';
import { IconButton } from '../../shared/components/IconButton';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { canAccessPath } from '../../shared/auth/permissions';
import { api } from '../../shared/api/client';
import { client, money, orderLoadKg, orderLoadM3 } from '../../shared/lib/inventory';
import type { AppState, Order } from '../../shared/types';
import { isFragile, kg, m3, parcelsOf } from './packingModel';
import type { RunAction } from './PackingPage';

type Truck = { plate: string; label: string; city: string };
type Preview = Awaited<ReturnType<typeof api.previewLoad>>;

type Props = { state: AppState; orders: Order[]; run: RunAction; busy: boolean };

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const percent = (n: number) => `${(n * 100).toLocaleString('es-EC', { maximumFractionDigits: 1 })} %`;

export function TruckLoad({ state, orders, run, busy }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trucks, setTrucks] = useState<Truck[] | null>(null);
  const [fleetError, setFleetError] = useState('');
  const [chosenPlate, setChosenPlate] = useState('');
  /** Cambios sin confirmar, por placa. Cada lista va en orden de entrega. */
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .fleet()
      .then((res) => {
        if (!cancelled) setTrucks((res.trucks ?? []) as unknown as Truck[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setTrucks([]);
        setFleetError(err instanceof Error ? err.message : 'No se pudo cargar la flota.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadedPlate = orders.find((o) => o.stagedPlate)?.stagedPlate;
  const plate =
    chosenPlate || trucks?.find((t) => t.plate === loadedPlate)?.plate || trucks?.[0]?.plate || '';
  const truck = trucks?.find((t) => t.plate === plate);

  const saved = useMemo(
    () =>
      orders
        .filter((o) => o.stagedPlate === plate)
        .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
        .map((o) => o.id),
    [orders, plate],
  );
  const packed = orders.filter((o) => o.packing);
  const route = (drafts[plate] ?? saved).filter((id) =>
    packed.some((o) => o.id === id && (!o.stagedPlate || o.stagedPlate === plate)),
  );
  const dirty = !sameList(route, saved);
  const routeKey = route.join(',');
  const savedReason = orders.find((o) => o.stagedPlate === plate && o.loadNote)?.loadNote ?? '';
  const unpacked = orders.length - packed.length;

  useEffect(() => setReason(savedReason), [plate, savedReason]);

  useEffect(() => {
    if (!plate) return;
    let cancelled = false;
    api
      .previewLoad(plate, routeKey ? routeKey.split(',') : [])
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        setPreviewError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : 'No se pudo calcular la carga.');
      });
    return () => {
      cancelled = true;
    };
  }, [plate, routeKey, state.orders]);

  if (!trucks) return <p className="pk-muted">Cargando flota…</p>;
  if (!trucks.length) {
    return (
      <Empty
        title="No hay camiones activos"
        desc={fleetError || 'Agrega vehículos en la gestión de flota de Logística.'}
      />
    );
  }

  const setRoute = (next: string[]) => setDrafts((current) => ({ ...current, [plate]: next }));
  const discard = () =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[plate];
      return next;
    });
  const move = (index: number, step: number) => {
    const next = [...route];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    setRoute(next);
  };
  const orderOf = (id: string) => orders.find((o) => o.id === id)!;
  const current = preview?.plate === plate ? preview : null;
  const outOfZone = current?.outOfZone.filter((id) => route.includes(id)) ?? [];
  const needsReason = outOfZone.length > 0 && !reason.trim();
  const reasonChanged = outOfZone.length > 0 && reason.trim() !== savedReason;
  const canConfirm =
    route.length > 0 && !!current && !current.over && !needsReason && (dirty || reasonChanged);

  const bar = (label: string, detail: string, ratio: number) => (
    <div className="pk-capacity">
      <div>
        <span>{label}</span>
        <span>
          {detail} · {percent(ratio)}
        </span>
      </div>
      <div className="pk-bar pk-bar-min" style={{ ['--pk-min' as string]: `${(current?.minFill ?? 0) * 100}%` }}>
        <i className={ratio > 1 ? 'is-over' : undefined} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="pk-work">
      <section className="panel pk-card">
        <div className="pk-card-head">
          <label className="pk-truck-select">
            <strong>Camión</strong>
            <Select aria-label="Camión" value={plate} onChange={(event) => setChosenPlate(event.target.value)}>
              {trucks.map((t) => (
                <option key={t.plate} value={t.plate}>
                  {t.plate} · {t.label}
                  {t.city ? ` · ${t.city}` : ''}
                </option>
              ))}
            </Select>
          </label>
          {saved.length ? (
            <Badge text={dirty ? 'Cambios sin confirmar' : 'Carga confirmada'} color={dirty ? 'amber' : 'green'} />
          ) : null}
        </div>

        {previewError ? <div className="pk-note pk-note-bad">{previewError}</div> : null}
        {current ? (
          <>
            <div className="pk-capacities">
              {bar('Peso', `${kg(current.kg)} de ${kg(current.maxKg)} kg`, current.kgPct)}
              {bar('Volumen', `${m3(current.m3)} de ${m3(current.maxM3)} m³`, current.m3Pct)}
            </div>
            <p className="pk-muted">
              La marca es el llenado mínimo ({percent(current.minFill)}).
              {route.length ? ` Ruta estimada: ${current.trip.km} km · ${money(current.trip.cost)}.` : ''}
              {current.enRoute.length ? ` Incluye lo que ya va en ruta: ${current.enRoute.join(', ')}.` : ''}
            </p>
            {current.over ? (
              <div className="pk-note pk-note-bad" role="alert">
                La carga supera la capacidad del camión. Quita pedidos para confirmar.
              </div>
            ) : null}
            {route.length && !current.over && current.underMin ? (
              <div className="pk-note pk-note-warn">
                El camión va al {percent(current.fill)}, bajo el mínimo. Se puede confirmar.
              </div>
            ) : null}
            {outOfZone.length ? (
              <div className="pk-note pk-note-warn">
                {outOfZone.join(', ')} está fuera de la zona de {truck?.label ?? plate}. Indica el motivo para
                confirmar.
                <Input
                  aria-label="Motivo de cargar fuera de zona"
                  placeholder="Motivo"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="pk-two">
        <section className="panel pk-card">
          <h2>Pedidos empacados</h2>
          {packed.length ? (
            <ul className="pk-lines">
              {packed.map((order) => {
                const buyer = client(state, order.clientId);
                const elsewhere = order.stagedPlate && order.stagedPlate !== plate;
                const on = route.includes(order.id);
                return (
                  <li key={order.id}>
                    <div>
                      <strong>
                        {order.id} · {buyer?.name ?? order.clientId}
                      </strong>
                      <small>
                        {[buyer?.city, buyer?.sector].filter(Boolean).join(', ')} ·{' '}
                        {parcelsOf(state, order.id).length} bulto(s) · {kg(orderLoadKg(state, order))} kg ·{' '}
                        {m3(orderLoadM3(state, order))} m³
                      </small>
                    </div>
                    <div className="pk-line-actions">
                      {elsewhere ? (
                        <Badge text={`En ${order.stagedPlate}`} color="blue" />
                      ) : (
                        <Btn
                          size="small"
                          variant={on ? 'secondary' : 'primary'}
                          onClick={() =>
                            setRoute(on ? route.filter((id) => id !== order.id) : [...route, order.id])
                          }
                        >
                          {on ? 'Quitar' : 'Subir'}
                        </Btn>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="pk-muted">Todavía no hay pedidos con el empaque cerrado.</p>
          )}
          {unpacked ? <p className="pk-muted">{unpacked} pedido(s) preparado(s) siguen sin empacar.</p> : null}
        </section>

        <section className="panel pk-card">
          <h2>Ruta (orden de entrega)</h2>
          {route.length ? (
            <ol className="pk-lines">
              {route.map((id, index) => {
                const buyer = client(state, orderOf(id).clientId);
                return (
                  <li key={id}>
                    <div>
                      <strong>
                        Parada {index + 1} · {id}
                      </strong>
                      <small>
                        {buyer?.name} · {buyer?.sector || buyer?.city}
                      </small>
                    </div>
                    <div className="pk-line-actions">
                      <IconButton
                        icon="chevron"
                        size="small"
                        className="pk-up"
                        label={`Entregar antes ${id}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      />
                      <IconButton
                        icon="chevron"
                        size="small"
                        className="pk-down"
                        label={`Entregar después ${id}`}
                        disabled={index === route.length - 1}
                        onClick={() => move(index, 1)}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="pk-muted">Sube pedidos para armar la ruta.</p>
          )}
        </section>
      </div>

      <section className="panel pk-card">
        <h2>Orden de carga: la última parada entra primero</h2>
        {route.length ? (
          <ol className="pk-truck">
            <li className="pk-cab" aria-hidden>
              Cabina
            </li>
            {[...route].reverse().map((id, index) => {
              const parcels = parcelsOf(state, id);
              return (
                <li key={id} className="pk-slot">
                  <b>{index + 1}º en subir</b>
                  <span>{id}</span>
                  <small>
                    Parada {route.indexOf(id) + 1} · {parcels.length} bulto(s)
                    {parcels.some((p) => isFragile(state, p)) ? ' · frágil arriba' : ''}
                  </small>
                </li>
              );
            })}
            <li className="pk-door" aria-hidden>
              Puerta
            </li>
          </ol>
        ) : (
          <p className="pk-muted">El camión está vacío.</p>
        )}
        <div className="pk-foot">
          <span className="pk-muted">
            {dirty
              ? 'Los cambios se guardan al confirmar.'
              : saved.length
                ? 'Logística ya ve esta carga lista para despachar.'
                : 'Sin carga confirmada para este camión.'}
          </span>
          <span className="pk-foot-actions">
            {dirty ? <Btn onClick={discard}>Descartar cambios</Btn> : null}
            {saved.length ? (
              <Btn
                disabled={busy}
                onClick={() => {
                  discard();
                  void run(() => api.releaseLoad(plate), `Se retiró la carga de ${plate}.`);
                }}
              >
                Retirar carga
              </Btn>
            ) : null}
            {saved.length && !dirty && canAccessPath(user, '/logistica') ? (
              <Btn icon="truck" onClick={() => navigate('/logistica')}>
                Ir a Logística
              </Btn>
            ) : null}
            <Btn
              variant="primary"
              icon="check"
              disabled={busy || !canConfirm}
              onClick={() =>
                void run(
                  () => api.confirmLoad({ plate, orderIds: route, reason: reason.trim() || undefined }),
                  `Carga de ${plate} confirmada.`,
                ).then((ok) => {
                  if (ok) discard();
                })
              }
            >
              {saved.length ? 'Guardar cambios' : 'Confirmar carga'}
            </Btn>
          </span>
        </div>
      </section>
    </div>
  );
}
