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

export type WarehouseLayout = {
  rackCount: number;
  levels: number;
  positionsPerLevel: number;
  capacityPerCell: number;
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
export type OrderPick = OrderLine & { batch?: string; loc?: string; expiry?: string };

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
  version: 1;
  products: Product[];
  lots: Lot[];
  warehouses: WarehouseSite[];
  clients: Client[];
  orders: Order[];
  events: TraceEvent[];
  purchases: Purchase[];
  receipts: Receipt[];
  settings: Settings;
};

export type Location = {
  id: string;
  rack: string;
  level: number;
  pos: number;
  capacity: number;
  category: string;
};

export type Rack = {
  id: string;
  name: string;
  category: string;
  x: number;
  y: number;
};

export type Bundle = {
  id: string;
  name: string;
  description: string;
  lines: OrderLine[];
};

export type Metrics = {
  occupied: number;
  occupancyPct: number;
  stockValue: number;
  lowCount: number;
  pendingOrders: number;
};

export type Meta = {
  categories: string[];
  racks: Rack[];
  locations: Location[];
  bundles: Bundle[];
};
