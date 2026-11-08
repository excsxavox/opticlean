import { useEffect, useMemo, useState } from 'react';
import type { AppState, WarehouseLayout, WarehouseSite } from '../../shared/types';
import { faceLabel, layoutSummary, normalizeLayout } from '../../shared/lib/warehouseLayout';
import { WarehouseLayoutSchematic } from './WarehouseLayoutSchematic';
import { WarehouseMapIso } from '../warehouse/WarehouseMapIso';
import { Btn } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { YAW_MAX, YAW_MIN } from '../warehouse/iso';
import { WarehouseFloorPlan } from '../warehouse/WarehouseFloorPlan';
import '../../styles/warehouse-designer-controls.css';

type Props = {
  draft: Partial<WarehouseSite> & { layout: WarehouseLayout };
  onChange: (next: WarehouseLayout) => void;
};

type LayoutField = Exclude<keyof WarehouseLayout, 'depthFaces' | 'rackPositions'>;
const fields: { key: LayoutField; label: string; hint: string; min: number; max: number }[] = [
  { key: 'rackCount', label: 'Cantidad de racks', hint: 'Estanterías dentro de la bodega.', min: 1, max: 12 },
  { key: 'levels', label: 'Niveles por rack', hint: 'Alturas disponibles en cada estantería.', min: 1, max: 5 },
  { key: 'positionsPerLevel', label: 'Casillas por nivel', hint: 'Espacios a lo ancho de cada nivel.', min: 1, max: 8 },
  { key: 'capacityPerCell', label: 'Unidades por ubicación', hint: 'Capacidad de cada ubicación, incluida cada cara.', min: 10, max: 200 },
];

const presets: { name: string; description: string; layout: Omit<WarehouseLayout, 'depthFaces' | 'rackPositions'> }[] = [
  { name: 'Compacta', description: 'Para empezar con poco espacio', layout: { rackCount: 2, levels: 2, positionsPerLevel: 4, capacityPerCell: 40 } },
  { name: 'Estándar', description: 'Una base para la operación diaria', layout: { rackCount: 6, levels: 3, positionsPerLevel: 4, capacityPerCell: 60 } },
  { name: 'Amplia', description: 'Más espacio para tu inventario', layout: { rackCount: 8, levels: 4, positionsPerLevel: 6, capacityPerCell: 80 } },
];

const previewState = {
  version: 1,
  products: [], lots: [], warehouses: [], clients: [], orders: [], events: [], purchases: [], receipts: [],
  settings: { company: '', warehouse: '', operator: '' },
} as AppState;
const noPickLocations = new Set<string>();
const initialYaw = 0.35;
const number = (value: number) => value.toLocaleString('es-EC');

function LayoutControl({ field, value, onChange }: {
  field: (typeof fields)[number];
  value: number;
  onChange: (value: number) => void;
}) {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);
  const id = `designer-${field.key}`;
  const commit = () => {
    const parsed = Number(input);
    const next = input.trim() && Number.isFinite(parsed)
      ? Math.min(field.max, Math.max(field.min, Math.round(parsed)))
      : value;
    setInput(String(next));
    onChange(next);
  };

  return (
    <div className="designer-dimension">
      <div className="designer-dimension-head">
        <label htmlFor={id}>{field.label}</label>
        <input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          step={1}
          inputMode="numeric"
          value={input}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const raw = event.target.value;
            setInput(raw);
            const parsed = Number(raw);
            if (raw && Number.isInteger(parsed) && parsed >= field.min && parsed <= field.max) onChange(parsed);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
      </div>
      <p id={`${id}-hint`}>{field.hint}</p>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={1}
        value={value}
        aria-label={`${field.label}: ajustar con deslizador`}
        onChange={(event) => {
          setInput(event.target.value);
          onChange(Number(event.target.value));
        }}
      />
      <div className="designer-range-limits" aria-hidden="true"><span>{field.min}</span><span>{field.max}</span></div>
    </div>
  );
}

export function WarehouseDesigner({ draft, onChange }: Props) {
  const layout = useMemo(() => normalizeLayout(draft.layout), [draft.layout]);
  const summary = useMemo(() => layoutSummary(layout), [layout]);
  const [yaw, setYaw] = useState(initialYaw);
  const [selectedId, setSelectedId] = useState('');
  const selected = summary.locations.find((location) => location.id === selectedId) ?? summary.locations[0];
  const selectedPreset = presets.find((preset) => fields.every(({ key }) => preset.layout[key] === layout[key]));

  return (
    <div className="warehouse-designer designer-workspace">
      <section className="panel designer-controls">
        <div className="panel-head">
          <div>
            <span className="panel-title"><Icon name="grid" />Distribución de la bodega</span>
            <div className="panel-subtitle">Elige una base y ajústala a tu espacio.</div>
          </div>
        </div>
        <div className="panel-body">
          <div className="designer-presets" role="group" aria-label="Plantillas de distribución">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={`designer-preset ${selectedPreset === preset ? 'selected' : ''}`}
                aria-pressed={selectedPreset === preset}
                onClick={() => onChange(normalizeLayout({ ...layout, ...preset.layout }))}
              >
                <span className="designer-preset-mark"><Icon name={selectedPreset === preset ? 'check' : 'warehouse'} /></span>
                <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
                <span className="designer-preset-size">{preset.layout.rackCount} racks</span>
              </button>
            ))}
          </div>
          <div className="designer-custom-heading">
            <strong>Ajustes de distribución</strong>
            <span>{selectedPreset?.name ?? 'Personalizada'}</span>
          </div>
          <div className="designer-dimensions">
            {fields.map((field) => (
              <LayoutControl
                key={field.key}
                field={field}
                value={layout[field.key]}
                onChange={(value) => onChange(normalizeLayout({ ...layout, [field.key]: value }))}
              />
            ))}
          </div>
          <label className="designer-depth-toggle">
            <input
              type="checkbox"
              checked={layout.depthFaces === 2}
              onChange={(event) => onChange({ ...layout, depthFaces: event.target.checked ? 2 : 1 })}
            />
            <span>
              <strong>Doble profundidad</strong>
              <small>Crea una ubicación delantera y otra trasera por casilla. Duplica las ubicaciones disponibles.</small>
            </span>
          </label>
          <div className="designer-capacity" aria-live="polite" aria-atomic="true">
            <div><span>Ubicaciones totales</span><strong>{number(summary.totalCells)}</strong></div>
            <div><span>Capacidad máxima</span><strong>{number(summary.capacityUnits)} <small>u.</small></strong></div>
            <p>{layout.rackCount} racks × {layout.levels} niveles × {layout.positionsPerLevel} casillas{layout.depthFaces === 2 ? ' × 2 caras' : ''}</p>
          </div>
        </div>
      </section>

      <section className="panel designer-floor">
        <div className="panel-head">
          <div><span className="panel-title"><Icon name="map" />Posiciona los racks</span><div className="panel-subtitle">Organiza la distribución física sin cambiar las ubicaciones del inventario.</div></div>
          <Btn variant="small" icon="refresh" onClick={() => onChange({ ...layout, rackPositions: undefined })}>Restablecer distribución</Btn>
        </div>
        <WarehouseFloorPlan layout={layout} selectedRack={selected.rack} onSelectRack={(id) => setSelectedId(summary.locations.find((location) => location.rack === id)?.id ?? selected.id)} onChange={onChange} />
      </section>

      <section className="panel designer-preview">
        <div className="panel-head">
          <div>
            <span className="panel-title"><Icon name="cube" />Vista previa 3D</span>
            <div className="panel-subtitle">Explora tu distribución antes de guardarla.</div>
          </div>
          <Btn variant="small" icon="refresh" onClick={() => setYaw(initialYaw)}>Restablecer vista</Btn>
        </div>
        <div className="designer-rotation">
          <label htmlFor="designer-rotation">Girar vista</label>
          <input id="designer-rotation" type="range" min={YAW_MIN} max={YAW_MAX} step={0.01} value={yaw} onChange={(event) => setYaw(Number(event.target.value))} />
          <output htmlFor="designer-rotation">{Math.round(yaw * 180 / Math.PI)}°</output>
        </div>
        <div className="designer-canvas warehouse-canvas">
          <WarehouseMapIso
            state={previewState}
            racks={summary.racks}
            layout={layout}
            locations={summary.locations}
            selectedLoc={selected.id}
            level="all"
            warehouseSearch=""
            pickLocs={noPickLocations}
            zoom={0.92}
            yaw={yaw}
            onSelect={setSelectedId}
            onSelectRack={(rack) => setSelectedId(summary.locations.find((location) => location.rack === rack)?.id ?? selected.id)}
          />
          <div className="map-hint"><Icon name="cursor" />Selecciona una casilla para ver su ubicación</div>
        </div>
        <div className="designer-location-detail">
          <div className="designer-location-picker">
            <label htmlFor="designer-location">Ubicación de ejemplo</label>
            <select id="designer-location" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
              {summary.locations.map((location) => <option key={location.id} value={location.id}>{location.id}</option>)}
            </select>
          </div>
          <p>Rack {selected.rack} · Nivel {selected.level} · Casilla {selected.pos}{selected.face ? ` · ${faceLabel(selected.face)}` : ''}<strong>{layout.capacityPerCell} unidades de capacidad</strong></p>
        </div>
      </section>

      <section className="panel designer-schematic">
        <div className="panel-head">
          <div>
            <span className="panel-title"><Icon name="layers" />Detalle por rack</span>
            <div className="panel-subtitle">Cada bloque representa una ubicación de almacenamiento.</div>
          </div>
        </div>
        <div className="panel-body"><WarehouseLayoutSchematic layout={layout} /></div>
      </section>
    </div>
  );
}
