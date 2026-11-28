import { expect, test, type APIResponse, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const xml = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/facturas/factura-prueba-opticlean.xml');

type State = {
  orders: Array<{
    id: string;
    clientId: string;
    status: string;
    notes?: string;
    lines: Array<{ productId: string; qty: number }>;
    deliveryCode?: string;
    vehicle?: string;
  }>;
  clients: Array<{
    id: string;
    name: string;
    contact: string;
    address: string;
    email: string;
    type: string;
    taxId?: string;
    city?: string;
    sector?: string;
    phone?: string;
  }>;
  invoices?: Array<{ id: string; orderId: string; status: string; lines: Array<{ productId: string; qty: number; batch?: string }> }>;
  purchases: Array<{
    id: string;
    status: string;
    notes?: string;
    lines?: Array<{ productId: string; qty: number; batch?: string; expiry?: string; receivedUnits?: number }>;
  }>;
  lots: Array<{ loc: string; qty: number }>;
};

function emptySpots(state: State) {
  const used = new Set(state.lots.filter((lot) => lot.qty > 0).map((lot) => lot.loc));
  const spots: string[] = [];
  for (const rack of ['A', 'B', 'C', 'D', 'E', 'F']) {
    for (let level = 1; level <= 3; level += 1) {
      for (let pos = 1; pos <= 4; pos += 1) {
        for (const face of ['D', 'T']) {
          const id = `${rack}-${String(level).padStart(2, '0')}-${String(pos).padStart(2, '0')}-${face}`;
          if (!used.has(id)) spots.push(id);
        }
      }
    }
  }
  return spots;
}

async function call(page: Page, method: string, url: string, data?: unknown) {
  const token = await page.evaluate(() => localStorage.getItem('opticlean.auth.token'));
  const res: APIResponse = await page.request.fetch(url, {
    method,
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${url} → ${res.status()} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function stateOf(page: Page): Promise<State> {
  const body = await call(page, 'GET', '/api/state');
  return body.state as State;
}

async function moneyText(page: Page) {
  await page.goto('/');
  const money = page.getByRole('region', { name: 'Resumen financiero' });
  await expect(money.getByText('Resultado del período')).toBeVisible();
  await money.getByRole('button', { name: 'Ver desglose' }).click();
  await expect(money.getByRole('button', { name: 'Ocultar desglose' })).toBeVisible();
  return money.innerText();
}

test('El cliente importa su factura, el camión llega y el inicio muestra cada costo', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name=email]').fill('admin@innovamf.com');
  await page.locator('input[name=password]').fill('OptiClean2026!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('region', { name: 'Resumen financiero' })).toBeVisible();

  await page.goto('/pedidos/nuevo');
  await page.getByRole('button', { name: 'Subir archivo' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(xml);
  await expect(page.getByRole('dialog').getByText('Hotel Alameda S.A.')).toBeVisible();
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await expect(page).toHaveURL(/\/pedidos\/?$/);

  let state = await stateOf(page);
  const original = state.orders.find((order) => order.notes?.includes('001-001-000000123'));
  expect(original, 'El XML no creó el pedido').toBeTruthy();
  const buyer = state.clients.find((client) => client.id === original!.clientId)!;
  expect(buyer.taxId).toBe('1790012345001');

  await call(page, 'PATCH', `/api/clients/${buyer.id}`, {
    ...buyer,
    address: 'Av. República E7-123, Quito',
    phone: '0225550101',
  });
  await call(page, 'POST', `/api/orders/${original!.id}/cancel`, {
    reason: 'El cliente cambió la dirección y pidió menos cantidad.',
  });
  const changedBody = await call(page, 'POST', '/api/orders', {
    clientId: buyer.id,
    notes: `Cambio de ${original!.id}. Importado 001-001-000000123`,
    lines: original!.lines.map((line) => ({
      productId: line.productId,
      qty: line.productId === 'P001' ? Math.max(1, Math.floor(line.qty / 2)) : line.qty,
    })),
  });
  const changedId = (changedBody.state as State).orders.find((order) =>
    order.notes?.includes(`Cambio de ${original!.id}`),
  )!.id;

  await call(page, 'POST', `/api/orders/${changedId}/prepare`);
  // Empaque: un bulto por lote, con el peso del catálogo más la caja.
  const toPack = (await stateOf(page)).orders.find((order) => order.id === changedId) as unknown as {
    picks: Array<{ productId: string; batch: string; qty: number }>;
  };
  for (const pick of toPack.picks) {
    const body = await call(page, 'POST', '/api/packing/parcels', { orderId: changedId, boxCode: 'M' });
    const packed = body.state as unknown as {
      parcels: Array<{ id: string; orderId: string }>;
      products: Array<{ id: string; weight: number }>;
    };
    const parcel = packed.parcels.filter((item) => item.orderId === changedId).at(-1)!;
    const unit = packed.products.find((item) => item.id === pick.productId)!.weight;
    await call(page, 'PATCH', `/api/packing/parcels/${parcel.id}`, {
      contents: [{ productId: pick.productId, batch: pick.batch, qty: pick.qty }],
      weightKg: Math.round((unit * pick.qty + 0.4) * 100) / 100,
    });
  }
  await call(page, 'POST', `/api/packing/orders/${changedId}/close`);
  await call(page, 'POST', '/api/dispatch', { orderIds: [changedId], vehicle: 'AMB-5520' });
  state = await stateOf(page);
  const enRoute = state.orders.find((order) => order.id === changedId)!;
  expect(enRoute.status).toBe('En ruta');
  await call(page, 'POST', '/api/delivery', {
    orderId: changedId,
    person: 'Recepción del hotel',
    notes: 'Llegó a la dirección nueva',
    code: enRoute.deliveryCode,
  });
  const invoiced = await call(page, 'POST', '/api/invoices', { orderId: changedId });
  const invoice = (invoiced.state as State).invoices!.find((item) => item.orderId === changedId)!;

  let panel = await moneyText(page);
  expect(panel).toMatch(/ventas netas/i);
  expect(panel).toContain('Hotel Alameda S.A.');
  expect(panel).toContain('Camión AMB-5520');
  expect(panel).not.toContain(original!.id);

  const missing = invoice.lines[0];
  await call(page, 'POST', '/api/credit-notes', {
    invoiceId: invoice.id,
    reason: 'El cliente no recibió esta unidad.',
    lines: [{ productId: missing.productId, qty: 1, batch: missing.batch }],
  });
  panel = await moneyText(page);
  expect(panel).toContain('Reclamo');
  expect(panel).toContain('El cliente no recibió esta unidad.');

  await page.goto('/compras');
  await page.getByRole('button', { name: 'Importar' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(xml);
  await expect(page.getByRole('dialog').getByText('OPTICLEAN DISTRIBUIDORA')).toBeVisible();
  await page.getByRole('button', { name: 'Crear compra' }).click();
  await expect(page.getByText(/Compra OC-\d+ importada/)).toBeVisible();

  state = await stateOf(page);
  const purchase = state.purchases.find((item) => item.notes?.includes('001-001-000000123'))!;
  const line = purchase.lines![0];
  let received = false;
  let lastError = '';
  for (const loc of emptySpots(state).slice(0, 40)) {
    try {
      await call(page, 'POST', `/api/purchases/${purchase.id}/receive`, {
        lines: [
          {
            productId: line.productId,
            qty: 2,
            loc,
            batch: line.batch || 'LT-PARCIAL',
            expiry: line.expiry || '2027-06-30',
          },
        ],
      });
      received = true;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  expect(received, lastError).toBe(true);

  panel = await moneyText(page);
  expect(panel).toContain(purchase.id);
  expect(panel).toContain('Llegó una parte');
  // La compra parcial aparece en el desglose con lo que realmente llegó.
  const bought = page.locator('.dash-money-lines li', { hasText: purchase.id });
  await expect(bought).toContainText('Compra');
  await expect(bought.locator('em')).not.toHaveText(/^-?\s*\$\s*0[,.]00$/);

  state = await stateOf(page);
  const done = state.orders.find((order) => order.id === changedId)!;
  const dropped = state.orders.find((order) => order.id === original!.id)!;
  expect(done.status).toBe('Entregado');
  expect(done.vehicle).toBe('AMB-5520');
  expect(dropped.status).toBe('Cancelado');
  expect(state.purchases.find((item) => item.id === purchase.id)?.status).toBe('Parcial');
  expect(state.invoices?.some((item) => item.orderId === original!.id)).toBeFalsy();
});
