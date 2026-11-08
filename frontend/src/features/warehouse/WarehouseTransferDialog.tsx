import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState, Location, Lot } from '../../shared/types';
import { api } from '../../shared/api/client';
import { product, qtyAt } from '../../shared/lib/inventory';
import { faceLabel } from '../../shared/lib/warehouseLayout';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { Modal } from '../../shared/components/Modal';
import { Btn } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';

export function WarehouseTransferDialog({ state, lot, onClose, onMoved }: { state: AppState; lot: Lot; onClose: () => void; onMoved: (destination: string) => void }) {
  const { applyResponse, toast } = useAppState();
  const [quantity, setQuantity] = useState(String(lot.qty));
  const [selectedId, setSelectedId] = useState('');
  const [rackFilter, setRackFilter] = useState('all');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; locations: Location[]; error: string }>({ key: '', locations: [], error: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const qty = Number(quantity);
  const validQty = Number.isInteger(qty) && qty > 0 && qty <= lot.qty;
  const requestKey = `${lot.id}:${qty}:${attempt}`;
  const ready = validQty && result.key === requestKey;
  const options = ready ? result.locations : [];
  const racks = [...new Set(options.map((location) => location.rack))].sort();
  const filtered = options.filter((location) => rackFilter === 'all' || location.rack === rackFilter);
  const destination = filtered.find((location) => location.id === selectedId) ?? filtered[0];
  const item = product(state, lot.productId);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!validQty) return;
    let cancelled = false;
    void api.suggest(lot.productId, qty, lot.loc).then((locations) => {
      if (!cancelled) setResult({ key: requestKey, locations, error: '' });
    }).catch((err: unknown) => {
      if (!cancelled) setResult({ key: requestKey, locations: [], error: err instanceof Error ? err.message : 'No se pudieron consultar los destinos.' });
    });
    return () => { cancelled = true; };
  }, [lot.productId, lot.loc, qty, validQty, requestKey]);
  const close = () => { if (!locked.current) onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current || !ready || !destination || !validQty) return;
    locked.current = true; setSaving(true); setError('');
    try {
      applyResponse(await api.move({ lotId: lot.id, qty, to: destination.id }));
      toast(`${qty} unidades trasladadas a ${destination.id}.`);
      if (mounted.current) onMoved(destination.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo registrar el traslado.';
      if (mounted.current) setError(message); else toast(message);
    } finally { locked.current = false; if (mounted.current) setSaving(false); }
  };
  return <Modal title="Reubicar producto" subtitle={`${item?.name ?? lot.productId} · Lote ${lot.batch}`} onClose={close} footer={<><Btn onClick={close} disabled={saving}>Cancelar</Btn><button type="submit" form="warehouse-transfer" className="btn primary" disabled={saving || !ready || !destination || !!result.error}><Icon name="swap" />{saving ? 'Trasladando…' : 'Confirmar traslado'}</button></>}>
    <form id="warehouse-transfer" onSubmit={(event) => void submit(event)} aria-busy={saving}>
      <div className="transfer-source"><span>ORIGEN</span><strong>{lot.loc}</strong><small>{lot.qty} unidades en este lote</small></div>
      <fieldset className="transfer-fields" disabled={saving}>
        <div className="form-grid">
          <div className="field"><label htmlFor="transfer-quantity">Unidades a trasladar</label><input id="transfer-quantity" type="number" min={1} max={lot.qty} step={1} value={quantity} required onChange={(event) => { setQuantity(event.target.value); setError(''); }} aria-describedby="transfer-quantity-help" /><small id="transfer-quantity-help">{validQty ? `Máximo ${lot.qty} unidades de este lote.` : `Ingresa una cantidad entera entre 1 y ${lot.qty}.`}</small></div>
          <div className="field"><label htmlFor="transfer-rack">Filtrar destino por rack</label><select id="transfer-rack" value={rackFilter} onChange={(event) => setRackFilter(event.target.value)}><option value="all">Todos los racks</option>{[...new Set([...racks, ...(rackFilter !== 'all' ? [rackFilter] : [])])].sort().map((id) => <option key={id} value={id}>Rack {id}</option>)}</select></div>
          <div className="field full"><label htmlFor="transfer-destination">Ubicación de destino compatible</label><select id="transfer-destination" required disabled={!ready || !filtered.length} value={destination?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}><option value="" disabled>{!validQty ? 'Primero indica la cantidad' : !ready ? 'Buscando ubicaciones…' : 'Sin destinos disponibles'}</option>{racks.filter((id) => rackFilter === 'all' || id === rackFilter).map((id) => <optgroup key={id} label={`Rack ${id}`}>{filtered.filter((location) => location.rack === id).map((location) => <option key={location.id} value={location.id}>{location.id} · Nivel {location.level} · Casilla {location.pos}{location.face ? ` · ${faceLabel(location.face)}` : ''} · {location.capacity - qtyAt(state, location.id)} u. libres</option>)}</optgroup>)}</select><small>Solo se muestran ubicaciones con espacio suficiente y compatibles con este producto.</small></div>
        </div>
      </fieldset>
      <div role="status" className="transfer-status">{validQty && !ready ? 'Comprobando capacidad disponible…' : ready && !result.error ? `${filtered.length} ubicaciones compatibles${rackFilter !== 'all' ? ` en el rack ${rackFilter}` : ''}.` : ''}</div>
      {ready && result.error ? <div className="wh-error" role="alert">{result.error}<Btn onClick={() => setAttempt((value) => value + 1)}>Reintentar</Btn></div> : null}
      {destination ? <div className="transfer-target"><span>DESTINO SELECCIONADO</span><strong>{destination.id}</strong><p>Rack {destination.rack} · Nivel {destination.level} · Casilla {destination.pos}{destination.face ? ` · ${faceLabel(destination.face)}` : ''}</p><small>Después del traslado: {qtyAt(state, destination.id) + qty} de {destination.capacity} unidades.</small></div> : ready && !result.error ? <p className="positioning-empty">{rackFilter !== 'all' ? 'No hay destinos compatibles en este rack. Prueba con todos los racks o reduce la cantidad.' : 'No hay espacio compatible para esta cantidad. Reduce las unidades o libera una ubicación.'}</p> : null}
      {error ? <div className="wh-error" role="alert">{error}</div> : null}
    </form>
  </Modal>;
}
