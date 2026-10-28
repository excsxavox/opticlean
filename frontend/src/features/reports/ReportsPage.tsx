import { useAppState } from '../../shared/hooks/AppStateProvider';
import { available, qtyAt, stock } from '../../shared/lib/inventory';
import { exportInventory, exportLocations, exportEvents } from '../../shared/lib/csv';
import { Btn, Kpi, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { money, num } from '../../shared/lib/inventory';

export function ReportsPage() {
  const { state, meta, toast } = useAppState();

  if (!state || !meta) return null;

  const totalCells = meta.locations.length;
  const occupied = meta.locations.filter((l) => qtyAt(state, l.id) > 0).length;
  const stockValue = state.products.reduce((n, p) => n + stock(state, p.id) * p.price, 0);

  return (
    <>
      <PageHead
        eyebrow="Información para decidir"
        title="Reportes de operación"
        desc="Descarga los datos actuales."
        actions={<Btn icon="file" onClick={() => window.print()}>Imprimir resumen</Btn>}
      />
      <div className="kpis">
        <Kpi label="Inventario a PVP" value={money(stockValue)} unit="" foot="Stock físico" icon="chart" />
        <Kpi
          label="Disponibilidad"
          value={num(state.products.reduce((n, p) => n + available(state, p.id), 0))}
          unit="u."
          foot="Físico − reservado"
          icon="box"
        />
        <Kpi
          label="Ocupación"
          value={`${Math.round((occupied / Math.max(totalCells, 1)) * 100)}%`}
          unit=""
          foot={`${occupied}/${totalCells} ubicaciones`}
          icon="warehouse"
        />
        <Kpi label="Movimientos" value={state.events.length} unit="" foot="Historial completo" icon="history" />
      </div>
      <div className="three-col">
        <section className="panel report-card">
          <Icon name="box" />
          <h3>Inventario</h3>
          <p>Catálogo con stock, reservas y valor PVP.</p>
          <Btn
            variant="full"
            icon="download"
            onClick={() => {
              exportInventory(state);
              toast('CSV descargado.');
            }}
          >
            Descargar CSV
          </Btn>
        </section>
        <section className="panel report-card">
          <Icon name="warehouse" />
          <h3>Ubicaciones</h3>
          <p>Detalle por rack, lote y cantidad.</p>
          <Btn
            variant="full"
            icon="download"
            onClick={() => {
              exportLocations(state, meta.locations);
              toast('CSV descargado.');
            }}
          >
            Descargar CSV
          </Btn>
        </section>
        <section className="panel report-card">
          <Icon name="route" />
          <h3>Trazabilidad</h3>
          <p>Ingresos, traslados y salidas.</p>
          <Btn
            variant="full"
            icon="download"
            onClick={() => {
              exportEvents(state);
              toast('CSV descargado.');
            }}
          >
            Descargar CSV
          </Btn>
        </section>
      </div>
    </>
  );
}
