import { useMemo, useState } from 'react';
import type { AppState, WarehouseLayout, WarehouseSite } from '../../shared/types';
import { layoutSummary, normalizeLayout } from '../../shared/lib/warehouseLayout';
import { WarehouseLayoutSchematic } from './WarehouseLayoutSchematic';
import { WarehouseMapIso } from '../warehouse/WarehouseMapIso';
import { Kpi } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { YAW_MAX, YAW_MIN } from '../warehouse/iso';

type Props = {
  draft: Partial<WarehouseSite> & { layout: WarehouseLayout };
  onChange: (next: WarehouseLayout) => void;
};

const emptyState = (_layout: WarehouseLayout): AppState =>
  ({
    version: 1,
    products: [],
    lots: [],
    warehouses: [],
    clients: [],
    orders: [],
    events: [],
    purchases: [],
    receipts: [],
    settings: { company: '', warehouse: '', operator: '' },
  }) as AppState;

export function WarehouseDesigner({ draft, onChange }: Props) {
  const layout = normalizeLayout(draft.layout);
  const summary = useMemo(() => layoutSummary(layout), [layout]);
  const [yaw, setYaw] = useState(0.35);

  const setField = (key: keyof WarehouseLayout, value: number) => {
    onChange(normalizeLayout({ ...layout, [key]: value }));
  };

  return (
    <div className="warehouse-designer">
      <section className="panel designer-controls">
        <div className="panel-head">
          <span className="panel-title">
            <Icon name="grid" />
            Diseño del layout
          </span>
        </div>
        <div className="panel-body">
          <div className="designer-sliders">
            <label className="designer-slider">
              <span>Racks</span>
              <input
                type="range"
                min={1}
                max={12}
                value={layout.rackCount}
                onChange={(e) => setField('rackCount', Number(e.target.value))}
              />
              <strong>{layout.rackCount}</strong>
            </label>
            <label className="designer-slider">
              <span>Niveles por rack</span>
              <input
                type="range"
                min={1}
                max={5}
                value={layout.levels}
                onChange={(e) => setField('levels', Number(e.target.value))}
              />
              <strong>{layout.levels}</strong>
            </label>
            <label className="designer-slider">
              <span>Casillas por nivel</span>
              <input
                type="range"
                min={1}
                max={8}
                value={layout.positionsPerLevel}
                onChange={(e) => setField('positionsPerLevel', Number(e.target.value))}
              />
              <strong>{layout.positionsPerLevel}</strong>
            </label>
            <label className="designer-slider">
              <span>Capacidad por casilla (u.)</span>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={layout.capacityPerCell}
                onChange={(e) => setField('capacityPerCell', Number(e.target.value))}
              />
              <strong>{layout.capacityPerCell}</strong>
            </label>
          </div>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 16 }}>
            <Kpi
              label="Ubicaciones totales"
              value={summary.totalCells}
              unit=""
              foot={`${layout.rackCount}×${layout.levels}×${layout.positionsPerLevel}`}
              icon="pin"
            />
            <Kpi
              label="Capacidad máxima"
              value={summary.capacityUnits}
              unit="u."
              foot="Si todas las casillas están llenas"
              icon="box"
            />
            <Kpi label="Pasillo central" value="1" unit="" foot="Distribución en 2 columnas" icon="map" />
          </div>
        </div>
      </section>

      <section className="panel designer-schematic">
        <div className="panel-head">
          <span className="panel-title">
            <Icon name="layers" />
            Vista por niveles y casillas
          </span>
        </div>
        <div className="panel-body">
          <WarehouseLayoutSchematic layout={layout} />
        </div>
      </section>

      <section className="panel designer-preview">
        <div className="panel-head">
          <span className="panel-title">
            <Icon name="cube" />
            Vista previa 3D
          </span>
          <div className="filter-group">
            <input
              type="range"
              min={YAW_MIN}
              max={YAW_MAX}
              step={0.03}
              value={yaw}
              onChange={(e) => setYaw(Number(e.target.value))}
              aria-label="Rotar vista previa"
              style={{ width: 120 }}
            />
          </div>
        </div>
        <div className="designer-canvas warehouse-canvas">
          <WarehouseMapIso
            state={emptyState(layout)}
            racks={summary.racks}
            selectedLoc={`${summary.racks[0]?.id ?? 'A'}-01-01`}
            level="all"
            warehouseSearch=""
            pickLocs={new Set()}
            zoom={0.92}
            yaw={yaw}
            onSelect={() => {}}
            onSelectRack={() => {}}
          />
          <div className="map-hint">
            <Icon name="cursor" />
            Ajusta racks, niveles y casillas — el 3D se actualiza al instante
          </div>
        </div>
      </section>
    </div>
  );
}
