import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '../../shared/components/Select';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, available, product, qtyAt, stock } from '../../shared/lib/inventory';
import { buildWarehouseGeometry, faceLabel, normalizeLayout } from '../../shared/lib/warehouseLayout';
import { Btn, PageHead, cx } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal } from '../../shared/components/Modal';
import { WarehouseEmbed } from '../warehouse/WarehouseEmbed';
import { RECEIPT_REASONS, type Location } from '../../shared/types';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { packsOf, pendingUnits, purchaseIncludes } from '../../shared/lib/wholesale';
import '../../styles/warehouse-positioning.css';
import '../../styles/reception.css';

const steps = [
  { title: 'Producto', subtitle: 'Qué llega y de quién' },
  { title: 'Cantidad y lote', subtitle: 'Empaques y vencimiento' },
  { title: 'Ubicación', subtitle: 'Dónde se guarda' },
  { title: 'Confirmar', subtitle: 'Revisar y registrar' },
];

const expiryLabel = (d: string) =>
  d
    ? new Date(`${d}T12:00:00`).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Sin fecha';

/** Registro de una recepción en cuatro pasos, con resumen lateral. */
export function ReceptionNewPage() {
  const { state, meta, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState =
    (location.state as { loc?: string; productId?: string; purchaseId?: string; qty?: number } | null) ?? {};
  const prefillLoc = routeState.loc;
  const [step, setStep] = useState(0);
  const [productId, setProductId] = useState(routeState.productId ?? state?.products[0]?.id ?? '');
  const [qty, setQty] = useState(routeState.qty && routeState.qty > 0 ? routeState.qty : 1);
  const [packCode, setPackCode] = useState('unidad');
  const [purchaseId, setPurchaseId] = useState(routeState.purchaseId ?? '');
  const openPurchases = (state?.purchases ?? []).filter(
    (p) => purchaseIncludes(p, productId) && (!p.status || p.status === 'Abierta' || p.status === 'Parcial'),
  );
  const [supplier, setSupplier] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [reason, setReason] = useState('');
  const [inspect, setInspect] = useState(false);
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [showAllLocs, setShowAllLocs] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPick, setMapPick] = useState('');
  const saveLock = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const warehouseId = state ? activeWarehouseId(state) : '';
  const warehouse = state?.warehouses.find((item) => item.id === warehouseId);
  const layout = useMemo(() => normalizeLayout(warehouse?.layout), [warehouse?.layout]);
  const geo = useMemo(() => buildWarehouseGeometry(layout), [layout]);
  const mapLocations = meta?.locations?.length ? meta.locations : geo.locations;
  const mapFocus = mapPick || selectedLoc;
  const selected =
    suggestions.find((item) => item.id === selectedLoc) ??
    mapLocations.find((item) => item.id === selectedLoc);
  const capacity = layout.capacityPerCell;
  const selectedProduct = state ? product(state, productId) : undefined;
  const packs = packsOf(selectedProduct);
  const pack = packs.find((item) => item.code === packCode) ?? packs[0];
  const stockQty = Math.round(qty * (pack?.units ?? 1));
  const validQty = Number.isInteger(qty) && qty > 0 && Number.isInteger(stockQty) && stockQty > 0 && stockQty <= capacity;
  const [suggestionKey, setSuggestionKey] = useState('');
  const currentKey = `${warehouseId}:${productId}:${stockQty}`;
  const ready = !loading && suggestionKey === currentKey && validQty;
  const visibleSuggestions = showAllLocs ? suggestions : suggestions.slice(0, 4);
  const hiddenCount = Math.max(0, suggestions.length - 4);
  const purchase = state?.purchases.find((p) => p.id === purchaseId);

  useEffect(() => {
    if (!selectedProduct) return;
    setSupplier(selectedProduct.supplier);
    setInspect(!!selectedProduct.inspectOnReceipt);
  }, [selectedProduct?.id, selectedProduct?.supplier, selectedProduct?.inspectOnReceipt]);

  const purchaseSupplier = state?.suppliers?.find((s) => s.id === purchase?.supplierId)?.name;
  useEffect(() => {
    if (purchaseSupplier) setSupplier(purchaseSupplier);
  }, [purchase?.id, purchaseSupplier]);

  useEffect(() => {
    if (!productId || !validQty) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLookupError('');
    void api
      .suggest(productId, stockQty)
      .then((opts) => {
        if (cancelled) return;
        setSuggestions(opts);
        setSelectedLoc((current) =>
          opts.some((l) => l.id === current)
            ? current
            : prefillLoc && opts.some((l) => l.id === prefillLoc)
              ? prefillLoc
              : (opts[0]?.id ?? ''),
        );
        setSuggestionKey(currentKey);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSuggestions([]);
        setLoading(false);
        setLookupError(err instanceof Error ? err.message : 'No se pudieron consultar las ubicaciones.');
      });
    return () => {
      cancelled = true;
    };
  }, [productId, stockQty, prefillLoc, validQty, currentKey, attempt, state?.lots]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  if (!state) return null;

  const occupiedNow = selected ? qtyAt(state, selected.id) : 0;
  const occupiedAfter = selected ? occupiedNow + stockQty : 0;
  const freeNow = selected ? selected.capacity - occupiedNow : 0;
  const fillNow = selected ? Math.min(100, Math.round((occupiedNow / selected.capacity) * 100)) : 0;
  const fillAfter = selected ? Math.min(100, Math.round((occupiedAfter / selected.capacity) * 100)) : 0;
  const todayIso = new Date().toISOString().slice(0, 10);

  const expires = selectedProduct?.perishable !== false;
  const stepValid = [
    !!productId && supplier.trim().length > 0 && (!!purchaseId || (isAdmin && !!reason)),
    validQty && batch.trim().length > 0 && (!expires || (!!expiry && expiry >= todayIso)),
    ready && !!selected && !lookupError && freeNow >= stockQty,
    true,
  ];
  const canSubmit = !saving && stepValid.every(Boolean);
  // Primer paso incompleto: no se puede avanzar más allá de él.
  const firstInvalid = stepValid.findIndex((ok) => !ok);
  const maxReachable = firstInvalid === -1 ? steps.length - 1 : firstInvalid;

  const goTo = (index: number) => {
    if (index <= maxReachable) setStep(index);
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step < steps.length - 1) {
      if (stepValid[step]) setStep(step + 1);
      return;
    }
    if (saveLock.current || !canSubmit || !selected) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const res = await api.receive({
        productId,
        qty: stockQty,
        packCode: pack?.code ?? 'unidad',
        packQty: qty,
        loc: selectedLoc,
        batch: batch.trim(),
        expiry,
        supplier,
        purchaseId: purchaseId || undefined,
        reason: purchaseId ? undefined : reason,
        inspect,
      });
      applyResponse(res);
      const newId = res.state?.receipts?.[0]?.id;
      toast(
        purchaseId
          ? `Recepción registrada contra ${purchaseId}: ${stockQty} u. en ${selectedLoc}.`
          : `Recepción registrada: ${stockQty} u. en ${selectedLoc}.`,
      );
      navigate('/recepcion', { state: { highlight: newId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la recepción.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const checks = [
    { label: 'Producto y proveedor', ok: stepValid[0] },
    { label: expires ? 'Cantidad, lote y vencimiento' : 'Cantidad y lote', ok: stepValid[1] },
    { label: 'Ubicación con espacio', ok: step >= 2 && stepValid[2] },
  ];

  const review: Array<{ k: string; v: React.ReactNode; step: number }> = [
    { k: 'Producto', v: `${productId} · ${selectedProduct?.name ?? ''}`, step: 0 },
    { k: 'Orden de compra', v: purchaseId || `Sin orden de compra · ${reason || 'falta motivo'}`, step: 0 },
    { k: 'Inspección', v: inspect ? 'Queda retenido hasta liberarlo' : 'Disponible al registrar', step: 1 },
    { k: 'Proveedor', v: supplier, step: 0 },
    {
      k: 'Cantidad',
      v: `${qty} × ${pack?.label ?? 'Unidad'} (${pack?.units ?? 1} u.) = ${stockQty} u.`,
      step: 1,
    },
    { k: 'Lote', v: batch.trim(), step: 1 },
    { k: 'Vencimiento', v: expiryLabel(expiry), step: 1 },
    {
      k: 'Ubicación',
      v: selected
        ? `${selected.id} · Rack ${selected.rack} · Nivel ${selected.level} · Pos ${selected.pos}${
            selected.face ? ` · ${faceLabel(selected.face)}` : ''
          }`
        : '—',
      step: 2,
    },
  ];

  return (
    <div className="reception-page">
      <PageHead
        eyebrow="Ingreso de mercadería"
        title="Registrar recepción"
        desc="Completa los pasos y confirma el ingreso a bodega."
        actions={
          <Btn icon="arrow" onClick={() => navigate('/recepcion')}>
            Ver recepciones
          </Btn>
        }
      />

      <nav className="panel reception-stepper" aria-label="Pasos de la recepción">
        <ol>
          {steps.map((item, index) => {
            const status = index === step ? 'current' : index < step ? 'done' : 'todo';
            return (
              <li key={item.title} className={`reception-step is-${status}`}>
                <button
                  type="button"
                  onClick={() => goTo(index)}
                  disabled={saving || index > maxReachable}
                  aria-current={index === step ? 'step' : undefined}
                >
                  <span className="reception-step-dot" aria-hidden="true">
                    {status === 'done' ? <Icon name="check" /> : index + 1}
                  </span>
                  <span className="reception-step-text">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form className="reception-layout" id="receive-form" onSubmit={onSubmit} noValidate>
        <div className="panel reception-form">
          <fieldset className="transfer-fields" disabled={saving}>
            <div className="form-section reception-step-panel" key={step}>
              <h3 ref={headingRef} tabIndex={-1}>
                <Icon name={['box', 'receive', 'pin', 'check'][step]} />
                {['¿Qué producto llega?', 'Cantidad recibida', 'Elige dónde se guarda', 'Revisa antes de registrar'][step]}
              </h3>

              {step === 0 ? (
                <>
                  <p className="section-note">Si llega con orden de compra, elígela y se completa el proveedor.</p>
                  <div className="form-grid">
                    <div className="field full">
                      <label htmlFor="rec-product">Producto</label>
                      <Select
                        id="rec-product"
                        value={productId}
                        onChange={(e) => {
                          setProductId(e.target.value);
                          setPackCode('unidad');
                          setPurchaseId('');
                        }}
                      >
                        {state.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.id} · {p.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="field">
                      <label htmlFor="rec-po">Orden de compra</label>
                      <Select id="rec-po" value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
                        <option value="">Sin orden de compra</option>
                        {openPurchases.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.id} · pendiente {pendingUnits(p, productId)} u.
                          </option>
                        ))}
                      </Select>
                      {!openPurchases.length ? <small>No hay órdenes abiertas para este producto.</small> : null}
                    </div>
                    {!purchaseId ? (
                      <div className="field">
                        <label htmlFor="rec-reason">Motivo del ingreso sin orden</label>
                        <Select id="rec-reason" value={reason} disabled={!isAdmin} onChange={(e) => setReason(e.target.value)}>
                          <option value="">Elegir motivo…</option>
                          {RECEIPT_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </Select>
                        <small>
                          {isAdmin
                            ? 'Todo ingreso sin orden de compra queda registrado con su motivo.'
                            : 'Elige la orden de compra. Ingresar sin orden requiere administración.'}
                        </small>
                      </div>
                    ) : null}
                    <div className="field">
                      <label htmlFor="rec-supplier">Proveedor</label>
                      <input
                        id="rec-supplier"
                        value={supplier}
                        onChange={(e) => setSupplier(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <p className="section-note">Cuenta los empaques físicos. Las unidades de stock se calculan solas.</p>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="rec-pack">Empaque recibido</label>
                      <Select
                        id="rec-pack"
                        value={pack?.code ?? 'unidad'}
                        onChange={(e) => setPackCode(e.target.value)}
                      >
                        {packs.map((item) => (
                          <option key={item.code} value={item.code}>
                            {item.label} · {item.units} {item.units === 1 ? 'unidad' : 'unidades'}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="field">
                      <label htmlFor="rec-qty">Cantidad de empaques</label>
                      <input
                        id="rec-qty"
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={qty}
                        onChange={(e) => setQty(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className={cx('reception-calc', !validQty && 'is-error')}>
                      {validQty ? (
                        <>
                          <span>
                            {qty} × {(pack?.label ?? 'unidad').toLowerCase()} de {pack?.units ?? 1}
                          </span>
                          <span>
                            = <strong>{stockQty} unidades</strong> de stock
                          </span>
                          <span>
                            Stock después: <strong>{stock(state, productId) + stockQty} u.</strong>
                          </span>
                        </>
                      ) : stockQty > capacity ? (
                        <span>
                          {stockQty} u. supera la capacidad de una casilla ({capacity} u.). Registra la recepción en
                          partes.
                        </span>
                      ) : (
                        <span>Ingresa una cantidad entera mayor a cero.</span>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="rec-batch">Lote</label>
                      <input
                        id="rec-batch"
                        value={batch}
                        onChange={(e) => setBatch(e.target.value)}
                        placeholder="Ej. LT-261027"
                        required
                      />
                      <small>Tal como aparece en la etiqueta del proveedor.</small>
                    </div>
                    <div className="field">
                      <label htmlFor="rec-expiry">{expires ? 'Vencimiento' : 'Vencimiento (no caduca)'}</label>
                      <input
                        id="rec-expiry"
                        type="date"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                        min={todayIso}
                        required={expires}
                      />
                      <small>{expires ? 'Se despacha primero lo que vence antes.' : 'Este producto no caduca. La fecha queda vacía.'}</small>
                    </div>
                    <div className="field">
                      <label htmlFor="rec-inspect" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input id="rec-inspect" type="checkbox" checked={inspect} onChange={(e) => setInspect(e.target.checked)} />
                        Recibir a inspección de calidad
                      </label>
                      <small>El lote queda retenido y no se vende hasta que administración lo libere.</small>
                    </div>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <p className="section-note">
                    {loading
                      ? 'Buscando casillas compatibles…'
                      : ready
                        ? `${suggestions.length} ubicaciones con espacio para ${stockQty} u. La primera es la sugerida.`
                        : 'Vuelve al paso anterior e indica una cantidad válida.'}
                  </p>

                  {ready && prefillLoc && !suggestions.some((item) => item.id === prefillLoc) ? (
                    <p className="wh-notice" role="status">
                      La ubicación {prefillLoc} no admite este producto o cantidad. Elige otra opción.
                    </p>
                  ) : null}
                  {lookupError ? (
                    <div className="wh-error" role="alert">
                      {lookupError} <Btn onClick={() => setAttempt((value) => value + 1)}>Reintentar</Btn>
                    </div>
                  ) : null}
                  {ready && !suggestions.length && !lookupError ? (
                    <p className="positioning-empty" role="status">
                      No hay ubicaciones compatibles. Reduce la cantidad o libera espacio.
                    </p>
                  ) : null}

                  {ready && visibleSuggestions.length ? (
                    <div className="reception-loc-list" role="radiogroup" aria-label="Ubicaciones compatibles">
                      {visibleSuggestions.map((l, index) => {
                        const used = qtyAt(state, l.id);
                        const free = l.capacity - used;
                        const active = l.id === selectedLoc;
                        return (
                          <button
                            key={l.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`reception-loc-row${active ? ' is-active' : ''}`}
                            onClick={() => setSelectedLoc(l.id)}
                          >
                            <div className="loc-main">
                              <div className="loc-id">
                                {l.id}
                                {index === 0 ? <span className="loc-tag">Sugerida</span> : null}
                              </div>
                              <div className="loc-detail">
                                Rack {l.rack} · Nivel {l.level} · Posición {l.pos}
                                {l.face ? ` · ${faceLabel(l.face)}` : ''}
                              </div>
                            </div>
                            <div className="loc-free">
                              {free} libres
                              <small>de {l.capacity} u.</small>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="reception-loc-tools">
                    {hiddenCount ? (
                      <Btn variant="ghost" onClick={() => setShowAllLocs((v) => !v)}>
                        {showAllLocs ? 'Ver menos' : `Ver ${hiddenCount} ubicaciones más`}
                      </Btn>
                    ) : null}
                    {selected ? (
                      <Btn
                        variant="ghost"
                        icon="warehouse"
                        onClick={() => {
                          setMapPick(selected.id);
                          setMapOpen(true);
                        }}
                      >
                        Elegir en el mapa
                      </Btn>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <p className="section-note">Al confirmar se suma al inventario y queda la trazabilidad del lote.</p>
                  <dl className="reception-review">
                    {review.map((row) => (
                      <div key={row.k}>
                        <dt>{row.k}</dt>
                        <dd>
                          <span>{row.v}</span>
                          <button type="button" className="reception-edit" onClick={() => setStep(row.step)}>
                            Editar
                          </button>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}

              {error ? (
                <div className="form-error visible" role="alert" style={{ marginTop: 12 }}>
                  {error}
                </div>
              ) : null}
            </div>

            <div className="reception-step-actions">
              {step > 0 ? (
                <Btn icon="back" onClick={() => setStep(step - 1)}>
                  Anterior
                </Btn>
              ) : (
                <Btn variant="ghost" onClick={() => navigate('/recepcion')}>
                  Cancelar
                </Btn>
              )}
              {step < steps.length - 1 ? (
                <button type="submit" className="btn primary" disabled={!stepValid[step]}>
                  Siguiente
                </button>
              ) : (
                <button type="submit" className="btn primary" disabled={!canSubmit}>
                  <Icon name="check" />
                  {saving ? 'Registrando…' : 'Confirmar recepción'}
                </button>
              )}
            </div>
          </fieldset>
        </div>

        <aside className="reception-side">
          <section className="panel reception-confirm">
            <div className="reception-confirm-head">
              <div className="eyebrow">Resumen</div>
              <h2>{selectedProduct?.name ?? 'Selecciona un producto'}</h2>
              <p>
                {selectedProduct?.id}
                {selectedProduct?.category ? ` · ${selectedProduct.category}` : ''}
                {warehouse ? ` · ${warehouse.name}` : ''}
              </p>
            </div>

            <div className="reception-confirm-body">
              <div className="reception-metric-row">
                <div className="reception-metric">
                  <span>Ingresa</span>
                  <strong>
                    {validQty ? stockQty : 0}
                    <small>u.</small>
                  </strong>
                </div>
                <div className="reception-metric">
                  <span>Stock</span>
                  <strong>
                    {stock(state, productId)}
                    <small>u.</small>
                  </strong>
                </div>
                <div className="reception-metric">
                  <span>Disponible</span>
                  <strong>
                    {available(state, productId)}
                    <small>u.</small>
                  </strong>
                </div>
              </div>

              {step >= 2 && ready && selected ? (
                <div className="reception-dest">
                  <div className="dest-label">Ubicación seleccionada</div>
                  <div className="dest-code">{selected.id}</div>
                  <div className="dest-path">
                    <span>Rack {selected.rack}</span>
                    <span>Nivel {selected.level}</span>
                    <span>Pos {selected.pos}</span>
                    {selected.face ? <span className="face">{faceLabel(selected.face)}</span> : null}
                  </div>
                  <div className="reception-fill">
                    <div className="reception-fill-head">
                      <span>
                        {occupiedNow} → {occupiedAfter} / {selected.capacity} u.
                      </span>
                      <span>{fillAfter}%</span>
                    </div>
                    <div className="reception-fill-track" aria-hidden>
                      <i className="next" style={{ width: `${fillAfter}%` }} />
                      <i className="now" style={{ width: `${fillNow}%` }} />
                    </div>
                    <p>
                      {freeNow >= stockQty
                        ? `Quedarán ${freeNow - stockQty} libres después de recibir ${stockQty} u.`
                        : 'Esta casilla no tiene espacio suficiente.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="reception-dest empty">La ubicación se elige en el paso 3.</div>
              )}

              <ul className="reception-checks">
                {checks.map((c) => (
                  <li key={c.label} className={c.ok ? 'is-ok' : undefined}>
                    {c.label}
                  </li>
                ))}
              </ul>

              <p className="reception-hint">
                {warehouse ? `${warehouse.name} · ${warehouse.city}` : 'Bodega activa'} · se actualiza inventario y
                trazabilidad
              </p>
            </div>
          </section>
        </aside>
      </form>

      {mapOpen ? (
        <Modal
          wide
          title="Ubicación en bodega"
          subtitle={`${mapFocus} · ${warehouse?.name ?? 'Bodega activa'}`}
          onClose={() => setMapOpen(false)}
          footer={
            <>
              <Btn onClick={() => setMapOpen(false)}>Cerrar</Btn>
              <Btn
                variant="primary"
                icon="check"
                onClick={() => {
                  if (mapFocus) setSelectedLoc(mapFocus);
                  setMapOpen(false);
                }}
              >
                Usar esta ubicación
              </Btn>
            </>
          }
        >
          <div className="reception-map-modal">
            <WarehouseEmbed
              key={mapFocus}
              compact
              mapOnly
              height={500}
              title={`Bodega · ${mapFocus}`}
              focusLoc={mapFocus}
              mode="plan"
              onSelectLoc={(loc) => setMapPick(loc)}
            />
            <p className="reception-map-selected">
              Seleccionada: <strong>{mapFocus}</strong>
              {suggestions.some((s) => s.id === mapFocus) ? <em> · sugerida para este ingreso</em> : null}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
