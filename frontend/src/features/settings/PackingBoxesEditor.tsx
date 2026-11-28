import { useEffect, useState } from 'react';
import { Btn } from '../../shared/components/ui';
import { Input } from '../../shared/components/Input';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import type { PackingBox } from '../../shared/types';
import { boxCatalog } from '../packing/packingModel';

type Row = { code: string; label: string; l: string; w: string; h: string; tareKg: string };

const toRow = (box: PackingBox): Row => ({
  code: box.code,
  label: box.label,
  l: String(box.dims.l),
  w: String(box.dims.w),
  h: String(box.dims.h),
  tareKg: String(box.tareKg),
});
const toNumber = (value: string) => Number(value.replace(',', '.'));

const columns: Array<{ key: keyof Row; label: string }> = [
  { key: 'label', label: 'Nombre' },
  { key: 'l', label: 'Largo cm' },
  { key: 'w', label: 'Ancho cm' },
  { key: 'h', label: 'Alto cm' },
  { key: 'tareKg', label: 'Peso vacía kg' },
];

/** Cajas que ofrece la estación de empaque. Se guarda aparte del resto de reglas. */
export function PackingBoxesEditor() {
  const { state, applyResponse, toast } = useAppState();
  const saved = state?.settings.packingBoxes;
  const [rows, setRows] = useState<Row[]>(() => (state ? boxCatalog(state).map(toRow) : []));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state) setRows(boxCatalog(state).map(toRow));
    // Solo cuando cambia lo guardado: no pisa lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved)]);

  if (!state) return null;

  const patch = (index: number, key: keyof Row, value: string) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      applyResponse(
        await api.updateSettings({
          packingBoxes: rows.map((row) => ({
            code: row.code,
            label: row.label.trim(),
            dims: { l: toNumber(row.l), w: toNumber(row.w), h: toNumber(row.h) },
            tareKg: toNumber(row.tareKg),
          })),
        }),
      );
      toast('Cajas de empaque guardadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="br-card br-boxes" aria-labelledby="br-boxes-title">
      <header className="br-card-head">
        <div>
          <h3 id="br-boxes-title">Cajas de empaque</h3>
          <p>
            Medidas y peso de cada caja vacía. El peso esperado de un bulto es el de sus productos más la
            caja. Los bultos ya armados no cambian.
          </p>
        </div>
      </header>
      {rows.map((row, index) => (
        <div className="br-box-row" key={row.code}>
          {columns.map((column) => (
            <label className="field" key={column.key}>
              <span>{column.label}</span>
              <Input
                inputMode={column.key === 'label' ? 'text' : 'decimal'}
                aria-label={`${column.label} de la caja ${index + 1}`}
                value={row[column.key]}
                onChange={(event) => patch(index, column.key, event.target.value)}
              />
            </label>
          ))}
          <Btn
            size="small"
            icon="close"
            disabled={rows.length <= 1}
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
          >
            Quitar
          </Btn>
        </div>
      ))}
      {error ? (
        <div className="form-error visible" role="alert">
          {error}
        </div>
      ) : null}
      <div className="br-actions">
        <Btn
          icon="plus"
          onClick={() =>
            setRows([
              ...rows,
              { code: `box-${Date.now().toString(36)}`, label: '', l: '', w: '', h: '', tareKg: '' },
            ])
          }
        >
          Agregar caja
        </Btn>
        <Btn variant="primary" icon="save" disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar cajas'}
        </Btn>
      </div>
    </section>
  );
}
