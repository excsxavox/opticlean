/**
 * Ordena los avisos de la vista previa de importación por línea.
 *
 * El backend devuelve texto con forma "CÓDIGO: mensaje" (import-docs.service.ts).
 * Aquí se asigna cada aviso a la línea de su código y se clasifica:
 * - stock:  impide crear el documento
 * - expiry: la caducidad falta; es opcional, así que no se muestra por línea
 * - other:  se muestra en el tooltip de la línea
 * Los avisos sin código, o con un código que no está en la tabla, quedan como generales.
 */

export type RowIssues = { noStock: boolean; messages: string[] };

const LINE = /^([^:]{1,60}):\s*(.+)$/;

function classify(message: string) {
  const text = message.toLowerCase();
  if (text.includes('stock')) return 'stock' as const;
  if (text.includes('caducidad')) return 'expiry' as const;
  return 'other' as const;
}

export function indexImportWarnings(warnings: string[], codes: string[]) {
  const known = new Set(codes);
  const byCode = new Map<string, RowIssues>();
  const general: string[] = [];

  for (const warning of warnings) {
    const match = LINE.exec(warning.trim());
    const code = match?.[1].trim() ?? '';
    const message = (match?.[2] ?? warning).trim();
    const kind = classify(message);
    if (kind === 'expiry') continue;
    if (!code || !known.has(code)) {
      general.push(warning.trim());
      continue;
    }
    const issues = byCode.get(code) ?? { noStock: false, messages: [] };
    if (kind === 'stock') issues.noStock = true;
    else issues.messages.push(message);
    byCode.set(code, issues);
  }

  return { byCode, general };
}
