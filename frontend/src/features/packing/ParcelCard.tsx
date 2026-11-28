import { useEffect, useState } from 'react';
import { Badge, Btn } from '../../shared/components/ui';
import { Input } from '../../shared/components/Input';
import { Select } from '../../shared/components/Select';
import { product } from '../../shared/lib/inventory';
import type { AppState, Parcel } from '../../shared/types';
import {
  boxCatalog,
  contentVolume,
  expectedWeight,
  isFragile,
  keyOf,
  kg,
  m3,
  weightDiffers,
} from './packingModel';

type Props = {
  state: AppState;
  parcel: Parcel;
  index: number;
  count: number;
  closed: boolean;
  active: boolean;
  busy: boolean;
  onActivate: () => void;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
};

const text = (n: number | undefined) => (n ? String(n) : '');

export function ParcelCard({
  state,
  parcel,
  index,
  count,
  closed,
  active,
  busy,
  onActivate,
  onChange,
  onRemove,
}: Props) {
  const [weight, setWeight] = useState(text(parcel.weightKg));
  const [note, setNote] = useState(parcel.weightNote ?? '');
  const [dims, setDims] = useState({
    l: text(parcel.dims?.l),
    w: text(parcel.dims?.w),
    h: text(parcel.dims?.h),
  });
  useEffect(() => setWeight(text(parcel.weightKg)), [parcel.weightKg]);
  useEffect(() => setNote(parcel.weightNote ?? ''), [parcel.weightNote]);
  useEffect(
    () => setDims({ l: text(parcel.dims?.l), w: text(parcel.dims?.w), h: text(parcel.dims?.h) }),
    [parcel.dims?.l, parcel.dims?.w, parcel.dims?.h],
  );

  const expected = expectedWeight(state, parcel);
  const inside = contentVolume(state, parcel);
  const differs = weightDiffers(state, parcel);

  const saveWeight = () => {
    const value = Number(weight.replace(',', '.'));
    if (!weight.trim() || !Number.isFinite(value)) {
      setWeight(text(parcel.weightKg));
      return;
    }
    if (value !== parcel.weightKg) onChange({ weightKg: value });
  };
  const saveDims = () => {
    const next = { l: Number(dims.l), w: Number(dims.w), h: Number(dims.h) };
    if (!next.l || !next.w || !next.h) return;
    if (next.l !== parcel.dims?.l || next.w !== parcel.dims?.w || next.h !== parcel.dims?.h) {
      onChange({ boxCode: 'custom', dims: next });
    }
  };
  const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <article className={`pk-parcel${active && !closed ? ' is-active' : ''}`}>
      <header>
        <strong>
          Bulto {index + 1} de {count}
        </strong>
        <span>
          {isFragile(state, parcel) ? <Badge text="Frágil" color="purple" /> : null}
          <small>{parcel.id}</small>
        </span>
      </header>

      <label className="pk-field">
        <span>Caja</span>
        <Select
          aria-label={`Caja del bulto ${index + 1}`}
          value={parcel.boxCode ?? 'custom'}
          disabled={closed || busy}
          onChange={(event) =>
            onChange({ boxCode: event.target.value, ...(parcel.dims ? { dims: parcel.dims } : {}) })
          }
        >
          {parcel.boxCode &&
          parcel.boxCode !== 'custom' &&
          !boxCatalog(state).some((box) => box.code === parcel.boxCode) ? (
            <option value={parcel.boxCode}>Caja retirada del catálogo</option>
          ) : null}
          {boxCatalog(state).map((box) => (
            <option key={box.code} value={box.code}>
              {box.label} · {box.dims.l}×{box.dims.w}×{box.dims.h} cm
            </option>
          ))}
          <option value="custom">Otra medida</option>
        </Select>
      </label>

      {parcel.boxCode === 'custom' ? (
        <div className="pk-dims">
          {(['l', 'w', 'h'] as const).map((side) => (
            <label className="pk-field" key={side}>
              <span>{side === 'l' ? 'Largo cm' : side === 'w' ? 'Ancho cm' : 'Alto cm'}</span>
              <Input
                inputMode="decimal"
                value={dims[side]}
                disabled={closed}
                onChange={(event) => setDims({ ...dims, [side]: event.target.value })}
                onBlur={saveDims}
                onKeyDown={onEnter}
              />
            </label>
          ))}
        </div>
      ) : null}

      {parcel.contents?.length ? (
        <ul className="pk-contents">
          {parcel.contents.map((line) => (
            <li key={keyOf(line.productId, line.batch)}>
              <span>
                {line.qty} × {product(state, line.productId)?.name ?? line.productId}
              </span>
              {closed ? null : (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Sacar ${product(state, line.productId)?.name ?? line.productId} del bulto ${index + 1}`}
                  onClick={() =>
                    onChange({
                      contents: parcel.contents!.filter(
                        (item) =>
                          keyOf(item.productId, item.batch) !== keyOf(line.productId, line.batch),
                      ),
                    })
                  }
                >
                  Sacar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pk-muted">{parcel.contents ? 'Vacío' : 'Sin detalle de contenido'}</p>
      )}
      <p className="pk-muted">
        {m3(parcel.volumeM3)} m³
        {inside > parcel.volumeM3 + 0.001 ? (
          <span className="pk-warn-text">
            {' '}
            · el catálogo indica {m3(inside)} m³ de producto; revisa la caja
          </span>
        ) : null}
      </p>

      <label className="pk-field">
        <span>
          Peso real (kg){expected > 0 ? ` · esperado ${kg(expected)}` : ''}
        </span>
        <Input
          inputMode="decimal"
          aria-label={`Peso del bulto ${index + 1} en kg`}
          value={weight}
          disabled={closed}
          onChange={(event) => setWeight(event.target.value)}
          onBlur={saveWeight}
          onKeyDown={onEnter}
        />
      </label>

      {differs ? (
        <div className="pk-note pk-note-warn">
          El peso no coincide con lo esperado.
          <Input
            aria-label={`Motivo de la diferencia de peso del bulto ${index + 1}`}
            placeholder="Motivo de la diferencia"
            value={note}
            disabled={closed}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => {
              if (note.trim() !== (parcel.weightNote ?? '')) onChange({ weightNote: note });
            }}
            onKeyDown={onEnter}
          />
        </div>
      ) : null}

      {closed ? null : (
        <footer>
          <Btn size="small" disabled={active} onClick={onActivate}>
            {active ? 'Bulto en uso' : 'Usar este'}
          </Btn>
          <Btn size="small" icon="close" disabled={busy} onClick={onRemove}>
            Quitar
          </Btn>
        </footer>
      )}
    </article>
  );
}
