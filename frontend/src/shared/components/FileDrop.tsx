import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon, Spinner } from './Icon';
import { Button, cx } from './ui';
import {
  ROUTE_LABEL,
  acceptAttr,
  extOf,
  formatBytes,
  formatLabels,
  validateFile,
  type FileFormat,
  type FileMeta,
  type FileRoute,
  type RejectedFormats,
} from '../lib/fileFormats';
import '../../styles/file-drop.css';

/**
 * Componentes de carga de archivos. Todos comparten validación, arrastrar y
 * soltar y el selector nativo oculto; cambian en cómo se presentan:
 *
 * - FileDropZone      zona grande para importar un documento (con etapas de lectura)
 * - FileField         campo de formulario de un solo archivo
 * - FileGallery       varias imágenes con miniaturas (evidencias, fotos)
 * - FileAttachButton  botón de icono con contador, para filas de tabla
 *
 * Son controlados: el padre guarda el archivo y el estado, el componente pinta.
 */

type PickerOptions = {
  formats: FileFormat[];
  rejected?: RejectedFormats;
  maxSizeMb?: number;
  multiple?: boolean;
  /** Cuántos archivos más se aceptan (galería). */
  remaining?: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (message: string, file: File) => void;
};

function useFilePicker({
  formats,
  rejected,
  maxSizeMb,
  multiple,
  remaining,
  disabled,
  onFiles,
  onReject,
}: PickerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const take = (list: FileList | null) => {
    if (disabled || !list?.length) return;
    let files = Array.from(list);
    if (!multiple) files = files.slice(0, 1);
    if (remaining !== undefined) files = files.slice(0, Math.max(remaining, 0));
    const valid: File[] = [];
    for (const file of files) {
      const error = validateFile(file, { formats, rejected, maxSizeMb });
      if (error) onReject?.(error, file);
      else valid.push(file);
    }
    if (valid.length) onFiles(valid);
  };

  const dragProps = {
    onDragEnter: (event: DragEvent) => {
      if (disabled || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (disabled || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      depth.current = Math.max(depth.current - 1, 0);
      if (!depth.current) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      take(event.dataTransfer.files);
    },
  };

  const input = (extra?: { id?: string; capture?: 'environment' | 'user' }) => (
    <input
      ref={inputRef}
      id={extra?.id}
      type="file"
      hidden
      multiple={multiple}
      capture={extra?.capture}
      accept={acceptAttr(formats, rejected)}
      onChange={(event) => {
        take(event.target.files);
        event.target.value = '';
      }}
    />
  );

  return { open: () => !disabled && inputRef.current?.click(), dragging, dragProps, input };
}

function FileBadge({ name, small }: { name: string; small?: boolean }) {
  const ext = extOf(name) || 'file';
  return (
    <span className={cx('fd-ext', `fd-ext-${ext}`, small && 'small')} aria-hidden>
      {ext.slice(0, 4).toUpperCase()}
    </span>
  );
}

function RouteBadge({ route }: { route: FileRoute }) {
  return (
    <span className={cx('fd-route-badge', route)}>
      <Icon name={route === 'ai' ? 'spark' : 'grid'} />
      {ROUTE_LABEL[route]}
    </span>
  );
}

// ─── Zona de importación ───────────────────────────────────────────────

export type FileDropStatus = 'idle' | 'reading' | 'ready' | 'error';

export function FileDropZone({
  id,
  formats,
  rejected,
  maxSizeMb,
  status,
  file,
  route,
  steps = [],
  step = 0,
  summary,
  error,
  onFiles,
  onReject,
  onClear,
}: {
  id?: string;
  formats: FileFormat[];
  rejected?: RejectedFormats;
  maxSizeMb?: number;
  status: FileDropStatus;
  file?: FileMeta | null;
  /** Ruta del archivo cargado, se muestra como insignia. */
  route?: FileRoute | null;
  /** Etapas de lectura; `step` es el índice de la actual. */
  steps?: string[];
  step?: number;
  /** Texto corto cuando el archivo está listo (p. ej. "3 líneas · Cliente X"). */
  summary?: ReactNode;
  error?: string;
  onFiles: (files: File[]) => void;
  onReject?: (message: string, file: File) => void;
  onClear?: () => void;
}) {
  const busy = status === 'reading';
  const picker = useFilePicker({ formats, rejected, maxSizeMb, disabled: busy, onFiles, onReject });
  const showFile = status !== 'idle' && file;
  const pickable = !showFile && !busy;

  // Píldoras agrupadas por ruta: "Lectura con IA: PDF · Word", "Vista previa: XML · CSV · Excel".
  const routes = (['ai', 'preview', 'file'] as FileRoute[])
    .map((r) => ({ route: r, labels: [...new Set(formats.filter((f) => (f.route ?? 'file') === r).map((f) => f.label))] }))
    .filter((group) => group.labels.length);

  return (
    <>
    {picker.input({ id })}
    <div
      className={cx('fd-zone', status, picker.dragging && 'dragging')}
      {...picker.dragProps}
      onClick={() => {
        if (pickable) picker.open();
      }}
      onKeyDown={(event) => {
        if (pickable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          picker.open();
        }
      }}
      role={pickable ? 'button' : undefined}
      tabIndex={pickable ? 0 : undefined}
      aria-label={pickable ? `Elegir archivo: ${formatLabels(formats)}` : undefined}
      aria-busy={busy}
    >
      {!showFile ? (
        <>
          <span className="fd-zone-icon">
            <Icon name="upload" />
          </span>
          <span className="fd-zone-title">
            {picker.dragging ? 'Suelta para cargar' : (
              <>
                Arrastra el archivo aquí o <u>elige uno</u>
              </>
            )}
          </span>
          <span className="fd-zone-routes">
            {routes.map((group) => (
              <span key={group.route} className={cx('fd-route', group.route)}>
                {group.route !== 'file' ? <Icon name={group.route === 'ai' ? 'spark' : 'grid'} /> : null}
                {group.route !== 'file' ? <b>{ROUTE_LABEL[group.route]}</b> : null}
                {group.labels.join(' · ')}
              </span>
            ))}
          </span>
          {maxSizeMb ? <span className="fd-zone-limit">Un archivo · hasta {maxSizeMb} MB</span> : null}
          {picker.dragging ? null : error && status === 'error' ? (
            <span className="fd-error" role="alert">
              <Icon name="stop" />
              {error}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <div className="fd-chip">
            <FileBadge name={file.name} />
            <div className="fd-chip-main">
              <span className="fd-chip-name" title={file.name}>
                {file.name}
              </span>
              <span className="fd-chip-meta">
                {route && status !== 'error' ? <RouteBadge route={route} /> : null}
                {status === 'ready' ? (
                  <span className="fd-route-badge ok">
                    <Icon name="check" />
                    Listo
                  </span>
                ) : null}
                {status === 'error' ? <span className="fd-route-badge err">No se pudo leer</span> : null}
                <span>{formatBytes(file.size)}</span>
                {status === 'ready' && summary ? <span>{summary}</span> : null}
              </span>
            </div>
            {busy ? null : (
              <div className="fd-chip-actions">
                <Button size="small" icon="swap" variant={status === 'error' ? 'primary' : 'secondary'} onClick={picker.open}>
                  {status === 'error' ? 'Elegir otro' : 'Cambiar'}
                </Button>
                {onClear ? (
                  <button type="button" className="icon-btn fd-icon-btn" aria-label="Quitar archivo" onClick={onClear}>
                    <Icon name="close" />
                  </button>
                ) : null}
              </div>
            )}
          </div>
          {busy && steps.length ? (
            <>
              <div className="fd-bar" aria-hidden>
                <span style={{ width: `${Math.round(((step + 0.5) / steps.length) * 100)}%` }} />
              </div>
              <ol className="fd-steps" aria-live="polite">
                {steps.map((label, index) => (
                  <li key={label} className={index < step ? 'done' : index === step ? 'now' : ''}>
                    <i>{index < step ? <Icon name="check" /> : index === step ? <Spinner /> : null}</i>
                    {label}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {status === 'error' && error ? (
            <span className="fd-error" role="alert">
              <Icon name="stop" />
              {error}
            </span>
          ) : null}
          {picker.dragging ? <span className="fd-zone-overlay">Suelta para reemplazar</span> : null}
        </>
      )}
    </div>
    </>
  );
}

// ─── Campo de formulario ───────────────────────────────────────────────

export function FileField({
  id,
  formats,
  rejected,
  maxSizeMb,
  file,
  placeholder = 'Sin archivo',
  disabled,
  onFiles,
  onReject,
  onClear,
  onView,
}: {
  id?: string;
  formats: FileFormat[];
  rejected?: RejectedFormats;
  maxSizeMb?: number;
  file: FileMeta | null;
  placeholder?: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (message: string, file: File) => void;
  onClear?: () => void;
  onView?: () => void;
}) {
  const picker = useFilePicker({ formats, rejected, maxSizeMb, disabled, onFiles, onReject });
  return (
    <div className={cx('fd-field', !file && 'empty', picker.dragging && 'dragging')} {...picker.dragProps}>
      {file ? (
        <>
          <FileBadge name={file.name} small />
          <span className="fd-chip-main">
            <span className="fd-chip-name" title={file.name}>
              {file.name}
            </span>
            <span className="fd-chip-meta">{formatBytes(file.size)}</span>
          </span>
          {onView ? (
            <Button size="small" icon="eye" onClick={onView}>
              Ver
            </Button>
          ) : null}
          <Button size="small" disabled={disabled} onClick={picker.open}>
            Cambiar
          </Button>
          {onClear ? (
            <button type="button" className="icon-btn fd-icon-btn" aria-label="Quitar archivo" disabled={disabled} onClick={onClear}>
              <Icon name="close" />
            </button>
          ) : null}
        </>
      ) : (
        <>
          <Icon name="clip" />
          <span className="fd-chip-main fd-placeholder">{picker.dragging ? 'Suelta el archivo' : placeholder}</span>
          <Button size="small" disabled={disabled} onClick={picker.open}>
            Adjuntar
          </Button>
        </>
      )}
      {picker.input({ id })}
    </div>
  );
}

// ─── Galería de imágenes ───────────────────────────────────────────────

export type GalleryItem = { id: string; name: string; url: string };

export function FileGallery({
  items,
  formats,
  max = 6,
  maxSizeMb,
  capture = true,
  disabled,
  onFiles,
  onReject,
  onRemove,
}: {
  items: GalleryItem[];
  formats: FileFormat[];
  max?: number;
  maxSizeMb?: number;
  /** En móvil abre la cámara trasera. */
  capture?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (message: string, file: File) => void;
  onRemove?: (id: string) => void;
}) {
  const remaining = max - items.length;
  const picker = useFilePicker({
    formats,
    maxSizeMb,
    multiple: true,
    remaining,
    disabled: disabled || remaining <= 0,
    onFiles,
    onReject,
  });
  return (
    <div className="fd-gallery-wrap">
      {picker.input({ capture: capture ? 'environment' : undefined })}
      <div className="fd-gallery" {...picker.dragProps}>
        {items.map((item) => (
          <figure key={item.id} className="fd-tile">
            <img src={item.url} alt={item.name} />
            <figcaption>{item.name}</figcaption>
            {onRemove ? (
              <button type="button" className="fd-tile-remove" aria-label={`Quitar ${item.name}`} onClick={() => onRemove(item.id)}>
                <Icon name="close" />
              </button>
            ) : null}
          </figure>
        ))}
        {remaining > 0 ? (
          <button
            type="button"
            className={cx('fd-tile-add', picker.dragging && 'dragging')}
            disabled={disabled}
            onClick={picker.open}
          >
            <Icon name="image" />
            <span>{picker.dragging ? 'Suelta aquí' : 'Agregar foto'}</span>
          </button>
        ) : null}
      </div>
      <span className="fd-gallery-count">
        {items.length} / {max} fotos
      </span>
    </div>
  );
}

// ─── Botón de adjuntar (filas) ─────────────────────────────────────────

export function FileAttachButton({
  label,
  count = 0,
  formats,
  maxSizeMb,
  disabled,
  onFiles,
  onReject,
}: {
  /** Texto accesible, p. ej. "Adjuntar a REC-0187". */
  label: string;
  count?: number;
  formats: FileFormat[];
  maxSizeMb?: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (message: string, file: File) => void;
}) {
  const picker = useFilePicker({ formats, maxSizeMb, multiple: true, disabled, onFiles, onReject });
  return (
    <>
    {picker.input()}
    <button
      type="button"
      className={cx('icon-btn fd-attach', picker.dragging && 'dragging')}
      aria-label={`${label} (${count} adjuntos)`}
      title={label}
      disabled={disabled}
      onClick={picker.open}
      {...picker.dragProps}
    >
      <Icon name="clip" />
      {count ? <span className="fd-attach-count">{count}</span> : null}
    </button>
    </>
  );
}
