import { closePacking, createParcel, expectedWeight, updateParcel } from '../../src/domain/packing.service.js';
import type { AppState } from '../../src/domain/types.js';

/** Empaca cada lote en su propio bulto (así nunca se mezclan químicos) y cierra. */
export function packAll(s: AppState, orderId: string) {
  const order = s.orders.find((item) => item.id === orderId)!;
  for (const pick of order.picks ?? []) {
    const parcel = createParcel(s, { orderId, boxCode: 'M' });
    updateParcel(s, parcel.id, {
      contents: [{ productId: pick.productId, batch: pick.batch ?? '', qty: pick.qty }],
    });
    updateParcel(s, parcel.id, { weightKg: expectedWeight(s, parcel) });
  }
  closePacking(s, orderId);
}
