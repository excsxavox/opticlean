import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { product, dateShort, time } from '../../shared/lib/inventory';
import { exportEvents } from '../../shared/lib/csv';
import { Badge, Btn, Empty, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';

export function TraceabilityPage() {
  const { state, toast } = useAppState();
  const loc = useLocation();
  const initialQ = (loc.state as { q?: string } | null)?.q ?? '';
  const [query, setQuery] = useState(initialQ);

  useEffect(() => {
    if (initialQ) setQuery(initialQ);
  }, [initialQ]);

  if (!state) return null;

  const events = state.events.filter((e) =>
    [e.productId, product(state, e.productId)?.name, e.batch, e.type, e.ref, e.from, e.to]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <>
      <PageHead
        eyebrow="Trazabilidad"
        title="La historia de cada movimiento"
        desc="Ingreso, ubicación y salida de cada producto."
        actions={
          <Btn
            icon="download"
            onClick={() => {
              exportEvents(state);
              toast('Historial descargado.');
            }}
          >
            Exportar historial
          </Btn>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search-input" style={{ maxWidth: 480 }}>
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" />
          </div>
          <Badge text={`${events.length} movimientos`} color="blue" />
        </div>
        {events.length ? (
          <div className="timeline">
            {events.map((e) => (
              <div className="timeline-item" key={e.id}>
                <span className="timeline-icon">
                  <Icon name={e.type === 'Traslado' ? 'swap' : e.type === 'Recepción' ? 'receive' : 'box'} />
                </span>
                <strong>
                  {e.type} · {e.ref}
                </strong>
                <p>
                  {product(state, e.productId)?.name} · {e.qty} u.
                  <br />
                  {e.from} → {e.to}
                </p>
                <small>
                  {dateShort(e.at)} · {time(e.at)} · {e.by}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Sin coincidencias" desc="Prueba otro término de búsqueda." />
        )}
      </section>
    </>
  );
}
