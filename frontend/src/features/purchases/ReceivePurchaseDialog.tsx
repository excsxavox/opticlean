import { useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api/client';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { product, todayEc } from '../../shared/lib/inventory';
import { purchaseLines } from '../../shared/lib/wholesale';
import { Modal } from '../../shared/components/Modal';
import { Btn } from '../../shared/components/ui';
import type { AppState, Purchase } from '../../shared/types';

type Row = {
  productId: string;
  pending: number;
  qty: number;
  batch: string;
  expiry: string;
  loc: string;
  inspect: boolean;
  options: string[];
};

/** Recibe todas las líneas pendientes de una orden de compra en un solo paso. */
export function ReceivePurchaseDialog({ state, purchase, onClose }: { state: AppState; purchase: Purchase; onClose: () => void }) {
  const { applyResponse, toast } = useAppState();
  const supplier = state.suppliers?.find((item) => item.id === purchase.supplierId);
  const pendingLines = useMemo(
    () =>
      purchaseLines(purchase)
        .map((line) => ({ productId: line.productId, pending: line.qty * line.unitsPerPack - (line.receivedUnits ?? 0) }))
        .filter((line) => line.pending > 0),
    [purchase],
  );
  const [rows, setRows] = useState<Row[]>(() =>
    pendingLines.map((line) => ({
      ...line,
      qty: line.pending,
      batch: '',
      expiry: '',
      loc: '',
      inspect: !!product(state, line.productId)?.inspectOnReceipt,
      options: [],
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Sugerencia de ubicación por línea; evita repetir la misma casilla entre líneas.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const used = new Set<string>();
      const next: Row[] = [];
      for (const row of rows) {
        try {
          const res = await api.placement(row.productId, Math.max(1, row.qty));
          const options = res.options.map((option) => option.id);
          const pick = options.find((id) => !used.has(id)) ?? '';
          if (pick) used.add(pick);
          next.push({ ...row, options, loc: row.loc || pick });
        } catch {
          next.push(row);
        }
      }
      if (!cancelled) setRows(next);
    })();
    return () => {
      cancelled = true;
    };
    // Solo al abrir: las cantidades editadas no recalculan la sugerencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (index: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const receiving = rows.filter((row) => row.qty > 0);
  const totalNow = receiving.reduce((n, row) => n + row.qty, 0);
  const totalPending = rows.reduce((n, row) => n + row.pending, 0);
  const today = todayEc();

  const submit = async () => {
    setError('');
    for (const row of receiving) {
      const name = product(state, row.productId)?.name ?? row.productId;
      if (!Number.isInteger(row.qty) || row.qty > row.pending) return setError(`${name}: la cantidad no puede superar lo pendiente (${row.pending}).`);
      if (!row.batch.trim()) return setError(`${name}: falta el lote.`);
      const expires = product(state, row.productId)?.perishable !== false;
      if (expires && (!row.expiry || row.expiry < today)) return setError(`${name}: el vencimiento debe ser una fecha futura.`);
      if (!expires && row.expiry && row.expiry < today) return setError(`${name}: el vencimiento no puede estar en el pasado.`);
      if (!row.loc) return setError(`${name}: elige la ubicación.`);
    }
    if (!receiving.length) return setError('Indica al menos una cantidad recibida.');
    setBusy(true);
    try {
      applyResponse(
        await api.receivePurchase(
          purchase.id,
          receiving.map(({ productId, qty, loc, batch, expiry, inspect }) => ({ productId, qty, loc, batch: batch.trim(), expiry, inspect })),
        ),
      );
      toast(`Recepción de ${purchase.id} registrada: ${totalNow} u. en ${receiving.length} línea(s).`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la recepción.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={`Recibir ${purchase.id}`}
      subtitle={`${supplier?.name ?? 'Sin proveedor'} · ${totalPending} u. pendientes en ${rows.length} línea(s)`}
      onClose={onClose}
      footer={
        <>
          <span className="fx-muted" style={{ marginRight: 'auto' }}>
            {totalNow >= totalPending ? 'La orden quedará Recibida.' : `La orden quedará Parcial · ${totalNow} de ${totalPending} u.`}
          </span>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="check" disabled={busy} onClick={() => void submit()}>
            Confirmar recepción
          </Btn>
        </>
      }
    >
      <div className="fx-dialog" style={{ boxShadow: 'none', border: 0, width: '100%' }}>
        <div className="fx-body" style={{ padding: 0 }}>
          <div className="fx-table-wrap">
            <table className="fx-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Pend.</th>
                  <th className="num">Llegó</th>
                  <th>Lote</th>
                  <th>Vence</th>
                  <th>Ubicación</th>
                  <th>Inspección</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const name = product(state, row.productId)?.name ?? row.productId;
                  return (
                    <tr key={row.productId}>
                      <td>
                        <strong>{name}</strong>
                        <div className="fx-muted">{row.productId}</div>
                      </td>
                      <td className="num">{row.pending}</td>
                      <td className="num">
                        <input
                          id={`rp-qty-${i}`}
                          className="fx-qty"
                          type="number"
                          min={0}
                          max={row.pending}
                          value={row.qty}
                          aria-label={`Cantidad recibida de ${name}`}
                          onChange={(e) => update(i, { qty: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        />
                      </td>
                      <td>
                        <input
                          id={`rp-batch-${i}`}
                          className="fx-batch"
                          value={row.batch}
                          placeholder="Lote"
                          aria-label={`Lote de ${name}`}
                          onChange={(e) => update(i, { batch: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          id={`rp-exp-${i}`}
                          type="date"
                          min={today}
                          value={row.expiry}
                          aria-label={
                            product(state, row.productId)?.perishable === false
                              ? `Vencimiento de ${name}, opcional porque no caduca`
                              : `Vencimiento de ${name}`
                          }
                          onChange={(e) => update(i, { expiry: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          id={`rp-loc-${i}`}
                          value={row.loc}
                          aria-label={`Ubicación de ${name}`}
                          onChange={(e) => update(i, { loc: e.target.value })}
                        >
                          <option value="">{row.options.length ? 'Elegir…' : 'Sin ubicación compatible'}</option>
                          {row.options.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            id={`rp-insp-${i}`}
                            type="checkbox"
                            checked={row.inspect}
                            onChange={(e) => update(i, { inspect: e.target.checked })}
                          />
                          Retener
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="fx-muted" style={{ margin: 0 }}>
            Deja en 0 lo que no llegó. Lo retenido queda en inspección y no se vende hasta liberarlo.
          </p>
          {error ? <div className="fx-error">{error}</div> : null}
        </div>
      </div>
    </Modal>
  );
}
