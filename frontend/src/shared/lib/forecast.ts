import { childrenStatus, componentsOf, isRaw, parentsOf } from './bom';
import { available, product } from './inventory';
import type { AppState, Product } from '../types';

/** Horizonte de reposición asumido (días de lead time de compra). */
export const DEFAULT_LEAD_DAYS = 7;
/** Ventana de aprendizaje de demanda. */
export const LEARNING_WINDOW_DAYS = 90;

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type DemandSignal = {
  productId: string;
  samples: number;
  dailyDemand: number;
  volatility: number;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  source: 'orders' | 'blend' | 'minimum';
};

export type ForecastRecommendation = {
  productId: string;
  name: string;
  kind: 'finished' | 'raw';
  category: string;
  available: number;
  min: number;
  dailyDemand: number;
  daysCover: number | null;
  leadDays: number;
  reorderPoint: number;
  suggestedQty: number;
  urgency: 'now' | 'soon' | 'watch';
  confidence: ConfidenceLevel;
  confidenceScore: number;
  reason: string;
  productionRisk: boolean;
  blocksParents: number;
  parentNames: string[];
  /** 0–100: qué tanto se apoya en datos reales vs. mínimo fijo */
  learningWeight: number;
};

export type ForecastSummary = {
  generatedAt: string;
  leadDays: number;
  windowDays: number;
  recommendations: ForecastRecommendation[];
  productionRisks: ForecastRecommendation[];
  learningScore: number;
  insight: string;
};

const DAY_MS = 86_400_000;

function parseAt(value: string): number | null {
  if (!value) return null;
  const t = new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime();
  return Number.isFinite(t) ? t : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((n, x) => n + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/**
 * Peso de aprendizaje: crece con más muestras y baja si la demanda es muy irregular.
 * 0 = solo mínimo operativo; 1 = confiar casi por completo en el histórico.
 */
export function learningWeight(samples: number, volatility: number): number {
  const sampleFactor = clamp(samples / 12, 0, 1);
  const stability = 1 - clamp(volatility, 0, 1.5) / 1.5;
  return Math.round(clamp(sampleFactor * (0.45 + 0.55 * stability), 0, 0.95) * 100) / 100;
}

export function confidenceFrom(samples: number, volatility: number): { level: ConfidenceLevel; score: number } {
  const w = learningWeight(samples, volatility);
  const score = Math.round(w * 100);
  if (samples < 3 || score < 35) return { level: 'low', score };
  if (samples < 8 || score < 65) return { level: 'medium', score };
  return { level: 'high', score };
}

/**
 * Señales de demanda diaria por producto a partir de pedidos y despachos.
 * Usa media ponderada exponencial por antigüedad (más peso a lo reciente).
 */
export function buildDemandSignals(
  state: AppState,
  windowDays = LEARNING_WINDOW_DAYS,
  now = new Date(),
): Map<string, DemandSignal> {
  const nowTs = now.getTime();
  const startTs = nowTs - windowDays * DAY_MS;
  const dayMaps = new Map<string, Map<string, number>>();
  const observationCount = new Map<string, number>();

  const addQty = (productId: string, at: string, qty: number) => {
    if (!productId || qty <= 0) return;
    const ts = parseAt(at);
    if (ts === null || ts < startTs) return;
    const dayKey = new Date(ts).toISOString().slice(0, 10);
    const map = dayMaps.get(productId) ?? new Map<string, number>();
    map.set(dayKey, (map.get(dayKey) ?? 0) + qty);
    dayMaps.set(productId, map);
    observationCount.set(productId, (observationCount.get(productId) ?? 0) + 1);
  };

  for (const order of state.orders) {
    for (const line of order.lines) {
      addQty(line.productId, order.deliveredAt || order.date, line.qty);
    }
  }
  for (const ev of state.events) {
    if (ev.type === 'Despacho' || ev.type === 'Salida' || ev.type === 'Ajuste-') {
      addQty(ev.productId, ev.at, ev.qty);
    }
  }

  const halfLifeDays = 21;
  const signals = new Map<string, DemandSignal>();

  for (const p of state.products) {
    const dayMap = dayMaps.get(p.id) ?? new Map();
    const points: Array<{ ageDays: number; qty: number }> = [];
    for (const [day, qty] of dayMap) {
      const ts = parseAt(day);
      if (ts === null) continue;
      const ageDays = Math.max(0, (nowTs - ts) / DAY_MS);
      points.push({ ageDays, qty });
    }

    let weightedSum = 0;
    let weightTotal = 0;
    const dailySeries: number[] = [];
    for (const pt of points) {
      const w = Math.exp((-Math.LN2 * pt.ageDays) / halfLifeDays);
      weightedSum += pt.qty * w;
      weightTotal += w;
      dailySeries.push(pt.qty);
    }

    const spanDays = points.length
      ? Math.max(7, Math.min(windowDays, Math.ceil(Math.max(...points.map((pt) => pt.ageDays)) + 1)))
      : 7;
    const totalQty = points.reduce((n, pt) => n + pt.qty, 0);
    const simpleDaily = totalQty / spanDays;
    const ewmaDaily = weightTotal > 0 ? weightedSum / Math.max(weightTotal, 1) / Math.max(spanDays / Math.max(points.length, 1), 1) : 0;
    // Tasa diaria = mezcla de promedio simple y señal reciente
    const dailyDemand = points.length ? simpleDaily * 0.55 + ewmaDaily * 0.45 : 0;

    const vol = dailyDemand > 0 ? stdev(dailySeries) / dailyDemand : 0;
    // Cada pedido/despacho cuenta: el modelo mejora con más operaciones, no solo días distintos
    const samples = observationCount.get(p.id) ?? points.length;
    const { level, score } = confidenceFrom(samples, vol);
    const source: DemandSignal['source'] = samples === 0 ? 'minimum' : samples < 3 ? 'blend' : 'orders';

    signals.set(p.id, {
      productId: p.id,
      samples,
      dailyDemand: Math.round(dailyDemand * 100) / 100,
      volatility: Math.round(vol * 100) / 100,
      confidence: level,
      confidenceScore: score,
      source,
    });
  }

  // Demanda dependiente de insumos (BOM): suma de demanda de padres × qty
  for (const raw of state.products.filter(isRaw)) {
    const parents = parentsOf(state, raw.id);
    let dependentDaily = 0;
    let parentSamples = 0;
    for (const parent of parents) {
      const comp = componentsOf(parent).find((c) => c.productId === raw.id);
      const parentSignal = signals.get(parent.id);
      if (!comp || !parentSignal) continue;
      dependentDaily += parentSignal.dailyDemand * comp.qty;
      parentSamples += parentSignal.samples;
    }
    const own = signals.get(raw.id)!;
    const blendedDaily = Math.max(own.dailyDemand, dependentDaily);
    const samples = Math.max(own.samples, Math.ceil(parentSamples / Math.max(parents.length, 1)));
    const vol = own.volatility;
    const { level, score } = confidenceFrom(samples, vol);
    signals.set(raw.id, {
      ...own,
      dailyDemand: Math.round(blendedDaily * 100) / 100,
      samples,
      confidence: level,
      confidenceScore: score,
      source: dependentDaily > own.dailyDemand ? 'blend' : own.source,
    });
  }

  return signals;
}

function urgencyFrom(daysCover: number | null, availableQty: number, min: number): ForecastRecommendation['urgency'] {
  if (availableQty <= 0 || (min > 0 && availableQty < min * 0.5)) return 'now';
  if (daysCover !== null && daysCover <= DEFAULT_LEAD_DAYS) return 'now';
  if (daysCover !== null && daysCover <= DEFAULT_LEAD_DAYS * 2) return 'soon';
  if (min > 0 && availableQty < min) return 'soon';
  return 'watch';
}

function productionRiskFor(state: AppState, p: Product, signals: Map<string, DemandSignal>, leadDays: number): boolean {
  if (isRaw(p)) {
    const parents = parentsOf(state, p.id);
    const signal = signals.get(p.id);
    if (!signal || !parents.length) return false;
    const cover = signal.dailyDemand > 0 ? available(state, p.id) / signal.dailyDemand : null;
    return cover !== null && cover < leadDays;
  }
  const children = childrenStatus(state, p);
  if (!children.length) return false;
  const parentSignal = signals.get(p.id);
  const need = (parentSignal?.dailyDemand ?? 0) * leadDays;
  return children.some((c) => {
    if (c.status === 'critical') return true;
    const buildable = c.buildable;
    return need > 0 && buildable < need;
  });
}

/**
 * Plan de abastecimiento adaptativo: mezcla mínimo fijo + demanda aprendida.
 * Cuanta más historia consistente haya, más peso tiene la previsión.
 */
export function buildForecast(
  state: AppState,
  options?: { leadDays?: number; windowDays?: number; now?: Date },
): ForecastSummary {
  const leadDays = options?.leadDays ?? DEFAULT_LEAD_DAYS;
  const windowDays = options?.windowDays ?? LEARNING_WINDOW_DAYS;
  const now = options?.now ?? new Date();
  const signals = buildDemandSignals(state, windowDays, now);
  const recommendations: ForecastRecommendation[] = [];

  for (const p of state.products) {
    const avail = available(state, p.id);
    const signal = signals.get(p.id)!;
    const weight = learningWeight(signal.samples, signal.volatility);
    const safetyDays = 1.2 + signal.volatility * 2; // stock de seguridad adaptativo
    const forecastNeed = signal.dailyDemand * (leadDays + safetyDays);
    const minGap = Math.max(0, p.min - avail);
    const reorderPoint = Math.ceil(Math.max(p.min, forecastNeed));
    const forecastGap = Math.max(0, reorderPoint - avail);
    const suggestedQty = Math.ceil(weight * forecastGap + (1 - weight) * minGap);

    const daysCover = signal.dailyDemand > 0 ? Math.round((avail / signal.dailyDemand) * 10) / 10 : null;
    const risk = productionRiskFor(state, p, signals, leadDays);
    const parents = isRaw(p) ? parentsOf(state, p.id) : [];
    const urgency = risk ? 'now' : urgencyFrom(daysCover, avail, p.min);

    if (suggestedQty <= 0 && !risk && urgency === 'watch') continue;

    let reason: string;
    if (risk && isRaw(p)) {
      reason = `Riesgo de producción: el insumo cubre ${daysCover ?? 0} días y alimenta ${parents.length} producto(s).`;
    } else if (risk) {
      reason = 'Un insumo del BOM no alcanza para cubrir la demanda prevista del producto.';
    } else if (weight < 0.35) {
      reason = `Poca historia (${signal.samples} señales). Se prioriza el mínimo operativo; la previsión mejorará con más movimientos.`;
    } else if (urgency === 'now') {
      reason = `Demanda ~${signal.dailyDemand.toFixed(1)} uds/día. Cobertura ${daysCover ?? '—'} días < lead time ${leadDays}.`;
    } else {
      reason = `Previsión con confianza ${signal.confidenceScore}%. Punto de reorden ${reorderPoint} uds.`;
    }

    recommendations.push({
      productId: p.id,
      name: p.name,
      kind: isRaw(p) ? 'raw' : 'finished',
      category: p.category,
      available: avail,
      min: p.min,
      dailyDemand: signal.dailyDemand,
      daysCover,
      leadDays,
      reorderPoint,
      suggestedQty: Math.max(suggestedQty, risk && suggestedQty === 0 ? Math.ceil(Math.max(minGap, forecastNeed * 0.5)) : suggestedQty),
      urgency,
      confidence: signal.confidence,
      confidenceScore: signal.confidenceScore,
      reason,
      productionRisk: risk,
      blocksParents: parents.length,
      parentNames: parents.map((x) => x.name),
      learningWeight: weight,
    });
  }

  const rank = { now: 0, soon: 1, watch: 2 };
  recommendations.sort((a, b) => {
    if (a.productionRisk !== b.productionRisk) return a.productionRisk ? -1 : 1;
    if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
    if (a.kind !== b.kind) return a.kind === 'raw' ? -1 : 1;
    return b.suggestedQty * (b.kind === 'raw' ? 1.2 : 1) - a.suggestedQty;
  });

  const productionRisks = recommendations.filter((r) => r.productionRisk);
  const learningScore = recommendations.length
    ? Math.round(mean(recommendations.map((r) => r.confidenceScore)))
    : Math.round(mean([...signals.values()].map((s) => s.confidenceScore)));

  const top = recommendations[0];
  const insight = !recommendations.length
    ? 'Sin alertas de reposición. El modelo seguirá aprendiendo con cada pedido y despacho.'
    : top.productionRisk
      ? `Prioriza ${top.name}: evita cortar producción en ${top.blocksParents || 'productos'} vinculados. Confianza del modelo ${learningScore}%.`
      : `Abastece ${top.name} (~${top.suggestedQty} uds.). El modelo usa ${learningScore}% de aprendizaje sobre el histórico.`;

  return {
    generatedAt: now.toISOString(),
    leadDays,
    windowDays,
    recommendations,
    productionRisks,
    learningScore,
    insight,
  };
}

export function forecastForProduct(state: AppState, productId: string): ForecastRecommendation | undefined {
  return buildForecast(state).recommendations.find((r) => r.productId === productId);
}

/** Cantidad sugerida para prellenar una solicitud de compra. */
export function suggestedPurchaseQty(state: AppState, productId: string): number {
  const all = buildForecast(state);
  const hit = all.recommendations.find((r) => r.productId === productId);
  if (hit?.suggestedQty) return hit.suggestedQty;
  const p = product(state, productId);
  if (!p) return 12;
  return Math.max(12, Math.max(0, p.min - available(state, p.id)));
}
