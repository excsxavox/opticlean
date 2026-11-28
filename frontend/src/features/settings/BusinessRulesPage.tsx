import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import {
  DEFAULT_BUSINESS_RULES,
  createShippingTemplate,
  ensureShippingTemplates,
  estimateRouteCost,
  estimateRouteEtaHours,
  estimateRouteKm,
  resolveBusinessRules,
} from '../../shared/lib/businessRules';
import { money } from '../../shared/lib/inventory';
import { Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import type { BusinessRules, ShippingCostTemplate } from '../../shared/types';
import { PackingBoxesEditor } from './PackingBoxesEditor';
import '../../styles/business-rules.css';
import { Switch } from '../../shared/components/Checkbox';
import { Input } from '../../shared/components/Input';

type Draft = BusinessRules;

function num(v: FormDataEntryValue | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function BusinessRulesPage() {
  const { state, applyResponse, toast } = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewStops, setPreviewStops] = useState(5);
  const [previewRouteKm, setPreviewRouteKm] = useState(62);
  const [previewCostPerKm, setPreviewCostPerKm] = useState(0.85);
  const [previewEta, setPreviewEta] = useState(3.33);

  const rules = resolveBusinessRules(state?.settings);
  const ensured = ensureShippingTemplates(state?.settings);
  const [draft, setDraft] = useState<Draft>(rules);
  const [templates, setTemplates] = useState<ShippingCostTemplate[]>(ensured.templates);
  const [defaultTplId, setDefaultTplId] = useState(ensured.defaultId);
  const [selectedTplId, setSelectedTplId] = useState(ensured.defaultId);

  useEffect(() => {
    const nextRules = resolveBusinessRules(state?.settings);
    const nextTpl = ensureShippingTemplates(state?.settings);
    setDraft(nextRules);
    setTemplates(nextTpl.templates);
    setDefaultTplId(nextTpl.defaultId);
    setSelectedTplId((prev) =>
      nextTpl.templates.some((t) => t.id === prev) ? prev : nextTpl.defaultId,
    );
  }, [state?.settings]);

  const selectedTpl =
    templates.find((t) => t.id === selectedTplId) ??
    templates[0] ??
    createShippingTemplate('Estándar');

  const preview = useMemo(() => {
    const km = estimateRouteKm(previewRouteKm, previewStops, selectedTpl);
    const cost = estimateRouteCost(km, previewCostPerKm);
    const eta = estimateRouteEtaHours(previewEta, previewStops, selectedTpl);
    return { km, cost, eta };
  }, [selectedTpl, previewStops, previewRouteKm, previewCostPerKm, previewEta]);

  if (!state) return null;

  const setField = (key: keyof Draft, value: number) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const setFlag = (key: keyof Draft, value: boolean) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const patchSelectedTpl = (patch: Partial<ShippingCostTemplate>) => {
    setTemplates((list) => list.map((t) => (t.id === selectedTpl.id ? { ...t, ...patch } : t)));
  };

  const addTemplate = () => {
    const base = selectedTpl;
    const tpl = createShippingTemplate(`Plantilla ${templates.length + 1}`, base);
    setTemplates((list) => [...list, tpl]);
    setSelectedTplId(tpl.id);
  };

  const removeTemplate = () => {
    if (templates.length <= 1) {
      setError('Debe quedar al menos una plantilla.');
      return;
    }
    if (!window.confirm(`¿Eliminar la plantilla «${selectedTpl.name}»?`)) return;
    const next = templates.filter((t) => t.id !== selectedTpl.id);
    setTemplates(next);
    const nextDefault = defaultTplId === selectedTpl.id ? next[0].id : defaultTplId;
    setDefaultTplId(nextDefault);
    setSelectedTplId(next[0].id);
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = new FormData(e.currentTarget);
    const cleaned = templates.map((t) => ({
      ...t,
      name: t.name.trim() || 'Sin nombre',
      shippingMinKm: Math.max(0, t.shippingMinKm),
      shippingStopsDivisor: Math.max(1, t.shippingStopsDivisor),
      shippingEtaBaseFactor: Math.max(0, t.shippingEtaBaseFactor),
      shippingEtaPerStop: Math.max(0, t.shippingEtaPerStop),
    }));
    if (!cleaned.length) {
      setError('Agrega al menos una plantilla de costo de envío.');
      setBusy(false);
      return;
    }
    const defId = cleaned.some((t) => t.id === defaultTplId) ? defaultTplId : cleaned[0].id;
    const def = cleaned.find((t) => t.id === defId) ?? cleaned[0];
    const next: BusinessRules = {
      shippingMinKm: def.shippingMinKm,
      shippingStopsDivisor: def.shippingStopsDivisor,
      shippingEtaBaseFactor: def.shippingEtaBaseFactor,
      shippingEtaPerStop: def.shippingEtaPerStop,
      assignCostReference: num(data.get('assignCostReference'), draft.assignCostReference),
      assignCostWeight: Math.max(0, num(data.get('assignCostWeight'), draft.assignCostWeight)),
      assignIdealFillMax: Math.min(
        1,
        Math.max(0.1, num(data.get('assignIdealFillMax'), draft.assignIdealFillMax)),
      ),
      assignNearFullFill: Math.min(
        1,
        Math.max(0.1, num(data.get('assignNearFullFill'), draft.assignNearFullFill)),
      ),
      creditOkMaxPct: Math.min(
        100,
        Math.max(1, num(data.get('creditOkMaxPct'), draft.creditOkMaxPct)),
      ),
      creditTightMaxPct: Math.min(
        100,
        Math.max(1, num(data.get('creditTightMaxPct'), draft.creditTightMaxPct)),
      ),
      defaultCreditLimit: Math.max(
        0,
        num(data.get('defaultCreditLimit'), draft.defaultCreditLimit),
      ),
      separateExpiryLots: draft.separateExpiryLots,
      packTolerancePct: Math.min(
        50,
        Math.max(1, num(data.get('packTolerancePct'), draft.packTolerancePct)),
      ),
      loadMinFillPct: Math.min(
        100,
        Math.max(0, num(data.get('loadMinFillPct'), draft.loadMinFillPct)),
      ),
      requirePackingBeforeDispatch: draft.requirePackingBeforeDispatch,
    };
    if (next.creditOkMaxPct >= next.creditTightMaxPct) {
      setError('El umbral “cupo holgado” debe ser menor que “cupo ajustado”.');
      setBusy(false);
      return;
    }
    if (next.assignIdealFillMax >= next.assignNearFullFill) {
      setError('La ocupación ideal debe ser menor que la ocupación casi llena.');
      setBusy(false);
      return;
    }
    try {
      const res = await api.updateSettings({
        businessRules: next,
        shippingTemplates: cleaned,
        defaultShippingTemplateId: defId,
      });
      applyResponse(res);
      toast('Reglas de negocio guardadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const applyToFleet = async () => {
    if (busy) return;
    if (
      !window.confirm(
        `¿Asignar la plantilla «${selectedTpl.name}» a todos los vehículos de la flota?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Guarda primero para que la plantilla exista en settings
      const cleaned = templates.map((t) => ({
        ...t,
        name: t.name.trim() || 'Sin nombre',
      }));
      const defId = cleaned.some((t) => t.id === defaultTplId) ? defaultTplId : cleaned[0].id;
      const def = cleaned.find((t) => t.id === defId) ?? cleaned[0];
      const res = await api.updateSettings({
        businessRules: {
          ...draft,
          shippingMinKm: def.shippingMinKm,
          shippingStopsDivisor: def.shippingStopsDivisor,
          shippingEtaBaseFactor: def.shippingEtaBaseFactor,
          shippingEtaPerStop: def.shippingEtaPerStop,
        },
        shippingTemplates: cleaned,
        defaultShippingTemplateId: defId,
      });
      applyResponse(res);
      const applied = await api.applyShippingTemplateToFleet({ templateId: selectedTpl.id });
      toast(`Plantilla aplicada a ${applied.updated} vehículo(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar a la flota');
    } finally {
      setBusy(false);
    }
  };

  const restoreDefaults = () => {
    const tpl = createShippingTemplate('Estándar', DEFAULT_BUSINESS_RULES);
    tpl.id = 'ship-default';
    setTemplates([tpl]);
    setDefaultTplId(tpl.id);
    setSelectedTplId(tpl.id);
    setDraft({ ...DEFAULT_BUSINESS_RULES });
    toast('Valores por defecto cargados. Guarda para aplicarlos.');
  };

  return (
    <div className="br-page">
      <PageHead
        eyebrow="Gestión"
        title="Reglas de negocio"
        desc="Parametriza el cálculo de costo de envío, la asignación de flota y los umbrales de crédito."
        actions={
          <Btn icon="refresh" onClick={restoreDefaults}>
            Restaurar defaults
          </Btn>
        }
      />

      <form className="br-layout" onSubmit={(e) => void save(e)}>
        <div className="br-main">
          <section className="br-card">
            <header className="br-card-head">
              <Icon name="truck" />
              <div>
                <h2>Costo de envío · plantillas</h2>
                <p>
                  Crea plantillas con la fórmula de km/ETA y asígnalas a la flota. El{' '}
                  <strong>$/km</strong> sigue configurándose por vehículo.
                </p>
              </div>
            </header>

            <div className="br-tpl-bar">
              <div className="br-tpl-list" role="list">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="listitem"
                    className={`br-tpl-chip${t.id === selectedTpl.id ? ' is-on' : ''}`}
                    onClick={() => setSelectedTplId(t.id)}
                  >
                    {t.name}
                    {t.id === defaultTplId ? <em>default</em> : null}
                  </button>
                ))}
              </div>
              <div className="br-tpl-actions">
                <Btn type="button" icon="plus" onClick={addTemplate}>
                  Nueva
                </Btn>
                <Btn type="button" onClick={() => setDefaultTplId(selectedTpl.id)}>
                  Marcar default
                </Btn>
                <Btn type="button" onClick={() => void applyToFleet()} disabled={busy}>
                  Aplicar a flota
                </Btn>
                <Btn type="button" onClick={removeTemplate} disabled={templates.length <= 1}>
                  Eliminar
                </Btn>
              </div>
            </div>

            <p className="br-formula">
              Fórmula:{' '}
              <code>km = max(mínimo, round(rutaBase × paradas / max(divisor, paradas)))</code>
              {' · '}
              <code>costo = km × $/km del vehículo</code>
            </p>

            <div className="br-grid">
              <label className="field">
                <span>Nombre de la plantilla</span>
                <input
                  type="text"
                  value={selectedTpl.name}
                  onChange={(e) => patchSelectedTpl({ name: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Km mínimos por ruta</span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={selectedTpl.shippingMinKm}
                  onChange={(e) => patchSelectedTpl({ shippingMinKm: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Divisor de paradas</span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={selectedTpl.shippingStopsDivisor}
                  onChange={(e) =>
                    patchSelectedTpl({ shippingStopsDivisor: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Factor base ETA</span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={selectedTpl.shippingEtaBaseFactor}
                  onChange={(e) =>
                    patchSelectedTpl({ shippingEtaBaseFactor: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>ETA extra por parada</span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={selectedTpl.shippingEtaPerStop}
                  onChange={(e) => patchSelectedTpl({ shippingEtaPerStop: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="br-note">
              La plantilla <strong>default</strong> se usa cuando un vehículo no tiene una asignada.
              En Logística → flota puedes elegir la plantilla por camión, o usar «Aplicar a flota»
              aquí.
            </p>
          </section>

          <section className="br-card">
            <header className="br-card-head">
              <Icon name="spark" />
              <div>
                <h2>Asignación automática de flota</h2>
                <p>
                  Score de costo: <code>(referencia − $/km) × peso</code>. También umbrales de
                  ocupación al preferir camiones.
                </p>
              </div>
            </header>
            <div className="br-grid">
              <label className="field">
                <span>Referencia de costo ($/km)</span>
                <Input
                  name="assignCostReference"
                  type="number"
                  min={0}
                  step={0.05}
                  value={draft.assignCostReference}
                  onChange={(e) => setField('assignCostReference', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Peso del costo en el score</span>
                <Input
                  name="assignCostWeight"
                  type="number"
                  min={0}
                  step={1}
                  value={draft.assignCostWeight}
                  onChange={(e) => setField('assignCostWeight', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Ocupación ideal máx. (0–1)</span>
                <Input
                  name="assignIdealFillMax"
                  type="number"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={draft.assignIdealFillMax}
                  onChange={(e) => setField('assignIdealFillMax', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Ocupación casi llena (0–1)</span>
                <Input
                  name="assignNearFullFill"
                  type="number"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={draft.assignNearFullFill}
                  onChange={(e) => setField('assignNearFullFill', Number(e.target.value))}
                />
              </label>
            </div>
          </section>

          <section className="br-card">
            <header className="br-card-head">
              <Icon name="users" />
              <div>
                <h2>Crédito de clientes</h2>
                <p>Umbrales del directorio y límite sugerido al crear un cliente nuevo.</p>
              </div>
            </header>
            <div className="br-grid">
              <label className="field">
                <span>Cupo holgado hasta (%)</span>
                <Input
                  name="creditOkMaxPct"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft.creditOkMaxPct}
                  onChange={(e) => setField('creditOkMaxPct', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Cupo ajustado desde (%)</span>
                <Input
                  name="creditTightMaxPct"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft.creditTightMaxPct}
                  onChange={(e) => setField('creditTightMaxPct', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Límite de crédito por defecto (USD)</span>
                <Input
                  name="defaultCreditLimit"
                  type="number"
                  min={0}
                  step={50}
                  value={draft.defaultCreditLimit}
                  onChange={(e) => setField('defaultCreditLimit', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Un lote por casilla</span>
                <Switch
                  name="separateExpiryLots"
                  checked={draft.separateExpiryLots}
                  onCheckedChange={(checked) => setFlag('separateExpiryLots', checked)}
                />
              </label>
              <label className="field">
                <span>Tolerancia de peso por bulto (%)</span>
                <Input
                  name="packTolerancePct"
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={draft.packTolerancePct}
                  onChange={(e) => setField('packTolerancePct', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Llenado mínimo del camión (%)</span>
                <Input
                  name="loadMinFillPct"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={draft.loadMinFillPct}
                  onChange={(e) => setField('loadMinFillPct', Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>El despacho exige empaque cerrado</span>
                <Switch
                  name="requirePackingBeforeDispatch"
                  checked={draft.requirePackingBeforeDispatch}
                  onCheckedChange={(checked) => setFlag('requirePackingBeforeDispatch', checked)}
                />
              </label>
            </div>
          </section>

          {error ? <div className="form-error visible">{error}</div> : null}

          <div className="br-actions">
            <Btn type="submit" variant="primary" icon="save" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar reglas'}
            </Btn>
          </div>
        </div>

        <aside className="br-side">
          <section className="br-card">
            <h3>Simulador · {selectedTpl.name}</h3>
            <p className="br-side-desc">Prueba la fórmula con la plantilla seleccionada.</p>
            <label className="field">
              <span>Paradas</span>
              <Input
                type="number"
                min={1}
                value={previewStops}
                onChange={(e) => setPreviewStops(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="field">
              <span>Ruta base del vehículo (km)</span>
              <Input
                type="number"
                min={1}
                value={previewRouteKm}
                onChange={(e) => setPreviewRouteKm(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="field">
              <span>$/km del vehículo</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={previewCostPerKm}
                onChange={(e) => setPreviewCostPerKm(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="field">
              <span>ETA base (h)</span>
              <Input
                type="number"
                min={0.1}
                step="any"
                value={previewEta}
                onChange={(e) => setPreviewEta(Math.max(0.1, Number(e.target.value) || 0.1))}
              />
            </label>
            <dl className="br-preview">
              <div>
                <dt>Km estimados</dt>
                <dd>{preview.km} km</dd>
              </div>
              <div>
                <dt>Costo estimado</dt>
                <dd>{money(preview.cost)}</dd>
              </div>
              <div>
                <dt>Tiempo estimado</dt>
                <dd>{preview.eta.toFixed(2)} h</dd>
              </div>
            </dl>
          </section>

          <section className="br-card br-help">
            <h3>Cómo usarlo en flota</h3>
            <ul>
              <li>
                <strong>Aquí:</strong> defines plantillas (urbana, larga distancia, etc.).
              </li>
              <li>
                <strong>Flota:</strong> cada vehículo elige una plantilla, o usas «Aplicar a flota».
              </li>
              <li>
                <strong>$/km:</strong> se configura por vehículo (Costo real / ficha).
              </li>
            </ul>
          </section>
        </aside>
      </form>

      <PackingBoxesEditor />
    </div>
  );
}
