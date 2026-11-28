import type { BusinessRules, Settings, ShippingCostTemplate } from './types.js';

/** Valores actuales hardcodeados en logística / crédito / asignación. */
export const DEFAULT_BUSINESS_RULES: BusinessRules = {
  shippingMinKm: 8,
  shippingStopsDivisor: 3,
  shippingEtaBaseFactor: 0.55,
  shippingEtaPerStop: 0.12,
  assignCostReference: 1.2,
  assignCostWeight: 25,
  assignIdealFillMax: 0.85,
  assignNearFullFill: 0.95,
  creditOkMaxPct: 60,
  creditTightMaxPct: 90,
  defaultCreditLimit: 3000,
  separateExpiryLots: true,
  packTolerancePct: 5,
  loadMinFillPct: 80,
  requirePackingBeforeDispatch: true,
};

export type ShippingParams = Pick<
  BusinessRules,
  'shippingMinKm' | 'shippingStopsDivisor' | 'shippingEtaBaseFactor' | 'shippingEtaPerStop'
>;

function newTemplateId() {
  return `ship-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTemplate(raw: Partial<ShippingCostTemplate> | null | undefined, fallback: ShippingParams): ShippingCostTemplate {
  const name = String(raw?.name ?? '').trim() || 'Estándar';
  return {
    id: String(raw?.id ?? '').trim() || newTemplateId(),
    name,
    shippingMinKm: Math.max(0, Number(raw?.shippingMinKm ?? fallback.shippingMinKm) || 0),
    shippingStopsDivisor: Math.max(1, Number(raw?.shippingStopsDivisor ?? fallback.shippingStopsDivisor) || 1),
    shippingEtaBaseFactor: Math.max(0, Number(raw?.shippingEtaBaseFactor ?? fallback.shippingEtaBaseFactor) || 0),
    shippingEtaPerStop: Math.max(0, Number(raw?.shippingEtaPerStop ?? fallback.shippingEtaPerStop) || 0),
  };
}

/** Garantiza al menos una plantilla (migra desde businessRules.shipping*). */
export function ensureShippingTemplates(settings?: Settings | null): {
  templates: ShippingCostTemplate[];
  defaultId: string;
} {
  const rules = { ...DEFAULT_BUSINESS_RULES, ...(settings?.businessRules ?? {}) };
  const fallback: ShippingParams = {
    shippingMinKm: rules.shippingMinKm,
    shippingStopsDivisor: rules.shippingStopsDivisor,
    shippingEtaBaseFactor: rules.shippingEtaBaseFactor,
    shippingEtaPerStop: rules.shippingEtaPerStop,
  };
  const raw = settings?.shippingTemplates;
  const templates =
    Array.isArray(raw) && raw.length
      ? raw.map((t) => normalizeTemplate(t, fallback))
      : [normalizeTemplate({ id: 'ship-default', name: 'Estándar', ...fallback }, fallback)];
  const preferred = String(settings?.defaultShippingTemplateId ?? '').trim();
  const defaultId = templates.some((t) => t.id === preferred) ? preferred : templates[0].id;
  return { templates, defaultId };
}

export function resolveShippingParams(
  settings?: Settings | null,
  templateId?: string | null,
): ShippingParams {
  const { templates, defaultId } = ensureShippingTemplates(settings);
  const wanted = String(templateId ?? '').trim();
  const t =
    (wanted ? templates.find((x) => x.id === wanted) : undefined) ??
    templates.find((x) => x.id === defaultId) ??
    templates[0];
  return {
    shippingMinKm: t.shippingMinKm,
    shippingStopsDivisor: t.shippingStopsDivisor,
    shippingEtaBaseFactor: t.shippingEtaBaseFactor,
    shippingEtaPerStop: t.shippingEtaPerStop,
  };
}

export function resolveBusinessRules(settings?: Settings | null): BusinessRules {
  const base = { ...DEFAULT_BUSINESS_RULES, ...(settings?.businessRules ?? {}) };
  const shipping = resolveShippingParams(settings);
  return { ...base, ...shipping };
}

export function mergeBusinessRules(
  current: BusinessRules | undefined,
  patch: Partial<BusinessRules> | undefined,
): BusinessRules {
  return {
    ...DEFAULT_BUSINESS_RULES,
    ...(current ?? {}),
    ...(patch ?? {}),
  };
}

/** Persiste plantillas y sincroniza businessRules.shipping* con la plantilla por defecto. */
export function applyShippingTemplatesToSettings(
  settings: Settings,
  templatesInput: ShippingCostTemplate[] | undefined,
  defaultIdInput?: string | null,
): Settings {
  const current = ensureShippingTemplates(settings);
  const templates =
    Array.isArray(templatesInput) && templatesInput.length
      ? templatesInput.map((t) =>
          normalizeTemplate(t, {
            shippingMinKm: t.shippingMinKm,
            shippingStopsDivisor: t.shippingStopsDivisor,
            shippingEtaBaseFactor: t.shippingEtaBaseFactor,
            shippingEtaPerStop: t.shippingEtaPerStop,
          }),
        )
      : current.templates;
  const preferred = String(defaultIdInput ?? settings.defaultShippingTemplateId ?? '').trim();
  const defaultId = templates.some((t) => t.id === preferred) ? preferred : templates[0].id;
  const def = templates.find((t) => t.id === defaultId) ?? templates[0];
  return {
    ...settings,
    shippingTemplates: templates,
    defaultShippingTemplateId: defaultId,
    businessRules: mergeBusinessRules(settings.businessRules, {
      shippingMinKm: def.shippingMinKm,
      shippingStopsDivisor: def.shippingStopsDivisor,
      shippingEtaBaseFactor: def.shippingEtaBaseFactor,
      shippingEtaPerStop: def.shippingEtaPerStop,
    }),
  };
}

/** km estimados de una ruta con N paradas. */
export function estimateRouteKm(
  baseRouteKm: number,
  stops: number,
  rules: ShippingParams = DEFAULT_BUSINESS_RULES,
) {
  const divisor = Math.max(1, rules.shippingStopsDivisor);
  const n = Math.max(1, stops);
  return Math.max(rules.shippingMinKm, Math.round(baseRouteKm * (n / Math.max(divisor, n))));
}

export function estimateRouteCost(km: number, costPerKm: number) {
  return Math.round(km * costPerKm * 100) / 100;
}

export function estimateRouteEtaHours(
  baseEtaHours: number,
  stops: number,
  rules: ShippingParams = DEFAULT_BUSINESS_RULES,
) {
  return (
    Math.round(baseEtaHours * (rules.shippingEtaBaseFactor + stops * rules.shippingEtaPerStop) * 100) /
    100
  );
}
