/** Componente / materia prima requerida por unidad del producto padre. */
export type ProductComponent = {
  productId: string;
  qty: number;
};

export type ProductKind = 'finished' | 'raw';

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  price: number;
  min: number;
  weight: number;
  volume: number;
  /** finished = producto de venta; raw = insumo / materia prima */
  kind?: ProductKind;
  /** Hijos (insumos) necesarios para reponer / fabricar este producto */
  components?: ProductComponent[];
  /** Familia de bodega asignada (opcional; si falta se infiere por categoría) */
  familyId?: string;
  /** Producto frágil: prioriza zonas bajas y racks de familia frágil */
  fragile?: boolean;
};

/** Familia operativa de bodega: agrupa líneas y racks para ubicación inteligente. */
export type WarehouseFamily = {
  id: string;
  code: string;
  name: string;
  productCategories: string[];
  rackIds: string[];
  fragilePreferred: boolean;
  color: string;
  notes?: string;
};

export type Lot = {
  id: string;
  productId: string;
  loc: string;
  qty: number;
  batch: string;
  expiry: string;
  warehouseId?: string;
};

export type LocationFace = 'D' | 'T';

export type RackPosition = { rackId: string; column: number; row: number };

export type WarehouseLayout = {
  rackCount: number;
  levels: number;
  positionsPerLevel: number;
  capacityPerCell: number;
  /** 1 = una cara; 2 = delantera y trasera por casilla */
  depthFaces: 1 | 2;
  rackPositions?: RackPosition[];
};

export type WarehouseSite = {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  status: 'Operativa' | 'Inactiva';
  racks: number;
  layout: WarehouseLayout;
  notes?: string;
};

export type Client = {
  id: string;
  name: string;
  contact: string;
  address: string;
  email: string;
  type: string;
};

export type OrderLine = { productId: string; qty: number };

export type OrderPick = OrderLine & {
  batch?: string;
  loc?: string;
  expiry?: string;
};

export type Order = {
  id: string;
  clientId: string;
  status: string;
  date: string;
  lines: OrderLine[];
  priority: string;
  vehicle?: string;
  picks?: OrderPick[];
  incident?: string;
  deliveredTo?: string;
  deliveryNotes?: string;
  deliveredAt?: string;
};

export type TraceEvent = {
  id: string;
  type: string;
  productId: string;
  qty: number;
  from: string;
  to: string;
  at: string;
  ref: string;
  by: string;
  batch?: string;
};

export type Receipt = {
  id: string;
  supplier: string;
  date: string;
  productId: string;
  qty: number;
  loc: string;
  batch: string;
};

export type Purchase = {
  id: string;
  productId: string;
  qty: number;
  date: string;
  notes?: string;
};

export type Settings = {
  company: string;
  warehouse: string;
  operator: string;
  activeWarehouseId?: string;
};

export type AppState = {
  version: 1 | 2;
  products: Product[];
  lots: Lot[];
  warehouses: WarehouseSite[];
  clients: Client[];
  orders: Order[];
  events: TraceEvent[];
  purchases: Purchase[];
  receipts: Receipt[];
  settings: Settings;
  /** Familias de bodega para reglas de ubicación */
  families?: WarehouseFamily[];
};

export type Location = {
  id: string;
  rack: string;
  level: number;
  pos: number;
  capacity: number;
  category: string;
  face?: LocationFace;
};

export type Rack = {
  id: string;
  name: string;
  category: string;
  x: number;
  y: number;
};
