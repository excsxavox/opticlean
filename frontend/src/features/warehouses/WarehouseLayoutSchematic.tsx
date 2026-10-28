import type { WarehouseLayout } from '../../shared/types';
import { buildWarehouseGeometry } from '../../shared/lib/warehouseLayout';

export function WarehouseLayoutSchematic({ layout }: { layout: WarehouseLayout }) {
  const { racks } = buildWarehouseGeometry(layout);
  return (
    <div className="layout-schematic">
      {racks.map((r) => (
        <div key={r.id} className="layout-rack-card">
          <div className="layout-rack-head">
            <strong>Rack {r.id}</strong>
            <span className="subtle">{r.category}</span>
          </div>
          <div className="layout-levels">
            {Array.from({ length: layout.levels }, (_, li) => layout.levels - li).map((level) => (
              <div key={level} className="layout-level-row">
                <span className="layout-level-label">N{level}</span>
                <div className="layout-cells">
                  {Array.from({ length: layout.positionsPerLevel }, (_, pi) => (
                    <span key={pi} className="layout-cell" title={`${r.id}-0${level}-0${pi + 1}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
