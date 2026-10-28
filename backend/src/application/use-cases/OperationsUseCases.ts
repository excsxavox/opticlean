import type { StateRepository } from '../ports/StateRepository.js';
import type { AppState, Client, Product, Settings } from '../../domain/types.js';
import { categories } from '../../domain/warehouse.js';
import { getWarehouseGeometry } from '../../domain/warehouse-layout.js';
import {
  available,
  client,
  confirmDelivery,
  createOrder,
  dispatch,
  move,
  orderValue,
  orderWeight,
  pickPlan,
  prepare,
  product,
  qtyAt,
  receive,
  registerIncident,
  reserved,
  stock,
  suggest,
  upsertProduct,
} from '../../domain/inventory.service.js';
import { uid } from '../../domain/inventory.service.js';
import {
  activateWarehouse,
  createWarehouse,
  deleteWarehouse,
  upsertWarehouse,
} from '../../domain/warehouse-admin.service.js';
import type { WarehouseSite } from '../../domain/types.js';

export const BUNDLES = [
  {
    id: 'KIT01',
    name: 'Kit Limpieza Básico',
    description: 'Multiusos, limpiador de pisos y fundas',
    lines: [
      { productId: 'P001', qty: 4 },
      { productId: 'P032', qty: 2 },
      { productId: 'P078', qty: 2 },
    ],
  },
  {
    id: 'KIT02',
    name: 'Kit Oficina',
    description: 'Papel higiénico, toallas y jabón',
    lines: [
      { productId: 'P012', qty: 2 },
      { productId: 'P025', qty: 2 },
      { productId: 'P045', qty: 4 },
    ],
  },
  {
    id: 'KIT03',
    name: 'Kit Hospitalario',
    description: 'Desinfectante, guantes y jabón',
    lines: [
      { productId: 'P008', qty: 6 },
      { productId: 'P052', qty: 2 },
      { productId: 'P045', qty: 4 },
    ],
  },
];

export class OperationsUseCases {
  constructor(private readonly repo: StateRepository) {}

  async getMeta() {
    const s = await this.repo.load();
    const geo = getWarehouseGeometry(s);
    return { categories, racks: geo.racks, locations: geo.locations, bundles: BUNDLES };
  }

  async getState(): Promise<AppState> {
    return this.repo.load();
  }

  async reset(): Promise<AppState> {
    return this.repo.reset();
  }

  private async mutate(fn: (s: AppState) => void | Promise<void>) {
    const state = await this.repo.load();
    await fn(state);
    await this.repo.save(state);
    return state;
  }

  async updateSettings(settings: Partial<Settings>) {
    return this.mutate((s) => {
      s.settings = { ...s.settings, ...settings };
    });
  }

  async receiveGoods(body: Parameters<typeof receive>[1]) {
    return this.mutate((s) => {
      receive(s, body);
    });
  }

  async transferLot(body: Parameters<typeof move>[1]) {
    return this.mutate((s) => {
      move(s, body);
    });
  }

  async saveProduct(body: Product & { originalId?: string }) {
    const { originalId, ...rest } = body;
    return this.mutate((s) => {
      upsertProduct(s, rest, originalId);
    });
  }

  async placeOrder(body: Parameters<typeof createOrder>[1]) {
    let createdId = '';
    await this.mutate((s) => {
      const o = createOrder(s, body);
      createdId = o.id;
    });
    return createdId;
  }

  async getPickPlan(orderId: string) {
    const s = await this.repo.load();
    const order = s.orders.find((o) => o.id === orderId);
    if (!order) throw new Error('Pedido no encontrado.');
    return pickPlan(s, order);
  }

  async confirmPrepare(orderId: string) {
    return this.mutate((s) => {
      prepare(s, orderId);
    });
  }

  async confirmDispatch(orderIds: string[], vehicle = 'GBA-2041') {
    return this.mutate((s) => {
      dispatch(s, orderIds, vehicle);
    });
  }

  async delivery(orderId: string, person: string, notes?: string) {
    return this.mutate((s) => {
      confirmDelivery(s, orderId, person, notes);
    });
  }

  async incident(orderId: string, reason: string, notes?: string) {
    return this.mutate((s) => {
      registerIncident(s, orderId, reason, notes);
    });
  }

  async addClient(body: Omit<Client, 'id'>) {
    return this.mutate((s) => {
      s.clients.push({ ...body, id: uid('CL') });
    });
  }

  async saveWarehouse(body: WarehouseSite) {
    return this.mutate((s) => {
      upsertWarehouse(s, body);
    });
  }

  async addWarehouse(body: Omit<WarehouseSite, 'id'>) {
    return this.mutate((s) => {
      createWarehouse(s, body);
    });
  }

  async removeWarehouse(id: string) {
    return this.mutate((s) => {
      deleteWarehouse(s, id);
    });
  }

  async setActiveWarehouse(id: string) {
    return this.mutate((s) => {
      activateWarehouse(s, id);
    });
  }

  async addPurchase(body: { productId: string; qty: number; date: string; notes?: string }) {
    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('La cantidad debe ser un entero mayor que cero.');
    }
    return this.mutate((s) => {
      s.purchases.unshift({
        ...body,
        qty,
        id: `OC-${String(s.purchases.length + 1).padStart(4, '0')}`,
      });
    });
  }

  /** Consultas derivadas para asistente / KPIs */
  async assistantQuery(query: 'stock' | 'warehouse' | 'orders') {
    const s = await this.repo.load();
    const occupied = getWarehouseGeometry(s).locations.filter((l) => qtyAt(s, l.id) > 0).length;
    const low = s.products.filter((p) => available(s, p.id) < p.min);
    if (query === 'stock') {
      return low.length
        ? low.map(
            (p) =>
              `${p.name}: ${available(s, p.id)} disponibles, mínimo ${p.min}. Sugerencia: ${Math.max(p.min * 2 - available(s, p.id), 1)} u.`,
          )
        : ['Todos los productos cumplen el stock mínimo configurado.'];
    }
    if (query === 'warehouse') {
      return [
        `${getWarehouseGeometry(s).locations.length - occupied} posiciones libres. Ocupación ${Math.round((occupied / Math.max(getWarehouseGeometry(s).locations.length, 1)) * 100)}%.`,
      ];
    }
    const pending = s.orders
      .filter((o) => o.status === 'Por preparar')
      .sort((a, b) => (b.priority === 'Alta' ? 1 : 0) - (a.priority === 'Alta' ? 1 : 0));
    if (!pending.length) return ['No hay pedidos pendientes de preparación.'];
    const first = pending[0];
    return [
      `Empieza por ${first.id} de ${client(s, first.clientId)?.name}. Prioridad ${first.priority.toLowerCase()}, ${first.lines.reduce((n, l) => n + l.qty, 0)} unidades.`,
    ];
  }

  metricsSnapshot(s: AppState) {
    const occupied = getWarehouseGeometry(s).locations.filter((l) => qtyAt(s, l.id) > 0).length;
    const stockValue = s.products.reduce((n, p) => n + stock(s, p.id) * p.price, 0);
    return {
      occupied,
      occupancyPct: Math.round(
        (occupied / Math.max(getWarehouseGeometry(s).locations.length, 1)) * 100,
      ),
      stockValue,
      lowCount: s.products.filter((p) => available(s, p.id) < p.min).length,
      pendingOrders: s.orders.filter((o) => o.status === 'Por preparar').length,
    };
  }

}

export {
  stock,
  reserved,
  available,
  qtyAt,
  product,
  client,
  orderValue,
  orderWeight,
  suggest,
};
