import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { activeWarehouseId, available, dateShort, product, qtyAt, stock } from '../../shared/lib/inventory';
import { faceLabel, normalizeLayout } from '../../shared/lib/warehouseLayout';
import { Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import type { Location } from '../../shared/types';
import '../../styles/warehouse-positioning.css';
import '../../styles/reception.css';

export function ReceptionPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state as { loc?: string; productId?: string } | null) ?? {};
  const prefillLoc = routeState.loc;
  const [productId, setProductId] = useState(routeState.productId ?? state?.products[0]?.id ?? '');
  const [qty, setQty] = useState(12);
  const [supplier, setSupplier] = useState('');
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const saveLock = useRef(false);

  const selected = suggestions.find((item) => item.id === selectedLoc);
  const warehouseId = state ? activeWarehouseId(state) : '';
  const warehouse = state?.warehouses.find((item) => item.id === warehouseId);
  const capacity = normalizeLayout(warehouse?.layout).capacityPerCell;
  const validQty = Number.isInteger(qty) && qty > 0 && qty <= capacity;
  const [suggestionKey, setSuggestionKey] = useState('');
  const currentKey = `${warehouseId}:${productId}:${qty}`;
  const ready = !loading && suggestionKey === currentKey && validQty;
  const selectedProduct = state ? product(state, productId) : undefined;
  const visibleSuggestions = useMemo(() => suggestions.slice(0, 5), [suggestions]);
  const extraSuggestions = useMemo(() => suggestions.slice(5), [suggestions]);

  useEffect(() => {
    if (!selectedProduct) return;
    setSupplier(selectedProduct.supplier);
  }, [selectedProduct?.id, selectedProduct?.supplier]);

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
      .suggest(productId, qty)
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
  }, [productId, qty, prefillLoc, validQty, currentKey, attempt, state?.lots]);

  if (!state) return null;

  const occupiedNow = selected ? qtyAt(state, selected.id) : 0;
  const occupiedAfter = selected ? occupiedNow + qty : 0;
  const freeNow = selected ? selected.capacity - occupiedNow : 0;
  const fillNow = selected ? Math.min(100, Math.round((occupiedNow / selected.capacity) * 100)) : 0;
  const fillAfter = selected ? Math.min(100, Math.round((occupiedAfter / selected.capacity) * 100)) : 0;
  const canSubmit =
    !saving && ready && !!selected && !lookupError && freeNow >= qty && batch.trim().length > 0 && !!expiry;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saveLock.current || !canSubmit || !selected) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      applyResponse(
        await api.receive({
          productId,
          qty,
          loc: selectedLoc,
          batch: batch.trim(),
          expiry,
          supplier,
        }),
      );
      toast('Recepción registrada.');
      setBatch('');
      setExpiry('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="reception-page">
      <PageHead
        eyebrow="Ingreso de mercadería"
        title="Registrar recepción"
        desc="Completa el lote, elige ubicación y confirma el ingreso."
        actions={
          <Btn icon="arrow" onClick={() => navigate('/inventario')}>
            Ver inventario
          </Btn>
        }
      />

      <form className="reception-layout" id="receive-form" onSubmit={onSubmit}>
        <div className="panel reception-form">
          <fieldset className="transfer-fields" disabled={saving}>
            <div className="form-section">
              <h3>
                <Icon name="box" />
                Datos del ingreso
              </h3>
              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="rec-product">Producto</label>
                  <select id="rec-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                    {state.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} · {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rec-supplier">Proveedor</label>
                  <input
                    id="rec-supplier"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="rec-qty">Cantidad</label>
                  <input
                    id="rec-qty"
                    type="number"
                    min={1}
                    max={capacity}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    required
                  />
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
                </div>
                <div className="field">
                  <label htmlFor="rec-expiry">Vencimiento</label>
                  <input
                    id="rec-expiry"
                    type="date"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>
                <Icon name="pin" />
                Elegir ubicación
              </h3>
              <p className="section-note">
                {loading
                  ? 'Buscando casillas compatibles…'
                  : ready
                    ? `${suggestions.length} ubicaciones compatibles · selecciona una para recibir`
                    : 'Indica una cantidad válida para ver ubicaciones.'}
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
                <div className="reception-loc-list" role="listbox" aria-label="Ubicaciones sugeridas">
                  {visibleSuggestions.map((l, index) => {
                    const free = l.capacity - qtyAt(state, l.id);
                    const active = l.id === selectedLoc;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        role="option"
                        aria-selected={active}
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

              {extraSuggestions.length ? (
                <details className="reception-more">
                  <summary>Ver {extraSuggestions.length} ubicaciones más</summary>
                  <select
                    value={selected?.id ?? ''}
                    onChange={(e) => setSelectedLoc(e.target.value)}
                    aria-label="Más ubicaciones"
                  >
                    {suggestions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.id} · {l.capacity - qtyAt(state, l.id)} libres
                      </option>
                    ))}
                  </select>
                </details>
              ) : null}

              {error ? (
                <div className="form-error visible" role="alert" style={{ marginTop: 12 }}>
                  {error}
                </div>
              ) : null}
            </div>
          </fieldset>
        </div>

        <aside className="reception-side">
          <section className="panel reception-confirm">
            <div className="reception-confirm-head">
              <div className="eyebrow">Resumen para confirmar</div>
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
                  <span>Cantidad</span>
                  <strong>
                    {qty}
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

              {ready && selected ? (
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
                      {freeNow >= qty
                        ? `Quedarán ${freeNow - qty} libres después de recibir ${qty} u.`
                        : 'Esta casilla no tiene espacio suficiente.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="reception-dest empty">
                  Elige una ubicación a la izquierda para ver capacidad y confirmar el ingreso.
                </div>
              )}

              <div className="reception-actions">
                <button type="submit" className="btn primary" disabled={!canSubmit}>
                  <Icon name="check" />
                  {saving ? 'Registrando…' : 'Confirmar recepción'}
                </button>
                {selected ? (
                  <Btn variant="ghost" icon="warehouse" onClick={() => navigate('/bodega', { state: { loc: selected.id } })}>
                    Ver ubicación en mapa
                  </Btn>
                ) : null}
                <p className="hint">
                  {warehouse ? `${warehouse.name} · ${warehouse.city}` : 'Bodega activa'} · se actualiza inventario y
                  trazabilidad
                </p>
              </div>
            </div>
          </section>

          <section className="panel reception-history">
            <div className="panel-head">
              <span className="panel-title">Últimas recepciones</span>
              <Btn variant="ghost" icon="history" onClick={() => navigate('/trazabilidad')}>
                Ver
              </Btn>
            </div>
            <div className="panel-body">
              {state.receipts.length ? (
                state.receipts.slice(0, 4).map((r) => (
                  <div className="reception-history-item" key={r.id}>
                    <span className="product-icon">
                      <Icon name="receive" />
                    </span>
                    <div>
                      <strong>{r.id}</strong>
                      <small>
                        {product(state, r.productId)?.name}
                        <br />
                        {r.qty} u. · {r.loc}
                      </small>
                    </div>
                    <span className="when">{dateShort(r.date)}</span>
                  </div>
                ))
              ) : (
                <div className="reception-history-empty">Sin recepciones recientes.</div>
              )}
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}
