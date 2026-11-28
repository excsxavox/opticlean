import type { StateRepository } from '../ports/StateRepository.js';
import type { AppState, Client, Product, Settings } from '../../domain/types.js';
import {
  applyShippingTemplatesToSettings,
  mergeBusinessRules,
  resolveBusinessRules,
} from '../../domain/business-rules.js';
import { actorIsAdmin, recordChange } from '../../domain/audit.js';
import { IVA_RATE } from '../../domain/ledger.js';
import { categories } from '../../domain/warehouse.js';
import { getWarehouseGeometry } from '../../domain/warehouse-layout.js';
import {
  available,
  client,
  confirmDelivery,
  createOrder,
  editOrder,
  deleteProduct,
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
  rejectLot,
  releaseLot,
  reserved,
  sellableStock,
  stock,
  upsertProduct,
} from '../../domain/inventory.service.js';
import {
  applyParsedInvoice,
  parseFacturaXml,
} from '../../domain/invoice-xml.service.js';
import { suggest } from '../../domain/placement.service.js';
import {
  deleteFamily,
  ensureFamilies,
  upsertFamily,
} from '../../domain/families.service.js';
import {
  activateWarehouse,
  createWarehouse,
  deleteWarehouse,
  upsertWarehouse,
} from '../../domain/warehouse-admin.service.js';
import type { Bundle, Supplier, WarehouseFamily, WarehouseSite } from '../../domain/types.js';
import { deleteBundle, ensureBundles, saveBundle } from '../../domain/bundles.service.js';
import {
  cancelOrder,
  cancelPurchase,
  editPurchase,
  deleteClient,
  closePurchase,
  createBackorderPurchases,
  createClient,
  createPurchase,
  promoteWaitingOrders,
  receivePurchase,
  receiveWithoutPurchase,
  updateClient as saveClientProfile,
} from '../../domain/commerce.service.js';
import { addEvent } from '../../domain/inventory.service.js';
import {
  commitImport,
  previewCsv,
  previewFromInvoice,
  previewXlsx,
  previewXml,
  type ImportKind,
} from '../../domain/import-docs.service.js';
import { assembleBundle } from '../../domain/kits.service.js';
import { createSupplier, updateSupplier } from '../../domain/suppliers.service.js';
import {
  applyCycleCount,
  approveAdjustment,
  createSuggestedPurchases,
  issueCreditNote,
  issueGuide,
  issueInvoice,
  openCycleCount,
  recallBatch,
  receiveTransfer,
  registerCustomerPayment,
  registerSupplierBill,
  registerSupplierPayment,
  requestAdjustment,
  returnToSupplier,
  saveClientPrice,
  savePriceList,
  shipTransfer,
  suggestReplenishment,
} from '../../domain/commercial.service.js';
import { deleteVehicle as removeFleetVehicle, syncFleet, upsertVehicle } from '../../domain/fleet.service.js';
import { packingListPdf, parcelLabelsPdf } from '../../domain/packing-documents.js';
import {
  assertPackedForDispatch,
  cleanPackingBoxes,
  closePacking,
  countUnits,
  scanUnit,
  confirmLoad,
  createParcel,
  deleteParcel,
  releaseLoad,
  reopenPacking,
  updateParcel,
} from '../../domain/packing.service.js';
import {
  approvePlan,
  createQuote,
  customerDeliveryCode,
  discardPlan,
  loadPreview,
  loseQuote,
  ordersOutOfZone,
  type LoadTruck,
  planView,
  removeOffering,
  saveOffering,
  skipAndReoptimize,
  undoPlan,
  winQuote,
} from '../../domain/outbound.service.js';
import type { Vehicle } from '../../domain/types.js';

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

const SENSITIVE_PRODUCT_FIELDS = ['price', 'avgCost', 'ivaRate'] as const;
const PRODUCT_FIELD_LABEL: Record<(typeof SENSITIVE_PRODUCT_FIELDS)[number], string> = {
  price: 'Precio de venta',
  avgCost: 'Costo promedio',
  ivaRate: 'Tarifa de IVA',
};
const sameValue = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && Number(a) === Number(b));

export class OperationsUseCases {
  constructor(private readonly repo: StateRepository) {}

  async getMeta() {
    const s = await this.repo.load();
    const geo = getWarehouseGeometry(s);
    ensureBundles(s);
    return {
      categories,
      racks: geo.racks,
      locations: geo.locations,
      layout: geo.layout,
      bundles: s.bundles ?? [],
    };
  }

  async getState(): Promise<AppState> {
    return this.repo.load();
  }

  async reset(): Promise<AppState> {
    return this.repo.reset();
  }

  /**
   * Toda escritura pasa por aquí: atómica por empresa y, al final, libera los
   * pedidos que esperaban stock si la operación lo dejó disponible.
   */
  private async mutate(fn: (s: AppState) => void | Promise<void>) {
    const { state } = await this.repo.transaction(async (s) => {
      await fn(s);
      promoteWaitingOrders(s);
    });
    return state;
  }

  async updateSettings(settings: Partial<Settings>) {
    return this.mutate((s) => {
      const { businessRules, shippingTemplates, defaultShippingTemplateId, ...rest } = settings;
      if (rest.packingBoxes !== undefined) rest.packingBoxes = cleanPackingBoxes(rest.packingBoxes);
      s.settings = { ...s.settings, ...rest };
      if (businessRules) {
        s.settings.businessRules = mergeBusinessRules(s.settings.businessRules, businessRules);
      }
      if (shippingTemplates !== undefined || defaultShippingTemplateId !== undefined) {
        s.settings = applyShippingTemplatesToSettings(
          s.settings,
          shippingTemplates ?? s.settings.shippingTemplates,
          defaultShippingTemplateId ?? s.settings.defaultShippingTemplateId,
        );
      }
    });
  }

  async receiveGoods(body: Parameters<typeof receive>[1]) {
    return this.mutate((s) => {
      receive(s, body);
    });
  }

  async receiveGoodsBatch(body: Parameters<typeof receiveWithoutPurchase>[1]) {
    return this.mutate((s) => {
      receiveWithoutPurchase(s, body);
    });
  }

  async transferLot(body: Parameters<typeof move>[1]) {
    return this.mutate((s) => {
      move(s, body);
    });
  }

  /**
   * Precio, costo e IVA son datos de administración: bodega puede crear y editar
   * fichas, pero no cambiarlos. Todo cambio queda en el historial.
   */
  async saveProduct(body: Product & { originalId?: string }) {
    const { originalId, ...rest } = body;
    return this.mutate((s) => {
      const admin = actorIsAdmin();
      // Copia: upsertProduct modifica el producto en el lugar.
      const found = originalId ? s.products.find((p) => p.id === originalId) : undefined;
      const before = found ? { ...found } : undefined;
      const input: Product = { ...rest };
      if (before) {
        if (!admin) {
          // El costo de bodega se ignora (abajo); el IVA vacío equivale a la tarifa general.
          const iva = (v: unknown) => (v == null || v === '' ? IVA_RATE : Number(v));
          const changed =
            ('price' in rest && !sameValue(rest.price, before.price)) ||
            ('ivaRate' in rest && iva(rest.ivaRate) !== iva(before.ivaRate));
          if (changed) throw new Error('Solo administración cambia el precio, el costo o el IVA de un producto.');
        }
        // El costo promedio lo calcula la recepción; solo administración lo fija a mano.
        if (!admin || rest.avgCost === undefined) input.avgCost = before.avgCost;
      } else if (!admin) {
        delete input.avgCost;
      }
      const saved = upsertProduct(s, input, originalId);
      for (const field of SENSITIVE_PRODUCT_FIELDS) {
        recordChange(s, {
          entity: 'Producto',
          entityId: saved.id,
          entityName: saved.name,
          field: PRODUCT_FIELD_LABEL[field],
          // El IVA vacío es la tarifa general: guardar 15 % sobre vacío no es un cambio.
          from: before ? (field === 'ivaRate' ? before.ivaRate ?? IVA_RATE : before[field]) : undefined,
          to: field === 'ivaRate' ? saved.ivaRate ?? IVA_RATE : saved[field],
        });
      }
    });
  }

  /** Cancela un pedido de cliente (esperando stock, por preparar o preparado). */
  async cancelClientOrder(orderId: string, reason: string) {
    return this.mutate((s) => {
      const order = cancelOrder(s, orderId, reason);
      addEvent(s, 'Cancelación', order.lines[0]?.productId ?? '', 0, order.id, 'Cancelado', `${order.id} · ${order.cancelReason}`);
    });
  }

  async saveFamily(body: WarehouseFamily) {
    return this.mutate((s) => {
      ensureFamilies(s);
      upsertFamily(s, body);
    });
  }

  async removeFamily(id: string) {
    return this.mutate((s) => {
      ensureFamilies(s);
      deleteFamily(s, id);
    });
  }

  async placeOrder(body: Parameters<typeof createOrder>[1]) {
    let createdId = '';
    await this.mutate((s) => {
      const o = createOrder(s, body);
      if (o.status === 'Esperando stock') createBackorderPurchases(s, o);
      createdId = o.id;
    });
    return createdId;
  }

  async receivePurchaseOrder(id: string, body: Parameters<typeof receivePurchase>[2]) {
    return this.mutate((s) => {
      receivePurchase(s, id, body);
    });
  }

  async closePurchaseOrder(id: string, reason: string) {
    return this.mutate((s) => {
      closePurchase(s, id, reason);
    });
  }

  async releaseInspectedLot(lotId: string) {
    return this.mutate((s) => {
      releaseLot(s, lotId);
    });
  }

  async rejectInspectedLot(lotId: string, reason: string) {
    return this.mutate((s) => {
      rejectLot(s, lotId, reason);
    });
  }

  async importInvoiceXml(xml: string) {
    const invoice = await parseFacturaXml(xml);
    let result: ReturnType<typeof applyParsedInvoice> | null = null;
    await this.mutate((s) => {
      result = applyParsedInvoice(s, invoice);
      if (result.blocked?.length) throw new Error(result.blocked.join(' '));
    });
    if (!result) throw new Error('No se pudo importar la factura.');
    return result;
  }

  async importInvoiceFile(body: {
    fileName: string;
    mimeType?: string;
    contentBase64: string;
  }) {
    const { parseInvoiceDocument } = await import('../../domain/invoice-document.service.js');
    const raw = String(body.contentBase64 ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!raw) throw new Error('Archivo vacío.');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new Error('No se pudo leer el archivo.');
    if (buf.length > 12 * 1024 * 1024) throw new Error('El archivo supera 12 MB.');
    const invoice = await parseInvoiceDocument(
      buf,
      String(body.fileName || 'archivo'),
      String(body.mimeType || ''),
    );
    let result: ReturnType<typeof applyParsedInvoice> | null = null;
    await this.mutate((s) => {
      result = applyParsedInvoice(s, invoice);
    });
    if (!result) throw new Error('No se pudo importar el documento.');
    return result;
  }

  async getPickPlan(orderId: string) {
    const s = await this.repo.load();
    const order = s.orders.find((o) => o.id === orderId);
    if (!order) throw new Error('Pedido no encontrado.');
    return pickPlan(s, order);
  }

  async saveVehicle(body: Partial<Vehicle>) {
    return this.mutate((s) => {
      upsertVehicle(s, body);
    });
  }

  async deleteVehicle(id: string) {
    return this.mutate((s) => {
      removeFleetVehicle(s, id);
    });
  }

  async confirmPrepare(
    orderId: string,
    actor?: { id: string; role: string } | null,
  ) {
    return this.mutate((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (
        order?.assignedToUserId &&
        actor &&
        actor.role !== 'admin' &&
        actor.id !== order.assignedToUserId
      ) {
        throw new Error('Este pedido está asignado a otro bodeguero.');
      }
      prepare(s, orderId);
    });
  }

  async assignOrder(
    orderId: string,
    assignee: { id: string; name: string; role: string; companyId: string; active: boolean },
    companyId: string,
  ) {
    if (assignee.role !== 'ops') {
      throw new Error('Solo se puede asignar a usuarios con rol de bodega.');
    }
    if (!assignee.active) throw new Error('El bodeguero está inactivo.');
    if (assignee.companyId !== companyId) {
      throw new Error('El bodeguero pertenece a otra empresa.');
    }
    return this.mutate((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) throw new Error('Pedido no encontrado.');
      if (order.status !== 'Por preparar') {
        throw new Error('Solo se asignan pedidos por preparar.');
      }
      order.assignedToUserId = assignee.id;
      order.assignedToName = assignee.name;
      order.assignedAt = new Date().toISOString();
    });
  }

  async unassignOrder(orderId: string) {
    return this.mutate((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) throw new Error('Pedido no encontrado.');
      if (order.status !== 'Por preparar') {
        throw new Error('Solo se puede quitar la asignación de pedidos por preparar.');
      }
      delete order.assignedToUserId;
      delete order.assignedToName;
      delete order.assignedAt;
    });
  }

  async confirmDispatch(
    orderIds: string[],
    vehicle = 'GBA-2041',
    limits?: { maxKg?: number; maxM3?: number },
    fleet: Parameters<typeof syncFleet>[1] = [],
  ) {
    return this.mutate((s) => {
      syncFleet(s, fleet);
      assertPackedForDispatch(s, orderIds);
      dispatch(s, orderIds, vehicle, limits);
    });
  }

  async delivery(orderId: string, person: string, notes?: string, code?: string) {
    return this.mutate((s) => {
      confirmDelivery(s, orderId, person, notes, code);
    });
  }

  async incident(orderId: string, reason: string, notes?: string) {
    return this.mutate((s) => {
      registerIncident(s, orderId, reason, notes);
    });
  }

  async addClient(
    body: Omit<Client, 'id'> & {
      creditLimit?: number | string;
      paymentTermsDays?: number | string;
      marginPct?: number | string | null;
    },
  ) {
    return this.mutate((s) => {
      // Cupo y plazo los fija administración; bodega crea el cliente con el cupo por defecto.
      const admin = actorIsAdmin();
      const fallback = resolveBusinessRules(s.settings).defaultCreditLimit;
      const requested = Number(body.creditLimit);
      const creditLimit = admin && body.creditLimit != null && Number.isFinite(requested) && requested >= 0 ? requested : fallback;
      const terms = Number(body.paymentTermsDays);
      const created = createClient(s, body);
      created.creditLimit = creditLimit;
      if (admin && body.paymentTermsDays != null && Number.isInteger(terms) && terms >= 0) {
        created.paymentTermsDays = terms;
      }
      if (body.marginPct != null && String(body.marginPct).trim() !== '') {
        const margin = Number(body.marginPct);
        if (Number.isFinite(margin) && margin >= 0) {
          created.marginPct = Math.round(margin * 100) / 100;
          recordChange(s, {
            entity: 'Cliente',
            entityId: created.id,
            entityName: created.name,
            field: 'Margen de cotización (%)',
            from: undefined,
            to: created.marginPct,
          });
        }
      }
      recordChange(s, { entity: 'Cliente', entityId: created.id, entityName: created.name, field: 'Cupo de crédito', from: undefined, to: creditLimit });
      if (created.paymentTermsDays != null) {
        recordChange(s, { entity: 'Cliente', entityId: created.id, entityName: created.name, field: 'Plazo de pago (días)', from: undefined, to: created.paymentTermsDays });
      }
    });
  }

  async updateClient(
    id: string,
    body: Partial<Omit<Client, 'id'>> & {
      creditLimit?: number | string;
      paymentTermsDays?: number | string;
      marginPct?: number | string | null;
    },
  ) {
    return this.mutate((s) => {
      const c = saveClientProfile(s, id, body);
      if ((body.creditLimit !== undefined || body.paymentTermsDays !== undefined) && !actorIsAdmin()) {
        throw new Error('Solo administración cambia el cupo o el plazo de crédito.');
      }
      if (body.creditLimit !== undefined) {
        const n = Number(body.creditLimit);
        if (!Number.isFinite(n) || n < 0) throw new Error('Límite de crédito inválido.');
        recordChange(s, { entity: 'Cliente', entityId: c.id, entityName: c.name, field: 'Cupo de crédito', from: c.creditLimit, to: n });
        c.creditLimit = n;
      }
      if (body.paymentTermsDays !== undefined) {
        const n = Number(body.paymentTermsDays);
        if (!Number.isInteger(n) || n < 0) throw new Error('Plazo de pago inválido.');
        recordChange(s, { entity: 'Cliente', entityId: c.id, entityName: c.name, field: 'Plazo de pago (días)', from: c.paymentTermsDays, to: n });
        c.paymentTermsDays = n;
      }
      if (body.marginPct !== undefined) {
        if (body.marginPct === null || String(body.marginPct).trim() === '') {
          recordChange(s, {
            entity: 'Cliente',
            entityId: c.id,
            entityName: c.name,
            field: 'Margen de cotización (%)',
            from: c.marginPct,
            to: undefined,
          });
          delete c.marginPct;
        } else {
          const n = Number(body.marginPct);
          if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error('Margen de cotización inválido.');
          const next = Math.round(n * 100) / 100;
          recordChange(s, {
            entity: 'Cliente',
            entityId: c.id,
            entityName: c.name,
            field: 'Margen de cotización (%)',
            from: c.marginPct,
            to: next,
          });
          c.marginPct = next;
        }
      }
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

  async addPurchase(body: Parameters<typeof createPurchase>[1]) {
    return this.mutate((s) => {
      createPurchase(s, body);
    });
  }

  async editClientOrder(orderId: string, body: Parameters<typeof editOrder>[2]) {
    return this.mutate((s) => {
      editOrder(s, orderId, body);
    });
  }

  async editPurchaseOrder(id: string, body: Parameters<typeof editPurchase>[2]) {
    return this.mutate((s) => {
      editPurchase(s, id, body);
    });
  }

  async removeClient(id: string) {
    return this.mutate((s) => {
      deleteClient(s, id);
    });
  }

  async removeProduct(id: string) {
    return this.mutate((s) => {
      deleteProduct(s, id);
    });
  }

  async cancelPurchaseOrder(id: string) {
    return this.mutate((s) => {
      cancelPurchase(s, id);
    });
  }

  async addSupplier(body: Partial<Supplier>) {
    return this.mutate((s) => {
      createSupplier(s, body);
    });
  }

  async editSupplier(id: string, body: Partial<Supplier>) {
    return this.mutate((s) => {
      updateSupplier(s, id, body);
    });
  }

  async saveBundle(body: Partial<Bundle>) {
    return this.mutate((s) => {
      saveBundle(s, body);
    });
  }

  async removeBundle(id: string) {
    return this.mutate((s) => {
      deleteBundle(s, id);
    });
  }

  async assembleKit(body: { bundleId: string; qty: number | string; loc?: string; batch: string; expiry: string }) {
    return this.mutate((s) => {
      assembleBundle(s, body);
    });
  }

  async previewImport(body: {
    kind?: ImportKind;
    format?: string;
    text?: string;
    base64?: string;
    fileName?: string;
    mimeType?: string;
  }) {
    const state = await this.repo.load();
    const kind: ImportKind = body.kind === 'sale' ? 'sale' : 'purchase';
    const format = String(body.format || 'csv').toLowerCase();
    if (format === 'xml') {
      if (body.base64 && !body.text) {
        const xml = Buffer.from(String(body.base64), 'base64').toString('utf8');
        return previewXml(state, xml, kind);
      }
      return previewXml(state, String(body.text ?? ''), kind);
    }
    if (format === 'pdf' || format === 'docx' || format === 'doc') {
      const { parseInvoiceDocument } = await import('../../domain/invoice-document.service.js');
      const buf = Buffer.from(String(body.base64 ?? ''), 'base64');
      if (!buf.length) throw new Error('El archivo está vacío.');
      const fileName =
        String(body.fileName || '').trim() ||
        `documento.${format === 'docx' ? 'docx' : format === 'doc' ? 'doc' : 'pdf'}`;
      const invoice = await parseInvoiceDocument(buf, fileName, String(body.mimeType ?? ''));
      return previewFromInvoice(state, invoice, kind, format);
    }
    if (format === 'xlsx' || format === 'xls') return previewXlsx(state, String(body.base64 ?? ''), kind);
    return previewCsv(state, String(body.text ?? ''), kind);
  }

  async commitImport(body: Parameters<typeof commitImport>[1]) {
    let result: ReturnType<typeof commitImport> | null = null;
    const state = await this.mutate((s) => {
      result = commitImport(s, body);
    });
    return { state, import: result };
  }

  async issueSalesInvoice(orderId: string) {
    return this.mutate((s) => {
      issueInvoice(s, orderId);
    });
  }

  async issueSalesCreditNote(body: Parameters<typeof issueCreditNote>[1]) {
    return this.mutate((s) => {
      issueCreditNote(s, body);
    });
  }

  async issueDeliveryGuide(body: Parameters<typeof issueGuide>[1]) {
    return this.mutate((s) => {
      issueGuide(s, body);
    });
  }

  async collectInvoice(body: Parameters<typeof registerCustomerPayment>[1]) {
    return this.mutate((s) => {
      registerCustomerPayment(s, body);
    });
  }

  async billSupplier(body: Parameters<typeof registerSupplierBill>[1]) {
    return this.mutate((s) => {
      registerSupplierBill(s, body);
    });
  }

  async paySupplier(body: Parameters<typeof registerSupplierPayment>[1]) {
    return this.mutate((s) => {
      registerSupplierPayment(s, body);
    });
  }

  async savePriceList(body: Parameters<typeof savePriceList>[1]) {
    return this.mutate((s) => {
      savePriceList(s, body);
    });
  }

  async saveClientPrice(body: Parameters<typeof saveClientPrice>[1]) {
    return this.mutate((s) => {
      saveClientPrice(s, body);
    });
  }

  async requestStockAdjustment(body: Parameters<typeof requestAdjustment>[1]) {
    return this.mutate((s) => {
      requestAdjustment(s, body);
    });
  }

  async approveStockAdjustment(id: string) {
    return this.mutate((s) => {
      approveAdjustment(s, id);
    });
  }

  async returnStockToSupplier(body: Parameters<typeof returnToSupplier>[1]) {
    return this.mutate((s) => {
      returnToSupplier(s, body);
    });
  }

  async startCycleCount() {
    return this.mutate((s) => {
      openCycleCount(s);
    });
  }

  async applyStockCount(body: Parameters<typeof applyCycleCount>[1]) {
    return this.mutate((s) => {
      applyCycleCount(s, body);
    });
  }

  async shipWarehouseTransfer(body: Parameters<typeof shipTransfer>[1]) {
    return this.mutate((s) => {
      shipTransfer(s, body);
    });
  }

  async receiveWarehouseTransfer(body: Parameters<typeof receiveTransfer>[1]) {
    return this.mutate((s) => {
      receiveTransfer(s, body);
    });
  }

  async replenishment() {
    const state = await this.repo.load();
    return suggestReplenishment(state);
  }

  async createReplenishment() {
    return this.mutate((s) => {
      createSuggestedPurchases(s);
    });
  }

  async recall(batch: string) {
    const state = await this.repo.load();
    return recallBatch(state, batch);
  }

  async plan() {
    const state = await this.repo.load();
    return planView(state);
  }

  async approvePlan(id: string) {
    return this.mutate((s) => {
      approvePlan(s, id);
    });
  }

  async discardPlan(id: string, note?: string) {
    return this.mutate((s) => {
      discardPlan(s, id, note);
    });
  }

  async undoPlan(id: string) {
    return this.mutate((s) => {
      undoPlan(s, id);
    });
  }

  async addQuote(body: Parameters<typeof createQuote>[1]) {
    return this.mutate((s) => {
      createQuote(s, body);
    });
  }

  async winQuote(id: string) {
    return this.mutate((s) => {
      winQuote(s, id);
    });
  }

  async loseQuote(id: string) {
    return this.mutate((s) => {
      loseQuote(s, id);
    });
  }

  async addParcel(body: Parameters<typeof createParcel>[1]) {
    return this.mutate((s) => {
      createParcel(s, body);
    });
  }

  async editParcel(id: string, body: Parameters<typeof updateParcel>[2]) {
    return this.mutate((s) => {
      updateParcel(s, id, body);
    });
  }

  async removeParcel(id: string) {
    return this.mutate((s) => {
      deleteParcel(s, id);
    });
  }

  async countPackedUnits(orderId: string, body: Parameters<typeof countUnits>[2]) {
    return this.mutate((s) => {
      countUnits(s, orderId, body);
    });
  }

  async scanPackedUnit(orderId: string, code: string) {
    let scanned = '';
    const state = await this.mutate((s) => {
      scanned = scanUnit(s, orderId, code).name;
    });
    return { state, scanned };
  }

  async packingDocument(orderId: string, kind: 'labels' | 'list') {
    const state = await this.repo.load();
    return kind === 'labels' ? parcelLabelsPdf(state, orderId) : packingListPdf(state, orderId);
  }

  async closeOrderPacking(orderId: string) {
    return this.mutate((s) => {
      closePacking(s, orderId);
    });
  }

  async reopenOrderPacking(orderId: string) {
    return this.mutate((s) => {
      reopenPacking(s, orderId);
    });
  }

  async previewLoad(plate: string, orderIds: string[], fleet: LoadTruck[] = []) {
    const state = await this.repo.load();
    const truck = fleet.find((t) => t.plate.toUpperCase() === plate.trim().toUpperCase());
    if (fleet.length && !truck) throw new Error('El vehículo no está activo en la flota.');
    return loadPreview(state, plate, orderIds, truck);
  }

  async confirmTruckLoad(
    body: { plate: string; orderIds: string[]; reason?: string },
    fleet: Array<LoadTruck & { label: string; driver?: string }> = [],
  ) {
    return this.mutate((s) => {
      const wanted = body.plate.trim().toUpperCase();
      const truck = fleet.find((t) => t.plate.toUpperCase() === wanted);
      if (fleet.length && !truck) throw new Error('El vehículo no está activo en la flota.');
      syncFleet(s, fleet);
      confirmLoad(s, { ...body, outOfZone: truck ? ordersOutOfZone(s, truck, body.orderIds) : [] });
    });
  }

  async releaseTruckLoad(plate: string) {
    return this.mutate((s) => {
      releaseLoad(s, plate);
    });
  }

  async skipStop(orderId: string) {
    return this.mutate((s) => {
      skipAndReoptimize(s, orderId);
    });
  }

  async addOffering(body: Parameters<typeof saveOffering>[1]) {
    return this.mutate((s) => {
      saveOffering(s, body);
    });
  }

  async deleteOffering(id: string) {
    return this.mutate((s) => {
      removeOffering(s, id);
    });
  }

  async deliveryCode(orderId: string, key: string) {
    const state = await this.repo.load();
    return customerDeliveryCode(state, orderId, key);
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
    // Valor del inventario a costo promedio (lo que cuadra con contabilidad).
    const stockValue = s.products.reduce((n, p) => n + stock(s, p.id) * (p.avgCost ?? 0), 0);
    const saleValue = s.products.reduce((n, p) => n + stock(s, p.id) * p.price, 0);
    const missingCost = s.products.filter((p) => stock(s, p.id) > 0 && !(p.avgCost && p.avgCost > 0)).length;
    const unsellable = s.products.reduce((n, p) => n + Math.max(0, stock(s, p.id) - sellableStock(s, p.id)), 0);
    return {
      occupied,
      saleValue,
      missingCost,
      unsellableUnits: unsellable,
      waitingOrders: s.orders.filter((o) => o.status === 'Esperando stock').length,
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
