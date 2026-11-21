import type { AppState } from './types.js';
import { clientForecast, stepDiagnostics } from './outbound.service.js';

export type ReportKind = 'traceability' | 'diagnostics';
export type ReportFormat = 'xlsx' | 'pdf';

function ascii(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/[()\\]/g, ' ')
    .slice(0, 110);
}

function pdf(title: string, lines: string[]) {
  const body = ['BT /F1 11 Tf 48 760 Td', `(${ascii(title)}) Tj`].concat(
    lines.slice(0, 42).flatMap((line) => ['0 -16 Td', `(${ascii(line)}) Tj`]),
  );
  body.push('ET');
  const stream = body.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let pdfText = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdfText.length);
    pdfText += `${object}\n`;
  }
  const xref = pdfText.length;
  pdfText += `xref\n0 6\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdfText += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdfText += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdfText, 'latin1');
}

function rowsOf(state: AppState, kind: ReportKind): { title: string; headers: string[]; rows: string[][] } {
  if (kind === 'diagnostics') {
    const forecast = clientForecast(state).filter((row) => row.orders > 0);
    const steps = stepDiagnostics(state);
    return {
      title: 'Diagnostico de entrega y pronostico',
      headers: ['Tipo', 'Referencia', 'Detalle', 'Horas o confianza', 'Alerta'],
      rows: [
        ...steps.map((row) => ['Entrega', row.orderId, row.incident || 'Sin novedad', String(row.hours), row.late ? 'Tarde' : 'En tiempo']),
        ...forecast.map((row) => ['Pronostico', row.name, `${row.orders} pedidos / ${row.weeklyUnits} u semana`, `${row.confidence}%`, row.deviationPct ? `${row.deviationPct}%` : '']),
      ],
    };
  }
  return {
    title: 'Trazabilidad',
    headers: ['Cuando', 'Tipo', 'Producto', 'Cantidad', 'Desde', 'Hacia', 'Referencia', 'Lote'],
    rows: state.events.slice(0, 400).map((event) => [
      event.at,
      event.type,
      event.productId,
      String(event.qty),
      event.from,
      event.to,
      event.ref,
      event.batch ?? '',
    ]),
  };
}

export async function renderReport(state: AppState, kind: ReportKind, format: ReportFormat) {
  const table = rowsOf(state, kind);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'pdf') {
    const lines = [table.headers.join(' | '), ...table.rows.map((row) => row.join(' | '))];
    return {
      filename: `OPTICLEAN_${kind}_${stamp}.pdf`,
      contentType: 'application/pdf',
      buffer: pdf(table.title, lines),
    };
  }
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, kind === 'diagnostics' ? 'Diagnostico' : 'Trazabilidad');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    filename: `OPTICLEAN_${kind}_${stamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}
