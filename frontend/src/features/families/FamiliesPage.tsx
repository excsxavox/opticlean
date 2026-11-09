import { useMemo, useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { Btn, Empty, PageHead } from '../../shared/components/ui';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/Icon';
import type { WarehouseFamily } from '../../shared/types';
import '../../styles/families.css';

const emptyFamily = (): WarehouseFamily => ({
  id: '',
  code: '',
  name: '',
  productCategories: [],
  rackIds: [],
  fragilePreferred: false,
  color: '#467fc2',
  notes: '',
});

export function FamiliesPage() {
  const { state, meta, applyResponse, toast } = useAppState();
  const [edit, setEdit] = useState<WarehouseFamily | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const families = state?.families ?? [];
  const categories = useMemo(
    () => [...new Set([...(meta?.categories ?? []), ...((state?.products ?? []).map((p) => p.category))])],
    [meta, state],
  );
  const racks = useMemo(() => {
    const ids = new Set((meta?.locations ?? []).map((l) => l.rack));
    return [...ids].sort();
  }, [meta]);

  if (!state) return null;

  const openNew = () => {
    setError('');
    setEdit(emptyFamily());
  };

  const openEdit = (f: WarehouseFamily) => {
    setError('');
    setEdit({ ...f, productCategories: [...f.productCategories], rackIds: [...f.rackIds] });
  };

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit || pending) return;
    setPending(true);
    setError('');
    try {
      const id = edit.id.trim().toUpperCase() || `FAM-${edit.code.trim().toUpperCase()}`;
      applyResponse(
        await api.saveFamily({
          ...edit,
          id,
          code: edit.code.trim().toUpperCase(),
          name: edit.name.trim(),
        }),
      );
      toast('Familia guardada.');
      setEdit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta familia?')) return;
    try {
      applyResponse(await api.deleteFamily(id));
      toast('Familia eliminada.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  return (
    <div className="fam-page">
      <PageHead
        eyebrow="Reglas de ubicación"
        title="Familias de bodega"
        desc="Define qué líneas van a qué racks y si la zona prioriza productos frágiles. El móvil y la recepción usan estas reglas."
        actions={<Btn variant="primary" icon="plus" onClick={openNew}>Nueva familia</Btn>}
      />

      <section className="fam-hint">
        <Icon name="spark" />
        <p>
          Al recibir mercadería, la guía de ubicación prioriza racks de la familia, huecos vacíos y niveles bajos si el producto es frágil.
        </p>
      </section>

      {families.length ? (
        <div className="fam-grid">
          {families.map((f) => {
            const count = state.products.filter(
              (p) => p.familyId === f.id || (!p.familyId && f.productCategories.includes(p.category)),
            ).length;
            return (
              <article key={f.id} className="fam-card" style={{ ['--fam-color' as string]: f.color }}>
                <header>
                  <span className="fam-swatch" />
                  <div>
                    <strong>{f.name}</strong>
                    <small>{f.code} · {count} productos</small>
                  </div>
                  {f.fragilePreferred && <em className="fam-pill">Zona frágil</em>}
                </header>
                <p>{f.notes || 'Sin notas.'}</p>
                <dl>
                  <div>
                    <dt>Líneas</dt>
                    <dd>{f.productCategories.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt>Racks</dt>
                    <dd>{f.rackIds.join(', ') || '—'}</dd>
                  </div>
                </dl>
                <footer>
                  <Btn variant="small" icon="edit" onClick={() => openEdit(f)}>Editar</Btn>
                  <Btn variant="small" icon="trash" onClick={() => void remove(f.id)}>Eliminar</Btn>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="Sin familias" desc="Crea la primera familia para guiar la ubicación." />
      )}

      {edit && (
        <Modal
          title={edit.id ? 'Editar familia' : 'Nueva familia'}
          subtitle="Estas reglas alimentan la sugerencia de ubicación en web y móvil."
          onClose={() => !pending && setEdit(null)}
          footer={
            <ModalActions
              onCancel={() => setEdit(null)}
              submitLabel={pending ? 'Guardando…' : 'Guardar'}
              formId="family-form"
              icon="save"
            />
          }
        >
          <form id="family-form" onSubmit={save}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="fam-code">Código</label>
                <input
                  id="fam-code"
                  required
                  value={edit.code}
                  onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                  placeholder="HOG"
                />
              </div>
              <div className="field">
                <label htmlFor="fam-color">Color</label>
                <input
                  id="fam-color"
                  type="color"
                  value={edit.color}
                  onChange={(e) => setEdit({ ...edit, color: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="fam-name">Nombre</label>
                <input
                  id="fam-name"
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  placeholder="Familia Hogar"
                />
              </div>
              <div className="field full">
                <label>Líneas de producto</label>
                <div className="fam-chips">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={edit.productCategories.includes(c) ? 'is-on' : ''}
                      onClick={() =>
                        setEdit({ ...edit, productCategories: toggleIn(edit.productCategories, c) })
                      }
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field full">
                <label>Racks de bodega</label>
                <div className="fam-chips">
                  {racks.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={edit.rackIds.includes(r) ? 'is-on' : ''}
                      onClick={() => setEdit({ ...edit, rackIds: toggleIn(edit.rackIds, r) })}
                    >
                      Rack {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field full">
                <label className="fam-check">
                  <input
                    type="checkbox"
                    checked={edit.fragilePreferred}
                    onChange={(e) => setEdit({ ...edit, fragilePreferred: e.target.checked })}
                  />
                  Preferir productos frágiles en esta familia (niveles bajos)
                </label>
              </div>
              <div className="field full">
                <label htmlFor="fam-notes">Notas</label>
                <textarea
                  id="fam-notes"
                  value={edit.notes ?? ''}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  maxLength={240}
                />
              </div>
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      )}
    </div>
  );
}
