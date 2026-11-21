/**
 * Formatos de archivo aceptados por los componentes de carga (FileDrop).
 * Una sola fuente para el atributo `accept`, las etiquetas visibles, la
 * ruta de procesamiento y la validación previa a subir.
 */

/** Cómo se procesa el archivo: lectura con IA, vista previa tabular o adjunto simple. */
export type FileRoute = 'ai' | 'preview' | 'file';

export type FileFormat = {
  ext: string[];
  label: string;
  route?: FileRoute;
  /** MIME extra para `accept` (p. ej. `image/*`). */
  mime?: string[];
};

/** Extensiones que se reconocen pero se rechazan con un mensaje específico. */
export type RejectedFormats = Record<string, string>;

export type FileMeta = { name: string; size: number };

export const ROUTE_LABEL: Record<FileRoute, string> = {
  ai: 'Lectura con IA',
  preview: 'Vista previa',
  file: 'Adjunto',
};

export const IMPORT_FORMATS: FileFormat[] = [
  { ext: ['pdf'], label: 'PDF', route: 'ai', mime: ['application/pdf'] },
  {
    ext: ['docx'],
    label: 'Word',
    route: 'ai',
    mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  { ext: ['xml'], label: 'XML', route: 'preview' },
  { ext: ['csv', 'txt'], label: 'CSV', route: 'preview' },
  { ext: ['xlsx', 'xls'], label: 'Excel', route: 'preview' },
];

export const IMPORT_REJECTED: RejectedFormats = {
  doc: 'El .doc antiguo no está soportado. Guárdalo como .docx o PDF y vuelve a intentar.',
};

export const PDF_FORMATS: FileFormat[] = [{ ext: ['pdf'], label: 'PDF', route: 'file', mime: ['application/pdf'] }];

export const SPREADSHEET_FORMATS: FileFormat[] = [
  { ext: ['xlsx', 'xls'], label: 'Excel', route: 'file' },
  { ext: ['csv'], label: 'CSV', route: 'file' },
];

export const IMAGE_FORMATS: FileFormat[] = [
  { ext: ['jpg', 'jpeg', 'png', 'webp', 'heic'], label: 'Imagen', route: 'file', mime: ['image/*'] },
];

export const DOCUMENT_FORMATS: FileFormat[] = [...PDF_FORMATS, ...IMAGE_FORMATS];

export function extOf(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

export function findFormat(formats: FileFormat[], name: string) {
  const ext = extOf(name);
  return formats.find((format) => format.ext.includes(ext)) ?? null;
}

export function acceptAttr(formats: FileFormat[], rejected: RejectedFormats = {}) {
  // Las extensiones rechazadas se incluyen para poder explicar por qué no sirven.
  const exts = [...formats.flatMap((format) => format.ext), ...Object.keys(rejected)].map((ext) => `.${ext}`);
  const mimes = formats.flatMap((format) => format.mime ?? []);
  return [...new Set([...exts, ...mimes])].join(',');
}

/** Lista legible: "PDF, Word, XML, CSV o Excel". */
export function formatLabels(formats: FileFormat[]) {
  const labels = [...new Set(formats.map((format) => format.label))];
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} o ${labels[labels.length - 1]}` : (labels[0] ?? '');
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Devuelve el mensaje de error, o null si el archivo es válido. */
export function validateFile(
  file: File,
  { formats, rejected = {}, maxSizeMb }: { formats: FileFormat[]; rejected?: RejectedFormats; maxSizeMb?: number },
) {
  const ext = extOf(file.name);
  if (rejected[ext]) return rejected[ext];
  const isImage = file.type.startsWith('image/') && formats.some((format) => format.mime?.includes('image/*'));
  if (!findFormat(formats, file.name) && !isImage) {
    return `${ext ? `“.${ext}”` : 'Este archivo'} no se puede usar aquí. Usa ${formatLabels(formats)}.`;
  }
  if (maxSizeMb && file.size > maxSizeMb * 1024 * 1024) {
    return `Pesa ${formatBytes(file.size)}. El máximo es ${maxSizeMb} MB.`;
  }
  return null;
}

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
