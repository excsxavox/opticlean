import { locations } from './warehouse.js';
import type { AppState } from './types.js';
import { DEFAULT_WAREHOUSE_ID } from './warehouse-admin.service.js';
import { DEFAULT_LAYOUT } from './warehouse-layout.js';

export function seed(): AppState {
  const warehouses: AppState['warehouses'] = [
    {
      id: 'WH-QT-01',
      code: 'BOD-QTO',
      name: 'Bodega principal',
      city: 'Quito',
      address: 'Av. Galo Plaza Lasso, Quito',
      status: 'Operativa',
      racks: DEFAULT_LAYOUT.rackCount,
      layout: { ...DEFAULT_LAYOUT },
      notes: 'Layout 3D de demostración (72 posiciones).',
    },
    {
      id: 'WH-GYQ-01',
      code: 'BOD-GYE',
      name: 'Bodega Guayaquil',
      city: 'Guayaquil',
      address: 'Vía a la Costa, Guayaquil',
      status: 'Operativa',
      racks: 4,
      layout: { rackCount: 4, levels: 3, positionsPerLevel: 4, capacityPerCell: 60 },
      notes: 'Sin stock inicial · lista para recepciones.',
    },
    {
      id: 'WH-CUE-01',
      code: 'BOD-CUE',
      name: 'Centro de distribución Cuenca',
      city: 'Cuenca',
      address: 'Parque industrial, Cuenca',
      status: 'Inactiva',
      racks: 2,
      layout: { rackCount: 2, levels: 2, positionsPerLevel: 3, capacityPerCell: 50 },
      notes: 'En acondicionamiento.',
    },
  ];
  const products = (
    [
      ['P001', 'Limpiador multiusos 1 L', 'Hogar', 'Química Andina', 2.5, 30, 1.05, 1.2],
      ['P005', 'Desengrasante industrial 5 L', 'Industrial', 'Química Andina', 12.5, 24, 5.2, 6],
      ['P008', 'Desinfectante 1 L', 'Hospitalaria', 'Higiene Pro', 3.1, 25, 1.05, 1.2],
      ['P012', 'Papel higiénico institucional', 'Institucional', 'Papelera del Ecuador', 18.9, 20, 3, 18],
      ['P015', 'Limpiavidrios 5 L', 'Hogar', 'Química Andina', 6.75, 20, 5.1, 6],
      ['P018', 'Cloro 5 L', 'Industrial', 'Química Andina', 4.75, 25, 5.4, 6],
      ['P025', 'Toallas de papel · paquete', 'Institucional', 'Papelera del Ecuador', 9.8, 18, 1.8, 10],
      ['P032', 'Limpiador de pisos 5 L', 'Hogar', 'Limpieza Total', 8.5, 20, 5.1, 6],
      ['P045', 'Jabón líquido 1 L', 'Hospitalaria', 'Higiene Pro', 4.2, 25, 1.1, 1.2],
      ['P052', 'Guantes de nitrilo · caja', 'Hospitalaria', 'Higiene Pro', 7.5, 12, 0.5, 2],
      ['P061', 'Detergente industrial 5 kg', 'Industrial', 'Limpieza Total', 14.9, 20, 5, 7],
      ['P078', 'Fundas de basura · paquete', 'Institucional', 'EcoSuministros', 3.8, 20, 1, 3],
    ] as const
  ).map(([id, name, category, supplier, price, min, weight, volume]) => ({
    id,
    sku: id,
    name,
    category,
    supplier,
    price,
    min,
    weight,
    volume,
  }));

  const lots: AppState['lots'] = [];
  for (const [i, loc] of locations.entries()) {
    if (i % 4 === 3 || i % 11 === 0) continue;
    const options = products.filter((p) => p.category === loc.category && p.id !== 'P015');
    const p = options[(i + Math.floor(i / 4)) % options.length];
    lots.push({
      id: `lot-${i}`,
      productId: p.id,
      loc: loc.id,
      qty: 12 + ((i * 7) % 33),
      batch: `LT-26${String(i + 1).padStart(3, '0')}`,
      expiry: `2027-${String(2 + (i % 9)).padStart(2, '0')}-28`,
      warehouseId: DEFAULT_WAREHOUSE_ID,
    });
  }
  lots.push({
    id: 'lot-limpiavidrios',
    productId: 'P015',
    loc: 'A-01-01',
    qty: 8,
    batch: 'LT-26018',
    expiry: '2027-02-18',
    warehouseId: DEFAULT_WAREHOUSE_ID,
  });

  const clients: AppState['clients'] = [
    {
      id: 'CL001',
      name: 'Hotel Alameda',
      contact: 'María Torres',
      address: 'Av. Amazonas, Quito',
      email: 'compras@alameda.example',
      type: 'Hotelería',
    },
    {
      id: 'CL002',
      name: 'Clínica del Norte',
      contact: 'Andrés Molina',
      address: 'Av. 6 de Diciembre, Quito',
      email: 'compras@clinicanorte.example',
      type: 'Salud',
    },
    {
      id: 'CL003',
      name: 'Corporación Horizonte',
      contact: 'Carolina Ruiz',
      address: 'Av. República, Quito',
      email: 'compras@horizonte.example',
      type: 'Corporativo',
    },
    {
      id: 'CL004',
      name: 'Restaurante La Terraza',
      contact: 'Diego Salazar',
      address: 'La Floresta, Quito',
      email: 'compras@laterraza.example',
      type: 'Restauración',
    },
  ];

  const orders: AppState['orders'] = [
    {
      id: 'PED-1048',
      clientId: 'CL001',
      status: 'Por preparar',
      date: '2026-10-27',
      lines: [
        { productId: 'P001', qty: 12 },
        { productId: 'P025', qty: 8 },
      ],
      priority: 'Alta',
    },
    {
      id: 'PED-1047',
      clientId: 'CL002',
      status: 'Por preparar',
      date: '2026-10-27',
      lines: [
        { productId: 'P008', qty: 20 },
        { productId: 'P052', qty: 10 },
      ],
      priority: 'Normal',
    },
    {
      id: 'PED-1046',
      clientId: 'CL003',
      status: 'Preparado',
      date: '2026-10-27',
      lines: [
        { productId: 'P012', qty: 6 },
        { productId: 'P045', qty: 12 },
      ],
      priority: 'Normal',
    },
    {
      id: 'PED-1045',
      clientId: 'CL004',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [
        { productId: 'P005', qty: 4 },
        { productId: 'P018', qty: 6 },
      ],
      priority: 'Normal',
      vehicle: 'GBA-2041',
    },
    {
      id: 'PED-1044',
      clientId: 'CL001',
      status: 'Entregado',
      date: '2026-10-26',
      lines: [
        { productId: 'P001', qty: 10 },
        { productId: 'P025', qty: 6 },
      ],
      priority: 'Normal',
    },
  ];

  const events: AppState['events'] = [
    {
      id: 'ev-3',
      type: 'Recepción',
      productId: 'P001',
      qty: 24,
      from: 'Química Andina',
      to: 'A-02-01',
      at: '2026-10-27T13:42:00Z',
      ref: 'REC-0083',
      by: 'Elena R.',
    },
    {
      id: 'ev-2',
      type: 'Traslado',
      productId: 'P008',
      qty: 12,
      from: 'F-03-02',
      to: 'F-01-01',
      at: '2026-10-27T13:18:00Z',
      ref: 'MOV-0032',
      by: 'Elena R.',
    },
    {
      id: 'ev-1',
      type: 'Despacho',
      productId: 'P005',
      qty: 4,
      from: 'C-01-01',
      to: 'PED-1045',
      at: '2026-10-27T12:50:00Z',
      ref: 'PED-1045',
      by: 'Elena R.',
    },
  ];

  return {
    version: 1,
    products,
    lots,
    warehouses,
    clients,
    orders,
    events,
    purchases: [],
    receipts: [
      {
        id: 'REC-0083',
        supplier: 'Química Andina',
        date: '2026-10-27',
        productId: 'P001',
        qty: 24,
        loc: 'A-02-01',
        batch: 'LT-26025',
      },
    ],
    settings: {
      company: 'OPTICLEAN AI',
      warehouse: 'Bodega principal · Quito',
      operator: 'Elena R.',
      activeWarehouseId: DEFAULT_WAREHOUSE_ID,
    },
  };
}
