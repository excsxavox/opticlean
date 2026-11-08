import type { WarehouseLayout } from '../../shared/types';
import { buildWarehouseGeometry, formatLocationId, layoutFaces } from '../../shared/lib/warehouseLayout';

export function WarehouseLayoutSchematic({ layout }: { layout: WarehouseLayout }) {
  const { racks } = buildWarehouseGeometry(layout);
  const faces = layoutFaces(layout);
  return (
    <div className="layout-schematic">
      {racks.map((r) => (
        <div key={r.id} className="layout-rack-card">
          <div className="layout-rack-head">
            <strong>Rack {r.id}</strong>
            <span className="subtle">
              {layout.depthFaces === 2 ? 'Doble profundidad' : r.category}
            </span>
          </div>
          <div className="layout-levels">
            {Array.from({ length: layout.levels }, (_, li) => layout.levels - li).map((level) => (
              <div key={level} className="layout-level-block">
                <span className="layout-level-label">N{level}</span>
                <div className="layout-level-faces">
                  {faces.map((face) => (
                    <div key={face ?? 'single'} className="layout-face-row">
                      {layout.depthFaces === 2 ? (
                        <span className="layout-face-tag">{face === 'D' ? 'Del' : 'Tras'}</span>
                      ) : null}
                      <div className="layout-cells">
                        {Array.from({ length: layout.positionsPerLevel }, (_, pi) => {
                          const pos = pi + 1;
                          const id = formatLocationId(r.id, level, pos, face);
                          return <span key={id} className="layout-cell" title={id} />;
                        })}
                      </div>
                    </div>
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
