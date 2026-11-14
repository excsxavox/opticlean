import type { AppState, Order } from './types.js';

export type FleetTruck = {
  id: string;
  plate: string;
  label: string;
  city: string;
  driver: string;
  maxKg: number;
  maxM3: number;
  costPerKm: number;
};

export type AutoAssignItem = {
  orderId: string;
  truckId: string;
  plate: string;
  truckLabel: string;
  city: string;
  kg: number;
  m3: number;
  reason: string;
};

export type AutoAssignPlan = {
  assignments: AutoAssignItem[];
  byTruck: Record<string, string[]>;
  unassigned: { orderId: string; kg: number; m3: number; city: string; reason: string }[];
  summary: string;
  source: 'openai' | 'heuristic';
};

type ReadyOrder = {
  id: string;
  city: string;
  sector: string;
  client: string;
  kg: number;
  m3: number;
  packages: number;
};

type TruckContext = FleetTruck & {
  usedKg: number;
  usedM3: number;
  freeKg: number;
  freeM3: number;
  stopsOnRoute: number;
};

const DEFAULT_FLEET: FleetTruck[] = [
  {
    id: 'T01',
    plate: 'GBA-2041',
    label: 'Camión 01',
    city: 'Quito',
    driver: 'Carlos Sur',
    maxKg: 5000,
    maxM3: 20,
    costPerKm: 0.85,
  },
  {
    id: 'T02',
    plate: 'GYE-1188',
    label: 'Camión 02',
    city: 'Guayaquil',
    driver: 'María Costa',
    maxKg: 4000,
    maxM3: 16,
    costPerKm: 0.8,
  },
  {
    id: 'T03',
    plate: 'CUE-3301',
    label: 'Camión 03',
    city: 'Cuenca',
    driver: 'Luis Andes',
    maxKg: 3000,
    maxM3: 12,
    costPerKm: 0.75,
  },
  {
    id: 'T04',
    plate: 'AMB-5520',
    label: 'Camión 04',
    city: 'Santo Domingo',
    driver: 'Ana Rivera',
    maxKg: 4500,
    maxM3: 18,
    costPerKm: 0.78,
  },
];

function productOf(s: AppState, id: string) {
  return s.products.find((p) => p.id === id);
}

function clientOf(s: AppState, id: string) {
  return s.clients.find((c) => c.id === id);
}

function orderWeight(s: AppState, o: Order) {
  return o.lines.reduce((n, l) => n + l.qty * (productOf(s, l.productId)?.weight ?? 0), 0);
}

function orderVolume(s: AppState, o: Order) {
  return o.lines.reduce((n, l) => n + l.qty * (productOf(s, l.productId)?.volume ?? 0), 0) / 1000;
}

function cityOf(s: AppState, o: Order) {
  const c = clientOf(s, o.clientId);
  if (c?.city) return c.city;
  if (c?.address.includes('Guayaquil')) return 'Guayaquil';
  if (c?.address.includes('Cuenca')) return 'Cuenca';
  return 'Quito';
}

function sectorOf(s: AppState, o: Order) {
  const c = clientOf(s, o.clientId);
  return c?.sector || c?.address || 'Sin sector';
}

function buildContext(
  state: AppState,
  orderIds: string[] | undefined,
  stagedByTruck: Record<string, string[]> | undefined,
  fleet: FleetTruck[],
) {
  const staged = new Set(Object.values(stagedByTruck ?? {}).flat());
  const readyOrders: ReadyOrder[] = state.orders
    .filter((o) => {
      if (o.id.startsWith('PED-H')) return false;
      if (o.status !== 'Preparado' || o.vehicle || staged.has(o.id)) return false;
      if (orderIds?.length && !orderIds.includes(o.id)) return false;
      return true;
    })
    .map((o) => {
      const c = clientOf(state, o.clientId);
      return {
        id: o.id,
        city: cityOf(state, o),
        sector: sectorOf(state, o),
        client: c?.name ?? o.clientId,
        kg: Math.round(orderWeight(state, o) * 10) / 10,
        m3: Math.round(orderVolume(state, o) * 100) / 100,
        packages: o.lines.length,
      };
    });

  const trucks: TruckContext[] = fleet.map((t) => {
    const onRoute = state.orders.filter(
      (o) => o.vehicle === t.plate && (o.status === 'En ruta' || o.status === 'Incidencia'),
    );
    const stagedIds = stagedByTruck?.[t.id] ?? [];
    const stagedOrders = stagedIds
      .map((id) => state.orders.find((o) => o.id === id))
      .filter((o): o is Order => Boolean(o));
    const usedKg = [...onRoute, ...stagedOrders].reduce((n, o) => n + orderWeight(state, o), 0);
    const usedM3 = [...onRoute, ...stagedOrders].reduce((n, o) => n + orderVolume(state, o), 0);
    return {
      ...t,
      usedKg: Math.round(usedKg),
      usedM3: Math.round(usedM3 * 10) / 10,
      freeKg: Math.max(0, Math.round(t.maxKg - usedKg)),
      freeM3: Math.max(0, Math.round((t.maxM3 - usedM3) * 10) / 10),
      stopsOnRoute: onRoute.length + stagedOrders.length,
    };
  });

  return { readyOrders, trucks };
}

function heuristicAssign(ready: ReadyOrder[], trucks: TruckContext[]): AutoAssignPlan {
  const used = new Map(trucks.map((t) => [t.id, { kg: t.usedKg, m3: t.usedM3, count: t.stopsOnRoute }]));
  const sorted = [...ready].sort((a, b) => b.kg - a.kg || b.m3 - a.m3);
  const assignments: AutoAssignItem[] = [];
  const byTruck: Record<string, string[]> = {};
  const unassigned: AutoAssignPlan['unassigned'] = [];

  for (const o of sorted) {
    let best: { truck: TruckContext; score: number; reason: string } | null = null;
    for (const t of trucks) {
      const cur = used.get(t.id)!;
      const nextKg = cur.kg + o.kg;
      const nextM3 = cur.m3 + o.m3;
      if (nextKg > t.maxKg + 0.01 || nextM3 > t.maxM3 + 0.01) continue;
      const fill = Math.max(nextKg / t.maxKg, nextM3 / t.maxM3);
      const fillScore = fill <= 0.85 ? fill * 40 : fill <= 0.95 ? 28 : 10;
      const cityScore = t.city === o.city ? 100 : 0;
      const costScore = (1.2 - t.costPerKm) * 25;
      const balanceScore = Math.max(0, 18 - cur.count * 2);
      const score = cityScore + fillScore + costScore + balanceScore;
      const reason = [
        cityScore ? `misma ciudad (${t.city})` : 'capacidad libre',
        `${o.kg} kg / ${o.m3} m³ caben`,
        `costo $${t.costPerKm}/km`,
        `ocupación → ${Math.round(fill * 100)}%`,
      ].join(' · ');
      if (!best || score > best.score) best = { truck: t, score, reason };
    }
    if (!best) {
      unassigned.push({
        orderId: o.id,
        kg: Math.round(o.kg),
        m3: o.m3,
        city: o.city,
        reason: 'Sin capacidad kg/m³ en la flota disponible',
      });
      continue;
    }
    const cur = used.get(best.truck.id)!;
    used.set(best.truck.id, { kg: cur.kg + o.kg, m3: cur.m3 + o.m3, count: cur.count + 1 });
    byTruck[best.truck.id] = [...(byTruck[best.truck.id] ?? []), o.id];
    assignments.push({
      orderId: o.id,
      truckId: best.truck.id,
      plate: best.truck.plate,
      truckLabel: best.truck.label,
      city: best.truck.city,
      kg: Math.round(o.kg),
      m3: o.m3,
      reason: best.reason,
    });
  }

  const truckCount = Object.keys(byTruck).length;
  return {
    assignments,
    byTruck,
    unassigned,
    summary:
      assignments.length === 0
        ? 'No hay pedidos listos para asignar o la flota no tiene capacidad.'
        : `Asignó ${assignments.length} pedido(s) en ${truckCount} camión(es)` +
          (unassigned.length ? `; ${unassigned.length} sin cupo.` : '.'),
    source: 'heuristic',
  };
}

function validatePlan(
  raw: unknown,
  ready: ReadyOrder[],
  trucks: TruckContext[],
): AutoAssignPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as {
    assignments?: Array<{ orderId?: string; truckId?: string; reason?: string }>;
    unassigned?: Array<{ orderId?: string; reason?: string }>;
    summary?: string;
  };
  if (!Array.isArray(data.assignments)) return null;

  const byId = new Map(ready.map((o) => [o.id, o]));
  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const used = new Map(trucks.map((t) => [t.id, { kg: t.usedKg, m3: t.usedM3 }]));
  const seen = new Set<string>();
  const assignments: AutoAssignItem[] = [];
  const byTruck: Record<string, string[]> = {};

  for (const a of data.assignments) {
    const orderId = String(a.orderId ?? '');
    const truckId = String(a.truckId ?? '');
    const o = byId.get(orderId);
    const t = truckById.get(truckId);
    if (!o || !t || seen.has(orderId)) continue;
    const cur = used.get(truckId)!;
    if (cur.kg + o.kg > t.maxKg + 0.01 || cur.m3 + o.m3 > t.maxM3 + 0.01) continue;
    used.set(truckId, { kg: cur.kg + o.kg, m3: cur.m3 + o.m3 });
    seen.add(orderId);
    byTruck[truckId] = [...(byTruck[truckId] ?? []), orderId];
    assignments.push({
      orderId,
      truckId,
      plate: t.plate,
      truckLabel: t.label,
      city: t.city,
      kg: Math.round(o.kg),
      m3: o.m3,
      reason: String(a.reason ?? `IA: ${t.label} · ${t.city}`),
    });
  }

  const unassigned: AutoAssignPlan['unassigned'] = ready
    .filter((o) => !seen.has(o.id))
    .map((o) => {
      const fromAi = (data.unassigned ?? []).find((u) => u.orderId === o.id);
      return {
        orderId: o.id,
        kg: Math.round(o.kg),
        m3: o.m3,
        city: o.city,
        reason: String(fromAi?.reason ?? 'No asignado por la IA / sin cupo validado'),
      };
    });

  const truckCount = Object.keys(byTruck).length;
  return {
    assignments,
    byTruck,
    unassigned,
    summary:
      typeof data.summary === 'string' && data.summary.trim()
        ? data.summary.trim()
        : assignments.length === 0
          ? 'La IA no pudo asignar pedidos con la capacidad actual.'
          : `IA asignó ${assignments.length} pedido(s) en ${truckCount} camión(es)` +
            (unassigned.length ? `; ${unassigned.length} sin cupo.` : '.'),
    source: 'openai',
  };
}

async function callOpenAi(ready: ReadyOrder[], trucks: TruckContext[]): Promise<AutoAssignPlan | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

  const system = `Eres el planificador logístico de OPTICLEAN (Ecuador).
Asigna pedidos LISTOS a camiones respetando:
1) Capacidad kg y m³ (no superar freeKg/freeM3 + used).
2) Preferir misma ciudad del camión.
3) Equilibrar carga y minimizar costo/km cuando haya empate.
4) Cada pedido a un solo camión.
Responde SOLO JSON válido con esta forma:
{"assignments":[{"orderId":"PED-xxx","truckId":"T01","reason":"..."}],"unassigned":[{"orderId":"PED-yyy","reason":"..."}],"summary":"..."}`;

  const user = JSON.stringify({ pedidos: ready, camiones: trucks }, null, 0);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    parsed = JSON.parse(match[0]);
  }

  return validatePlan(parsed, ready, trucks);
}

export async function autoAssignLogistics(input: {
  state: AppState;
  orderIds?: string[];
  stagedByTruck?: Record<string, string[]>;
  fleet?: FleetTruck[];
}): Promise<AutoAssignPlan> {
  const fleet = input.fleet?.length ? input.fleet : DEFAULT_FLEET;
  const { readyOrders, trucks } = buildContext(
    input.state,
    input.orderIds,
    input.stagedByTruck,
    fleet,
  );

  if (!readyOrders.length) {
    return {
      assignments: [],
      byTruck: {},
      unassigned: [],
      summary: 'No hay pedidos listos para asignar.',
      source: 'heuristic',
    };
  }

  try {
    const ai = await callOpenAi(readyOrders, trucks);
    if (ai && (ai.assignments.length || ai.unassigned.length)) return ai;
  } catch (err) {
    console.warn('[logistics-ai]', err instanceof Error ? err.message : err);
  }

  const fallback = heuristicAssign(readyOrders, trucks);
  fallback.summary = `Fallback local · ${fallback.summary}`;
  return fallback;
}

export function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
