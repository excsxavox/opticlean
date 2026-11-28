/**
 * PDF del empaque: una etiqueta de 100×150 mm por bulto y la lista de empaque en A4.
 * Se escribe el PDF a mano (Helvetica + rectángulos para el código de barras) para no sumar dependencias.
 */
import { hazardOf, HAZARD_LABEL } from './hazard.js';
import { client, product } from './inventory.service.js';
import { parcelsOf } from './packing.service.js';
import type { AppState, Order, Parcel } from './types.js';

/* ─── Code 128 (juego B) ─────────────────────────────────── */

export const CODE128_PATTERNS = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

const START_B = 104;
const STOP = 106;

/** Valores del símbolo: inicio B, datos, dígito de control y parada. */
export function code128Values(text: string): number[] {
  const data = [...text].map((char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error('El código de barras solo admite caracteres ASCII.');
    return code - 32;
  });
  const checksum = data.reduce((sum, value, index) => sum + value * (index + 1), START_B) % 103;
  return [START_B, ...data, checksum, STOP];
}

/* ─── PDF mínimo ─────────────────────────────────────────── */

type Page = { width: number; height: number; ops: string[] };

/** Helvetica con WinAnsi cubre tildes y eñes; lo que no entra se sustituye. */
function pdfText(value: string) {
  return value
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, ' ')
    .replace(/([\\()])/g, '\\$1');
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 3)}...` : value);

function text(page: Page, x: number, y: number, value: string, size = 10, bold = false) {
  page.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`);
}

function rule(page: Page, x: number, y: number, width: number, height = 0.8) {
  page.ops.push(`${x} ${y} ${width} ${height} re f`);
}

function barcode(page: Page, x: number, y: number, maxWidth: number, height: number, value: string) {
  const widths = code128Values(value).map((v) => CODE128_PATTERNS[v]);
  const modules = widths.join('').split('').reduce((sum, w) => sum + Number(w), 0);
  const unit = Math.min(1.6, maxWidth / (modules + 20));
  let cursor = x + (maxWidth - modules * unit) / 2;
  for (const pattern of widths) {
    [...pattern].forEach((w, index) => {
      const width = Number(w) * unit;
      if (index % 2 === 0) rule(page, Number(cursor.toFixed(3)), y, Number(width.toFixed(3)), height);
      cursor += width;
    });
  }
}

function buildPdf(pages: Page[]) {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((page, index) => {
    const stream = page.ops.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${6 + index * 2} 0 R ` +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>',
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/* ─── Documentos ─────────────────────────────────────────── */

function packedOrder(s: AppState, orderId: string) {
  const order = s.orders.find((item) => item.id === orderId);
  if (!order) throw new Error('Pedido no encontrado.');
  const parcels = parcelsOf(s, orderId);
  // El empaque queda registrado aunque el pedido ya haya salido, para reimprimir.
  if (!order.packing || !parcels.length) throw new Error('Cierra el empaque antes de imprimir sus documentos.');
  return { order, parcels, buyer: client(s, order.clientId) };
}

const num = (n: number, decimals = 1) =>
  n.toLocaleString('es-EC', { maximumFractionDigits: decimals });

const itemName = (s: AppState, id: string) => product(s, id)?.name ?? id;

function flagsOf(s: AppState, parcel: Parcel) {
  const items = (parcel.contents ?? []).map((line) => product(s, line.productId));
  const hazards = [...new Set(items.map((item) => hazardOf(item)).filter((h) => h !== 'none'))];
  return { fragile: items.some((item) => item?.fragile), hazards: hazards.map((h) => HAZARD_LABEL[h]) };
}

const destination = (s: AppState, order: Order) => {
  const buyer = client(s, order.clientId);
  return [buyer?.sector, buyer?.city].filter(Boolean).join(', ');
};

export function parcelLabelsPdf(s: AppState, orderId: string) {
  const { order, parcels, buyer } = packedOrder(s, orderId);
  const pages = parcels.map((parcel, index) => {
    const page: Page = { width: 283, height: 425, ops: [] };
    const flags = flagsOf(s, parcel);
    text(page, 16, 402, clip(s.settings.company, 38), 10, true);
    rule(page, 16, 394, 251);
    text(page, 16, 370, order.id, 20, true);
    text(page, 160, 370, `Bulto ${index + 1} de ${parcels.length}`, 13, true);
    text(page, 16, 346, clip(buyer?.name ?? order.clientId, 34), 13, true);
    text(page, 16, 331, clip(buyer?.address ?? '', 48), 10);
    text(page, 16, 318, clip(destination(s, order), 48), 10);
    text(page, 16, 305, clip([buyer?.contact, buyer?.phone].filter(Boolean).join(' · '), 48), 10);
    rule(page, 16, 296, 251);
    const dims = parcel.dims ? `${parcel.dims.l}×${parcel.dims.w}×${parcel.dims.h} cm` : '';
    text(page, 16, 281, `${num(parcel.weightKg, 2)} kg   ${dims}`, 11, true);
    if (order.stagedPlate || order.vehicle) {
      const stop = order.stopOrder ? ` · Parada ${order.stopOrder}` : '';
      text(page, 16, 266, `Camión ${order.stagedPlate || order.vehicle}${stop}`, 11);
    }
    let y = 246;
    if (flags.fragile) {
      text(page, 16, y, 'FRÁGIL - NO APILAR PESO ENCIMA', 12, true);
      y -= 16;
    }
    if (flags.hazards.length) {
      text(page, 16, y, clip(`QUÍMICO: ${flags.hazards.join(', ')}`, 40), 11, true);
      y -= 16;
    }
    y -= 4;
    const lines = parcel.contents ?? [];
    for (const line of lines.slice(0, 8)) {
      text(page, 16, y, clip(`${line.qty} × ${itemName(s, line.productId)} · ${line.batch || 's/l'}`, 52), 9);
      y -= 12;
    }
    if (lines.length > 8) text(page, 16, y, `y ${lines.length - 8} producto(s) más: ver lista de empaque`, 9);
    barcode(page, 16, 40, 251, 56, parcel.id);
    text(page, 112, 24, parcel.id, 11, true);
    return page;
  });
  return { filename: `etiquetas-${order.id}.pdf`, buffer: buildPdf(pages) };
}

export function packingListPdf(s: AppState, orderId: string) {
  const { order, parcels, buyer } = packedOrder(s, orderId);
  const pages: Page[] = [];
  let page!: Page;
  let y = 0;
  const newPage = () => {
    page = { width: 595, height: 842, ops: [] };
    pages.push(page);
    text(page, 40, 800, `Lista de empaque · ${order.id}`, 16, true);
    text(page, 40, 782, clip(s.settings.company, 70), 10);
    text(page, 470, 782, `Página ${pages.length}`, 9);
    rule(page, 40, 774, 515);
    y = 756;
  };
  const room = (needed: number) => {
    if (y - needed < 70) newPage();
  };
  newPage();
  text(page, 40, y, clip(buyer?.name ?? order.clientId, 70), 12, true);
  y -= 15;
  text(page, 40, y, clip([buyer?.address, destination(s, order)].filter(Boolean).join(' · '), 95), 10);
  y -= 14;
  const closed = order.packing!;
  text(
    page,
    40,
    y,
    `Empacado el ${closed.closedAt.slice(0, 10)}${closed.closedBy ? ` por ${closed.closedBy}` : ''}`,
    10,
  );
  y -= 24;

  parcels.forEach((parcel, index) => {
    const lines = parcel.contents ?? [];
    room(48 + Math.min(lines.length, 3) * 13);
    const dims = parcel.dims ? ` · ${parcel.dims.l}×${parcel.dims.w}×${parcel.dims.h} cm` : '';
    text(
      page,
      40,
      y,
      `Bulto ${index + 1} de ${parcels.length} · ${parcel.id} · ${num(parcel.weightKg, 2)} kg${dims}`,
      11,
      true,
    );
    y -= 15;
    text(page, 40, y, 'Cant.', 9, true);
    text(page, 80, y, 'Producto', 9, true);
    text(page, 390, y, 'Código', 9, true);
    text(page, 475, y, 'Lote', 9, true);
    y -= 4;
    rule(page, 40, y, 515, 0.4);
    y -= 12;
    for (const line of lines) {
      room(13);
      text(page, 40, y, String(line.qty), 10);
      text(page, 80, y, clip(itemName(s, line.productId), 58), 10);
      text(page, 390, y, clip(product(s, line.productId)?.sku ?? line.productId, 14), 10);
      text(page, 475, y, clip(line.batch || 's/l', 14), 10);
      y -= 13;
    }
    if (parcel.weightNote) {
      room(13);
      text(page, 80, y, clip(`Diferencia de peso: ${parcel.weightNote}`, 80), 9);
      y -= 13;
    }
    y -= 10;
  });

  const units = parcels.reduce((n, p) => n + (p.contents ?? []).reduce((m, l) => m + l.qty, 0), 0);
  room(90);
  rule(page, 40, y, 515);
  y -= 16;
  text(
    page,
    40,
    y,
    `Total: ${parcels.length} bulto(s) · ${units} unidades · ${num(
      parcels.reduce((n, p) => n + p.weightKg, 0),
      2,
    )} kg · ${num(
      parcels.reduce((n, p) => n + p.volumeM3, 0),
      3,
    )} m³`,
    11,
    true,
  );
  y -= 46;
  rule(page, 40, y, 200, 0.6);
  rule(page, 330, y, 200, 0.6);
  text(page, 40, y - 13, 'Entrega (bodega)', 9);
  text(page, 330, y - 13, 'Recibe conforme (cliente)', 9);
  return { filename: `lista-empaque-${order.id}.pdf`, buffer: buildPdf(pages) };
}
