import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, num, scopedLots } from '../../shared/lib/inventory';
import { DEFAULT_LAYOUT, layoutSummary, normalizeLayout } from '../../shared/lib/warehouseLayout';
import type { AppState, WarehouseSite } from '../../shared/types';
import { Badge, Btn, Empty, Kpi, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { WarehouseDesigner } from './WarehouseDesigner';
import { WarehouseLayoutSchematic } from './WarehouseLayoutSchematic';
import { WarehouseFloorPlan } from '../warehouse/WarehouseFloorPlan';
import '../../styles/warehouses-admin.css';

type Draft = Omit<WarehouseSite, 'id' | 'racks'> & { id?: string; notes: string };
type FieldErrors = Partial<Record<'code' | 'name', string>>;
// Keep unfinished work when navigating to another screen during this session.
const draftCache = new Map<string, Draft>();
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const draftFor = (w?: WarehouseSite): Draft => ({
  ...(w ? { id: w.id } : {}), code: w?.code ?? '', name: w?.name ?? '',
  city: w?.city ?? '', address: w?.address ?? '', status: w?.status ?? 'Operativa', notes: w?.notes ?? '',
  layout: normalizeLayout(w?.layout ?? (w ? { racks: w.racks } : DEFAULT_LAYOUT)),
});

export function WarehousesAdminPage() {
  const { state } = useAppState();
  return state ? <WarehouseAdmin state={state} /> : null;
}

function WarehouseAdmin({ state }: { state: AppState }) {
  const { applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [pending, setPending] = useState<string | null>(null);
  const actionLock = useRef(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState('');
  const editId = params.get('edit');
  const editing = state.warehouses.find((w) => w.id === editId);
  const active = activeWarehouseId(state);
  const rows = state.warehouses.map((warehouse) => {
    const summary = layoutSummary(normalizeLayout(warehouse.layout ?? { racks: warehouse.racks }));
    const lots = scopedLots({ ...state, settings: { ...state.settings, activeWarehouseId: warehouse.id } });
    return { warehouse, summary, lots, units: lots.reduce((n, lot) => n + lot.qty, 0), occupied: new Set(lots.filter((lot) => lot.qty > 0).map((lot) => lot.loc)).size };
  });
  const filtered = rows.filter(({ warehouse: w }) => (status === 'all' || w.status === status) && fold(`${w.code} ${w.name} ${w.city} ${w.address}`).includes(fold(query)));
  const startNew = () => { setError(''); setParams({ edit: 'new' }); };
  const openWarehouse = async (w: WarehouseSite) => {
    if (actionLock.current) return;
    if (w.id === active) { navigate('/bodega'); return; }
    actionLock.current = true; setPending(w.id); setError('');
    try {
      applyResponse(await api.activateWarehouse(w.id));
      toast(`${w.name} está en uso para la operación.`); navigate('/bodega');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo abrir la bodega. Intenta de nuevo.'); }
    finally { actionLock.current = false; setPending(null); }
  };
  const remove = async (w: WarehouseSite) => {
    if (actionLock.current || !window.confirm(`¿Eliminar la bodega ${w.code} · ${w.name}? Esta acción no se puede deshacer.`)) return;
    actionLock.current = true; setPending(w.id); setError('');
    try { applyResponse(await api.deleteWarehouse(w.id)); toast('Bodega eliminada.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo eliminar la bodega. Intenta de nuevo.'); }
    finally { actionLock.current = false; setPending(null); }
  };
  if (editId === 'new' || editing) {
    return <WarehouseEditor key={editId} state={state} warehouse={editing} initialStep={editing && params.get('step') === 'layout' ? 1 : 0} onCancel={() => setParams({})} onSaved={(id) => { setSavedId(id); setQuery(''); setStatus('all'); setParams({}); }} />;
  }
  return <div className="wh-admin">
    <PageHead eyebrow="Red logística" title="Tus bodegas" desc="Organiza tus espacios, consulta su ocupación y elige dónde operar." actions={<Btn variant="primary" icon="plus" onClick={startNew}>Nueva bodega</Btn>} />
    {editId ? <div className="wh-notice" role="alert">No encontramos esa bodega. Puedes seleccionarla en el listado.</div> : null}
    <div className="kpis wh-overview">
      <Kpi label="Bodegas" value={state.warehouses.length} unit="" foot={`${state.warehouses.filter((w) => w.status === 'Operativa').length} operativas`} icon="building" />
      <Kpi label="Ubicaciones" value={num(rows.reduce((n, row) => n + row.summary.totalCells, 0))} unit="" foot="En toda tu red de bodegas" icon="grid" />
      <Kpi label="Existencias" value={num(rows.reduce((n, row) => n + row.units, 0))} unit="u." foot="Inventario de todas las bodegas" icon="box" />
    </div>
    {error ? <div className="wh-error" role="alert">{error}</div> : null}
    <section aria-label="Listado de bodegas">
      <div className="wh-list-toolbar">
        <div className="search-input"><Icon name="search" /><input aria-label="Buscar bodegas" type="search" placeholder="Buscar por nombre, código o ciudad…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <select aria-label="Filtrar bodegas por estado" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="Operativa">Operativas</option><option value="Inactiva">Inactivas</option></select>
        <span className="wh-result-count" role="status">{filtered.length} de {rows.length} bodegas</span>
      </div>
      {filtered.length ? <div className="wh-cards">{filtered.map(({ warehouse: w, summary, lots, units, occupied }) => {
        const isActive = w.id === active;
        const blockedDelete = isActive ? 'Para eliminarla, primero usa otra bodega.' : lots.length ? 'Para eliminarla, primero retira sus existencias.' : '';
        return <article key={w.id} className={`panel wh-card ${isActive ? 'is-active' : ''} ${savedId === w.id ? 'just-saved' : ''}`}>
          <div className="wh-card-heading"><span className="wh-card-icon"><Icon name="warehouse" /></span><div className="wh-card-title"><span className="wh-code">{w.code}</span><h2>{w.name}</h2></div><div className="wh-badges"><Badge text={w.status} color={w.status === 'Operativa' ? 'green' : 'amber'} />{isActive ? <Badge text="En uso" color="blue" /> : null}</div></div>
          <p className="wh-address"><Icon name="pin" /><span>{[w.city, w.address].filter(Boolean).join(' · ') || 'Ubicación pendiente de completar'}</span></p>
          <div className="wh-card-metrics"><div><strong>{num(summary.totalCells)}</strong><span>ubicaciones</span></div><div><strong>{num(units)} <small>u.</small></strong><span>en inventario</span></div><div><strong>{Math.round(occupied / summary.totalCells * 100)}<small>%</small></strong><span>ocupación</span></div></div>
          <div className="wh-occupancy" role="meter" aria-label={`Ocupación de ${w.name}`} aria-valuenow={occupied} aria-valuemin={0} aria-valuemax={Math.max(occupied, summary.totalCells)}><span style={{ width: `${Math.min(100, occupied / summary.totalCells * 100)}%` }} /></div>
          <p className="wh-layout-caption">{summary.layout.rackCount} racks · {summary.layout.levels} niveles · {summary.layout.positionsPerLevel} casillas por nivel{summary.layout.depthFaces === 2 ? ' · Doble profundidad' : ''}</p>
          <div className="wh-card-actions"><Btn variant={isActive ? 'primary' : ''} icon="map" disabled={!!pending || w.status === 'Inactiva'} onClick={() => void openWarehouse(w)}>{pending === w.id ? 'Procesando…' : isActive ? 'Ver mapa' : 'Usar bodega'}</Btn><Btn icon="edit" disabled={!!pending} onClick={() => setParams({ edit: w.id })}>Editar</Btn><button className="icon-btn wh-delete" type="button" disabled={!!pending || !!blockedDelete} title={blockedDelete || 'Eliminar bodega'} aria-label={`Eliminar ${w.name}`} onClick={() => void remove(w)}><Icon name="trash" /></button></div>
          <p className="wh-card-help">{w.status === 'Inactiva' ? 'Edita su estado a Operativa para usar esta bodega.' : isActive ? 'Las recepciones y consultas usan esta bodega.' : 'Usar bodega cambia el inventario de tu operación.'}{!isActive && blockedDelete ? ` ${blockedDelete}` : ''}</p>
          {savedId === w.id ? <p className="wh-saved" role="status"><Icon name="check" /> Bodega guardada correctamente</p> : null}
        </article>;
      })}</div> : <section className="panel"><Empty title={rows.length ? 'No encontramos bodegas' : 'Tu primera bodega empieza aquí'} desc={rows.length ? 'Prueba otro nombre, código o ciudad, o restablece los filtros.' : 'Añade sus datos y diseña los racks con una vista previa de tu espacio.'} action={rows.length ? <Btn onClick={() => { setQuery(''); setStatus('all'); }}>Limpiar filtros</Btn> : <Btn variant="primary" icon="plus" onClick={startNew}>Crear mi primera bodega</Btn>} /></section>}
    </section>
  </div>;
}

function WarehouseEditor({ state, warehouse, initialStep = 0, onCancel, onSaved }: { state: AppState; warehouse?: WarehouseSite; initialStep?: number; onCancel: () => void; onSaved: (id: string) => void }) {
  const { applyResponse, toast } = useAppState();
  const [initial] = useState(() => draftFor(warehouse));
  const cacheKey = warehouse?.id ?? 'new';
  const [restored] = useState(() => draftCache.has(cacheKey));
  const [draft, setDraft] = useState<Draft>(() => draftCache.get(cacheKey) ?? initial);
  const [step, setStep] = useState(initialStep);
  const [reviewRack, setReviewRack] = useState('A');
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const summary = layoutSummary(normalizeLayout(draft.layout));
  const isActive = warehouse?.id === activeWarehouseId(state);
  const lots = warehouse ? scopedLots({ ...state, settings: { ...state.settings, activeWarehouseId: warehouse.id } }) : [];
  const validLocations = new Set(summary.locations.map((loc) => loc.id));
  const excluded = [...new Set(lots.filter((lot) => !validLocations.has(lot.loc)).map((lot) => lot.loc))];
  const quantities = new Map<string, number>();
  lots.forEach((lot) => quantities.set(lot.loc, (quantities.get(lot.loc) ?? 0) + lot.qty));
  const overCapacity = [...quantities].filter(([, quantity]) => quantity > summary.layout.capacityPerCell);
  const layoutError = excluded.length
    ? `El diseño dejaría ${excluded.length} ubicaciones con existencias fuera de la bodega (${excluded.slice(0, 3).join(', ')}${excluded.length > 3 ? '…' : ''}). Conserva esas ubicaciones o traslada el inventario antes de cambiar la distribución o profundidad.`
    : overCapacity.length ? `Hay ${overCapacity.length} ubicaciones con más de ${summary.layout.capacityPerCell} unidades. Aumenta la capacidad por casilla o redistribuye sus existencias antes de guardar.` : '';
  const fieldErrors: FieldErrors = {};
  if (!draft.code.trim()) fieldErrors.code = 'Ingresa un código para identificar la bodega.';
  else if (state.warehouses.some((w) => w.id !== draft.id && w.code.trim().toUpperCase() === draft.code.trim().toUpperCase())) fieldErrors.code = 'Este código ya está en uso. Elige otro.';
  if (!draft.name.trim()) fieldErrors.name = 'Ingresa el nombre de la bodega.';
  const showError = (field: 'code' | 'name') => (attempted || touched[field]) ? fieldErrors[field] : undefined;
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (dirty) draftCache.set(cacheKey, draft);
    else draftCache.delete(cacheKey);
  }, [cacheKey, draft, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((d) => ({ ...d, [key]: value })); setError(''); };
  const cancel = () => {
    if (!saving && (!dirty || window.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos y volver a tus bodegas?'))) {
      draftCache.delete(cacheKey);
      onCancel();
    }
  };
  const validateDetails = () => {
    setAttempted(true);
    if (isActive && draft.status === 'Inactiva') {
      setError('Esta bodega está en uso. Selecciona el estado Operativa o usa otra bodega antes de inactivarla.');
      setStep(0);
      window.requestAnimationFrame(() => document.getElementById('wh-status')?.focus());
      return false;
    }
    if (!Object.keys(fieldErrors).length) return true;
    setStep(0);
    window.requestAnimationFrame(() => document.getElementById(fieldErrors.code ? 'wh-code' : 'wh-name')?.focus());
    return false;
  };
  const goTo = (next: number) => { if (saving || (next > 0 && !validateDetails())) return; setError(''); setStep(next); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saveLock.current || !validateDetails()) return;
    if (step < 2) { setStep(step + 1); return; }
    if (layoutError) { setStep(1); return; }
    saveLock.current = true; setSaving(true); setError('');
    const body = { ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim(), city: draft.city.trim(), address: draft.address.trim(), notes: draft.notes.trim(), layout: summary.layout, racks: summary.layout.rackCount };
    try {
      const response = draft.id ? await api.updateWarehouse(draft.id, body) : await api.addWarehouse(body);
      applyResponse(response);
      const saved = response.state.warehouses.find((w) => w.code === body.code);
      toast(draft.id ? 'Cambios de la bodega guardados.' : 'Bodega creada. Ya puedes seleccionarla para operar.');
      if (draftCache.get(cacheKey) === draft) draftCache.delete(cacheKey);
      if (mounted.current) onSaved(saved?.id ?? draft.id ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar la bodega. Intenta de nuevo.';
      if (mounted.current) setError(message);
      else toast(message);
    } finally { saveLock.current = false; if (mounted.current) setSaving(false); }
  };
  return <div className="wh-admin wh-editor">
    <PageHead eyebrow={warehouse ? `Bodegas / ${warehouse.code}` : 'Bodegas / Nueva bodega'} title={warehouse ? 'Editar bodega' : 'Crea tu bodega'} desc="Define sus datos, organiza el espacio y revisa todo antes de guardar." actions={<Btn icon="back" onClick={cancel} disabled={saving}>Volver a bodegas</Btn>} />
    {restored ? <div className="wh-notice" role="status"><Icon name="history" /> Recuperamos los cambios que dejaste pendientes en esta sesión.</div> : null}
    <nav className="wh-steps" aria-label="Pasos de configuración">{['Datos de la bodega', 'Distribución', 'Revisión'].map((label, index) => <button type="button" key={label} className={step === index ? 'current' : step > index ? 'complete' : ''} aria-current={step === index ? 'step' : undefined} disabled={saving} onClick={() => goTo(index)}><span>{step > index ? <Icon name="check" /> : index + 1}</span><strong>{label}</strong></button>)}</nav>
    <form onSubmit={(e) => void submit(e)} noValidate aria-busy={saving}>
      <fieldset className="wh-editor-fields" disabled={saving}>
        <div className="wh-step-heading"><div><h2 tabIndex={-1} ref={heading}>{['Empecemos por lo esencial', 'Diseña tu espacio', 'Todo listo para guardar'][step]}</h2><p>{['Solo el código y el nombre son obligatorios. Puedes completar el resto después.', 'Elige una distribución inicial y ajusta sus dimensiones. La vista previa se actualiza al instante.', 'Comprueba los datos y la capacidad de tu bodega antes de confirmar.'][step]}</p></div><span>Paso {step + 1} de 3</span></div>
        {step === 0 ? <section className="panel wh-details"><div className="form-grid panel-body">
          <div className="field"><label htmlFor="wh-code">Código <span aria-hidden="true">*</span></label><input id="wh-code" required value={draft.code} placeholder="Ej. BOD-QTO-02" autoComplete="off" spellCheck={false} aria-invalid={!!showError('code')} aria-describedby="wh-code-help" onBlur={() => setTouched((v) => ({ ...v, code: 'true' }))} onChange={(e) => update('code', e.target.value.toUpperCase())} /><small id="wh-code-help" className={showError('code') ? 'wh-field-error' : ''}>{showError('code') || 'Un código único y fácil de reconocer.'}</small></div>
          <div className="field"><label htmlFor="wh-name">Nombre <span aria-hidden="true">*</span></label><input id="wh-name" required value={draft.name} placeholder="Ej. Bodega norte" autoComplete="off" aria-invalid={!!showError('name')} aria-describedby="wh-name-help" onBlur={() => setTouched((v) => ({ ...v, name: 'true' }))} onChange={(e) => update('name', e.target.value)} /><small id="wh-name-help" className={showError('name') ? 'wh-field-error' : ''}>{showError('name') || 'Así aparecerá en el listado y en la operación.'}</small></div>
          <div className="field"><label htmlFor="wh-city">Ciudad <span>(opcional)</span></label><input id="wh-city" value={draft.city} placeholder="Ej. Quito" autoComplete="address-level2" onChange={(e) => update('city', e.target.value)} /></div>
          <div className="field"><label htmlFor="wh-address">Dirección <span>(opcional)</span></label><input id="wh-address" value={draft.address} placeholder="Calle, número o referencia" autoComplete="street-address" onChange={(e) => update('address', e.target.value)} /></div>
          <div className="field full"><label htmlFor="wh-status">Estado</label><select id="wh-status" value={draft.status} aria-describedby="wh-status-help" onChange={(e) => update('status', e.target.value as WarehouseSite['status'])}><option>Operativa</option><option disabled={isActive}>Inactiva</option></select><small id="wh-status-help">{isActive ? 'Esta bodega está en uso. Selecciona otra para operar antes de inactivarla.' : draft.status === 'Operativa' ? 'Disponible para seleccionarla y trabajar con su inventario.' : 'Se guarda en el catálogo, pero no se puede seleccionar para operar.'}</small></div>
          <div className="field full"><label htmlFor="wh-notes">Notas <span>(opcional)</span></label><textarea id="wh-notes" value={draft.notes} placeholder="Indicaciones de acceso o información útil para el equipo" maxLength={300} onChange={(e) => update('notes', e.target.value)} /><small className="wh-counter">{draft.notes.length}/300 caracteres</small></div>
        </div></section> : null}
        {step === 1 ? <>{lots.length ? <div className="wh-notice"><Icon name="info" /><span>Esta bodega tiene {num(lots.reduce((n, lot) => n + lot.qty, 0))} unidades. El diseño debe conservar sus ubicaciones y capacidad.</span></div> : null}{layoutError ? <div className="wh-error" role="alert">{layoutError}</div> : null}<WarehouseDesigner draft={draft} onChange={(layout) => update('layout', layout)} /></> : null}
        {step === 2 ? <div className="wh-review">
          <section className="panel review-floor"><div className="panel-head"><span className="panel-title"><Icon name="map" />Distribución de racks</span><Btn variant="ghost" icon="edit" onClick={() => goTo(1)}>Editar posiciones</Btn></div><WarehouseFloorPlan layout={draft.layout} selectedRack={reviewRack} onSelectRack={setReviewRack} /></section>
          <section className="panel"><div className="panel-head"><span className="panel-title"><Icon name="building" /> Datos de la bodega</span><Btn variant="ghost" icon="edit" onClick={() => goTo(0)}>Editar datos</Btn></div><div className="panel-body"><span className="wh-code">{draft.code.trim()}</span><h3>{draft.name.trim()}</h3><Badge text={draft.status} color={draft.status === 'Operativa' ? 'green' : 'amber'} /><dl className="wh-review-details"><div><dt>Ciudad</dt><dd>{draft.city.trim() || 'Sin especificar'}</dd></div><div><dt>Dirección</dt><dd>{draft.address.trim() || 'Sin especificar'}</dd></div>{draft.notes.trim() ? <div><dt>Notas</dt><dd>{draft.notes.trim()}</dd></div> : null}</dl><p className="wh-notice">{warehouse ? 'Los cambios se aplicarán a esta bodega al guardar.' : 'Después de crearla, selecciona «Usar bodega» para empezar a operar con ella.'}</p></div></section>
          <section className="panel"><div className="panel-head"><span className="panel-title"><Icon name="grid" /> Distribución y capacidad</span><Btn variant="ghost" icon="edit" onClick={() => goTo(1)}>Editar diseño</Btn></div><div className="panel-body"><div className="wh-review-capacity"><strong>{num(summary.totalCells)}<span>ubicaciones</span></strong><strong>{num(summary.capacityUnits)}<span>unidades de capacidad</span></strong></div><p className="wh-layout-caption">{draft.layout.rackCount} racks × {draft.layout.levels} niveles × {draft.layout.positionsPerLevel} casillas{draft.layout.depthFaces === 2 ? ' × 2 caras' : ''} · {draft.layout.capacityPerCell} u. por casilla</p><WarehouseLayoutSchematic layout={draft.layout} /></div></section>
          {layoutError ? <div className="wh-error" role="alert">{layoutError} <Btn onClick={() => goTo(1)}>Revisar distribución</Btn></div> : null}
        </div> : null}
      </fieldset>
      {error ? <div className="wh-error" role="alert">{error} Tus cambios siguen en el formulario; puedes corregirlos y reintentar.</div> : null}
      <div className="wh-editor-footer"><div className="wh-footer-summary"><strong>{num(summary.totalCells)} ubicaciones · {num(summary.capacityUnits)} u.</strong><span>{dirty ? 'Cambios sin guardar' : 'Configura tu bodega a tu ritmo'}</span></div><div className="button-row"><Btn onClick={step === 0 ? cancel : () => goTo(step - 1)} disabled={saving}>{step === 0 ? 'Cancelar' : 'Atrás'}</Btn><Btn type="submit" variant="primary" icon={step === 2 ? 'save' : 'arrow'} disabled={saving || (step > 0 && !!layoutError)}>{saving ? 'Guardando…' : step === 0 ? 'Continuar al diseño' : step === 1 ? 'Revisar bodega' : warehouse ? 'Guardar cambios' : 'Crear bodega'}</Btn></div></div>
    </form>
  </div>;
}
