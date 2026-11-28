import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { Kpi, KpiGrid, PageHead } from '../../shared/components/ui';
import { SegmentedControl } from '../../shared/components/Tabs';
import type { AppState, Metrics } from '../../shared/types';
import { PackStation } from './PackStation';
import { TruckLoad } from './TruckLoad';
import { parcelsOf } from './packingModel';
import '../../styles/packing.css';

/** Ejecuta una escritura, aplica el estado devuelto y muestra el resultado. */
export type RunAction = (
  action: () => Promise<{ state: AppState; metrics: Metrics }>,
  success?: string,
) => Promise<boolean>;

type View = 'pack' | 'load';

export function PackingPage() {
  const { state, applyResponse, toast } = useAppState();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('vista') === 'carga' ? 'load' : 'pack';
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  if (!state) return null;

  // En fila: así dos guardados seguidos (peso y luego motivo) no se pisan.
  const run: RunAction = (action, success) => {
    setPending((n) => n + 1);
    const result = queue.current.then(async () => {
      try {
        applyResponse(await action());
        setError('');
        if (success) toast(success);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo guardar.';
        setError(message);
        toast(message);
        return false;
      } finally {
        setPending((n) => n - 1);
      }
    });
    queue.current = result;
    return result;
  };

  const orders = state.orders.filter((order) => order.status === 'Preparado');
  const packed = orders.filter((order) => order.packing);
  const loaded = orders.filter((order) => order.stagedPlate);
  const readyParcels = packed.reduce((n, order) => n + parcelsOf(state, order.id).length, 0);
  const urgent = orders.filter((order) => order.priority === 'Alta' && !order.packing).length;

  const changeView = (next: View) => {
    setError('');
    setParams(next === 'load' ? { vista: 'carga' } : {}, { replace: true });
  };

  return (
    <div className="pk-page">
      <PageHead
        eyebrow="Logística"
        title="Empaque y carga"
        desc="Verifica lo preparado, arma los bultos y deja el camión cargado antes del despacho."
        actions={
          <SegmentedControl
            label="Vista"
            value={view}
            onValueChange={changeView}
            items={[
              { value: 'pack', label: 'Estación de empaque', count: orders.length - packed.length },
              { value: 'load', label: 'Carga de camión', count: packed.length },
            ]}
          />
        }
      />

      <KpiGrid label="Resumen de empaque">
        <Kpi
          label="Por empacar"
          icon="box"
          value={orders.length - packed.length}
          tone={urgent ? 'warning' : 'default'}
          caption={urgent ? `${urgent} de prioridad alta` : 'Sin urgentes'}
          captionTone={urgent ? 'warning' : undefined}
        />
        <Kpi label="Empacados" icon="check" tone="success" value={packed.length} caption="Con empaque cerrado" />
        <Kpi label="Bultos listos" icon="cube" value={readyParcels} caption="En pedidos empacados" />
        <Kpi label="Cargados" icon="truck" value={loaded.length} caption="Esperando despacho" />
      </KpiGrid>

      {error ? (
        <div className="pk-note pk-note-bad pk-page-error" role="alert">
          {error}
        </div>
      ) : null}

      {view === 'pack' ? (
        <PackStation state={state} orders={orders} run={run} busy={pending > 0} toast={toast} />
      ) : (
        <TruckLoad state={state} orders={orders} run={run} busy={pending > 0} />
      )}
    </div>
  );
}
