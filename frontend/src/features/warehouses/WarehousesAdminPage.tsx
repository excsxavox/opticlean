import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, scopedLots } from '../../shared/lib/inventory';
import { DEFAULT_LAYOUT, normalizeLayout } from '../../shared/lib/warehouseLayout';
import type { WarehouseLayout, WarehouseSite } from '../../shared/types';
import { Badge, Btn, Empty, PageHead } from '../../shared/components/ui';
import { WarehouseDesigner } from './WarehouseDesigner';

type Draft = {
  id?: string;
  code: string;
  name: string;
  city: string;
  address: string;
  status: WarehouseSite['status'];
  notes: string;
  layout: WarehouseLayout;
};

const emptyDraft = (): Draft => ({
  code: '',
  name: '',
  city: '',
  address: '',
  status: 'Operativa',
  notes: '',
  layout: { ...DEFAULT_LAYOUT },
});

export function WarehousesAdminPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState('');

  if (!state) return null;

  const active = activeWarehouseId(state);

  const startNew = () => {
    setDraft(emptyDraft());
    setEditingId('new');
    setError('');
  };

  const startEdit = (w: WarehouseSite) => {
    setDraft({
      id: w.id,
      code: w.code,
      name: w.name,
      city: w.city,
      address: w.address,
      status: w.status,
      notes: w.notes ?? '',
      layout: normalizeLayout(w.layout ?? { racks: w.racks }),
    });
    setEditingId(w.id);
    setError('');
  };

  const save = async () => {
    setError('');
    const layout = normalizeLayout(draft.layout);
    const body = {
      code: draft.code,
      name: draft.name,
      city: draft.city,
      address: draft.address,
      status: draft.status,
      notes: draft.notes,
      racks: layout.rackCount,
      layout,
    };
    try {
      if (draft.id) {
        applyResponse(await api.updateWarehouse(draft.id, { ...body, id: draft.id }));
        toast('Bodega y diseño guardados.');
      } else {
        applyResponse(await api.addWarehouse(body));
        toast('Bodega creada.');
      }
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const activate = async (id: string) => {
    try {
      applyResponse(await api.activateWarehouse(id));
      toast('Bodega activa en operación.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar esta bodega?')) return;
    try {
      applyResponse(await api.deleteWarehouse(id));
      if (editingId === id) setEditingId(null);
      toast('Bodega eliminada.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error');
    }
  };

  const designerDraft = useMemo(
    () => ({ ...draft, layout: normalizeLayout(draft.layout) }),
    [draft],
  );

  return (
    <>
      <PageHead
        eyebrow="Red logística"
        title="Administración y diseño de bodegas"
        desc="Define racks, niveles y casillas con vista esquemática y previsualización 3D en vivo."
        actions={
          <>
            <Btn icon="warehouse" onClick={() => navigate('/bodega')}>
              Ver mapa operativo
            </Btn>
            <Btn variant="primary" icon="plus" onClick={startNew}>
              Nueva bodega
            </Btn>
          </>
        }
      />

      {editingId ? (
        <>
          <section className="panel wh-identity-panel">
            <div className="panel-head">
              <span className="panel-title">{draft.id ? 'Editar bodega' : 'Nueva bodega'}</span>
              <div className="button-row">
                <Btn onClick={() => setEditingId(null)}>Cancelar</Btn>
                <Btn variant="primary" icon="save" onClick={() => void save()}>
                  Guardar diseño
                </Btn>
              </div>
            </div>
            <div className="form-grid panel-body">
              <div className="field">
                <label htmlFor="wh-code">Código</label>
                <input
                  id="wh-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="BOD-QTO"
                />
              </div>
              <div className="field">
                <label htmlFor="wh-status">Estado</label>
                <select
                  id="wh-status"
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value as WarehouseSite['status'] })
                  }
                >
                  <option>Operativa</option>
                  <option>Inactiva</option>
                </select>
              </div>
              <div className="field full">
                <label htmlFor="wh-name">Nombre</label>
                <input
                  id="wh-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="wh-city">Ciudad</label>
                <input
                  id="wh-city"
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="wh-address">Dirección</label>
                <input
                  id="wh-address"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="wh-notes">Notas</label>
                <textarea
                  id="wh-notes"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  maxLength={300}
                />
              </div>
            </div>
            {error ? <div className="form-error visible" style={{ margin: '0 19px 16px' }}>{error}</div> : null}
          </section>

          <WarehouseDesigner
            draft={designerDraft}
            onChange={(layout) => setDraft((d) => ({ ...d, layout }))}
          />
        </>
      ) : null}

      <section className="panel">
        {state.warehouses?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Bodega</th>
                  <th>Layout</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.warehouses.map((w) => {
                  const layout = normalizeLayout(w.layout ?? { racks: w.racks });
                  const units = scopedLots({
                    ...state,
                    settings: { ...state.settings, activeWarehouseId: w.id },
                  }).reduce((n, l) => n + l.qty, 0);
                  const isActive = w.id === active;
                  return (
                    <tr key={w.id}>
                      <td>
                        <strong className="code-label">{w.code}</strong>
                      </td>
                      <td>
                        <strong>{w.name}</strong>
                        <span className="sub">{w.city}</span>
                      </td>
                      <td>
                        {layout.rackCount} racks · {layout.levels} niv. · {layout.positionsPerLevel}{' '}
                        casillas
                      </td>
                      <td>{units} u.</td>
                      <td>
                        {isActive ? (
                          <Badge text="Activa" color="green" />
                        ) : (
                          <Badge text={w.status} color={w.status === 'Operativa' ? 'blue' : 'amber'} />
                        )}
                      </td>
                      <td>
                        <div className="button-row">
                          <Btn variant="ghost" icon="edit" onClick={() => startEdit(w)}>
                            Diseñar
                          </Btn>
                          {!isActive ? (
                            <Btn variant="small" onClick={() => void activate(w.id)}>
                              Activar
                            </Btn>
                          ) : null}
                          <Btn variant="small" icon="trash" onClick={() => void remove(w.id)}>
                            Eliminar
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin bodegas" desc="Crea la primera bodega y diseña su layout." action={<Btn variant="primary" onClick={startNew}>Nueva bodega</Btn>} />
        )}
      </section>
    </>
  );
}
