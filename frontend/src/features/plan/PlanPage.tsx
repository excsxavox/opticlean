import { useEffect, useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import type { PlanAction } from '../../shared/types';
import { Btn, Empty, PageHead } from '../../shared/components/ui';

type Plan = Awaited<ReturnType<typeof api.plan>>;

export function PlanPage() {
  const { applyResponse, toast, state } = useAppState();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.plan().then(setPlan).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo leer el plan.'));
  };

  useEffect(load, []);
  if (!state) return null;

  const name = (id: string) => state.products.find((item) => item.id === id)?.name ?? id;

  const run = async (action: PlanAction, kind: 'approve' | 'discard' | 'undo') => {
    setBusy(true);
    setError('');
    try {
      const note = kind === 'discard' ? window.prompt('¿Por qué se descarta?', '') ?? '' : '';
      if (kind === 'discard' && note === null) return;
      const response =
        kind === 'approve' ? await api.approvePlan(action.id) : kind === 'undo' ? await api.undoPlan(action.id) : await api.discardPlan(action.id, note);
      applyResponse(response);
      toast(kind === 'approve' ? 'Acción ejecutada.' : kind === 'undo' ? 'Acción deshecha.' : 'Sugerencia descartada.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el plan.');
    } finally {
      setBusy(false);
    }
  };

  const open = plan?.actions.filter((action) => action.status === 'sugerida') ?? [];
  const done = plan?.actions.filter((action) => action.status !== 'sugerida') ?? [];

  return (
    <div className="page">
      <PageHead
        eyebrow="Abastecimiento"
        title="Plan de mañana"
        desc="Compras y traslados que el stock ya justifica. Aprobar crea la orden o el traslado; deshacer vale mientras la compra no se recibió y el traslado sigue en tránsito."
      />
      {error ? <div className="form-error visible">{error}</div> : null}
      {open.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Acción</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Por qué</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map((action) => (
                <tr key={action.id}>
                  <td>{action.kind === 'compra' ? 'Comprar' : 'Trasladar'}</td>
                  <td>{name(action.productId)}</td>
                  <td>{action.qty}{action.packCode ? ` ${action.packCode}` : ''}</td>
                  <td>{action.reason}</td>
                  <td>
                    <Btn size="small" disabled={busy} onClick={() => void run(action, 'approve')}>Aprobar</Btn>
                    <Btn size="small" disabled={busy} onClick={() => void run(action, 'discard')}>Descartar</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin sugerencias abiertas" desc="Cuando un producto baje del mínimo y tenga proveedor, aparece aquí." />
      )}

      {done.length ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Ya decididas</h2>
          <ul>
            {done.map((action) => (
              <li key={action.id}>
                {name(action.productId)} · {action.status}
                {action.purchaseId ? ` · ${action.purchaseId}` : ''}
                {action.transferId ? ` · ${action.transferId}` : ''}
                {action.note ? ` · ${action.note}` : ''}
                {action.status === 'ejecutada' ? (
                  <Btn size="small" disabled={busy} onClick={() => void run(action, 'undo')}>Deshacer</Btn>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Pronóstico por cliente</h2>
        <p>Unidades semanales de los últimos 28 días. La confianza sube con la cantidad de pedidos.</p>
        <ul>
          {(plan?.forecast ?? [])
            .filter((row) => row.orders > 0)
            .slice(0, 8)
            .map((row) => (
              <li key={row.clientId}>
                {row.name}: {row.weeklyUnits} u/semana · {row.orders} pedidos · confianza {row.confidence}%
                {row.deviationPct ? ` · desvío ${row.deviationPct}%` : ''}
                {row.reorderEveryDays ? ` · repone cada ${row.reorderEveryDays} días` : ''}
              </li>
            ))}
        </ul>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Tiempos de entrega</h2>
        {(plan?.diagnostics ?? []).length ? (
          <ul>
            {plan?.diagnostics.slice(0, 8).map((row) => (
              <li key={row.orderId}>
                {row.orderId}: {row.hours} h{row.late ? ' · tarde' : ''}
                {row.incident ? ` · ${row.incident}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>Todavía no hay entregas con hora de cierre.</p>
        )}
      </section>
    </div>
  );
}
