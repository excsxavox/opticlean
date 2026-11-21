import { useMemo, useState } from 'react';
import { api } from '../../shared/api/client';
import { Btn } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal } from '../../shared/components/Modal';
import { TooltipButton } from '../../shared/components/Tooltip';
import { money, num } from '../../shared/lib/inventory';
import { FileDropZone, type FileDropStatus } from '../../shared/components/FileDrop';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import {
  IMPORT_FORMATS,
  IMPORT_REJECTED,
  extOf,
  fileToBase64,
  findFormat,
  type FileMeta,
  type FileRoute,
} from '../../shared/lib/fileFormats';
import { indexImportWarnings } from './importWarnings';
import '../../styles/imports.css';

type ImportKind = 'purchase' | 'sale';

type Row = {
  code: string;
  name: string;
  qty: number;
  packCode: string;
  unitPrice: number;
  batch: string;
  expiry: string;
  productId: string | null;
  status: 'matched' | 'new' | 'invalid';
  message: string;
};

type Preview = {
  partyName: string;
  partyTaxId: string;
  partyAddress: string;
  docNumber: string;
  issueDate: string;
  warnings: string[];
  rows: Row[];
};

const MAX_SIZE_MB = 10;
const AI_STEPS = ['Preparando archivo', 'Leyendo con IA'];
const PREVIEW_STEPS = ['Leyendo archivo', 'Preparando líneas'];

type RowTone = 'ok' | 'info' | 'warn' | 'err';
type RowFilter = 'all' | 'err' | 'info';
type RowView = { tone: RowTone; label: string; title: string; detail: string; action?: string; extra: string[] };

export function ImportDialog({
  kind,
  onClose,
  onDone,
}: {
  kind: ImportKind;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { applyResponse } = useAppState();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [file, setFile] = useState<FileMeta | null>(null);
  const [route, setRoute] = useState<FileRoute | null>(null);
  const [status, setStatus] = useState<FileDropStatus>('idle');
  const [step, setStep] = useState(0);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const party = kind === 'purchase' ? 'Proveedor' : 'Cliente';
  const [filter, setFilter] = useState<RowFilter>('all');
  const issues = useMemo(
    () => (preview ? indexImportWarnings(preview.warnings, preview.rows.map((row) => row.code)) : null),
    [preview],
  );

  const viewOf = (row: Row): RowView => {
    const found = issues?.byCode.get(row.code);
    const extra = found?.messages ?? [];
    if (row.status === 'invalid') {
      return {
        tone: 'err',
        label: 'Inválida',
        title: 'Esta línea no se importará',
        detail: row.message || 'Le faltan datos obligatorios.',
        action: 'Corrige el archivo y vuelve a cargarlo si necesitas esta línea.',
        extra,
      };
    }
    if (found?.noStock) {
      return {
        tone: 'err',
        label: 'Sin stock',
        title: 'No hay stock suficiente',
        detail: `Pide ${num(row.qty)} ${row.packCode || 'u.'} y no hay suficiente disponible. El pedido no se creará hasta que entre mercadería.`,
        action: 'Registra la recepción primero o quita esta línea del archivo.',
        extra,
      };
    }
    if (row.status === 'new') {
      return {
        tone: 'info',
        label: 'Nuevo',
        title: 'Producto nuevo',
        detail: 'No está en el catálogo. Se creará con los datos del archivo al confirmar.',
        extra,
      };
    }
    if (extra.length) {
      return { tone: 'warn', label: 'Revisar', title: 'Revisa esta línea', detail: extra[0], extra: extra.slice(1) };
    }
    return { tone: 'ok', label: 'Existe', title: '', detail: '', extra };
  };

  const views = preview?.rows.map(viewOf) ?? [];
  const blocked = kind === 'sale' ? views.filter((view) => view.label === 'Sin stock').length : 0;
  const errCount = views.filter((view) => view.tone === 'err').length;
  const infoCount = views.filter((view) => view.tone === 'info').length;
  const importable = preview?.rows.filter((row) => row.status !== 'invalid' && row.qty > 0) ?? [];
  const units = importable.reduce((sum, row) => sum + row.qty, 0);
  const total = importable.reduce((sum, row) => sum + row.qty * (row.unitPrice || 0), 0);
  const createLabel = kind === 'sale' ? 'Crear pedido' : 'Crear compra';

  const reset = () => {
    setFilter('all');
    setFile(null);
    setRoute(null);
    setPreview(null);
    setStatus('idle');
    setFileError('');
    setError('');
  };

  const fail = (message: string) => {
    setStatus('error');
    setFileError(message);
  };

  const readFile = async (picked: File) => {
    const format = findFormat(IMPORT_FORMATS, picked.name);
    const nextRoute = format?.route ?? 'preview';
    setFile({ name: picked.name, size: picked.size });
    setRoute(nextRoute);
    setPreview(null);
    setFilter('all');
    setError('');
    setFileError('');
    setStatus('reading');
    setStep(0);
    setBusy(true);

    if (nextRoute === 'ai') {
      try {
        const contentBase64 = await fileToBase64(picked);
        setStep(1);
        const res = await api.importOrderFile({ fileName: picked.name, mimeType: picked.type, contentBase64 });
        applyResponse(res);
        const created = res.import.productsCreated.length;
        const updated = res.import.productsUpdated.length;
        const clientMsg = res.import.clientCreated ? 'cliente creado' : 'cliente relacionado';
        const prodMsg = [
          created ? `${created} producto(s) creado(s)` : '',
          updated ? `${updated} relacionado(s)` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        onDone(
          `${res.import.orderId} · IA · ${clientMsg}${prodMsg ? ` · ${prodMsg}` : ''} · ${res.import.invoice.docNumber}`,
        );
      } catch (err) {
        fail(err instanceof Error ? err.message : 'No se pudo leer el documento con IA.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const ext = extOf(picked.name);
    const fmt = ext === 'xml' ? 'xml' : ext === 'csv' || ext === 'txt' ? 'csv' : 'xlsx';
    try {
      const body =
        fmt === 'xlsx'
          ? { kind, format: fmt, base64: await fileToBase64(picked) }
          : { kind, format: fmt, text: await picked.text() };
      setStep(1);
      const next = await api.previewImport(body);
      setPreview(next);
      setStatus('ready');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview || busy || blocked) return;
    const rows = preview.rows.filter((row) => row.status !== 'invalid' && row.qty > 0);
    if (!rows.length) {
      setError('No hay líneas válidas para confirmar.');
      return;
    }
    if (rows.some((row) => row.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry))) {
      setError('La caducidad debe ir en formato AAAA-MM-DD. Si el archivo no la trae, déjala vacía.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.commitImport({
        kind,
        partyName: preview.partyName,
        partyTaxId: preview.partyTaxId,
        partyAddress: preview.partyAddress,
        docNumber: preview.docNumber,
        issueDate: preview.issueDate,
        rows,
      });
      applyResponse(res);
      onDone(
        kind === 'purchase'
          ? `Compra ${res.import.purchaseId} importada. La caducidad se confirma al recibir.`
          : `Pedido ${res.import.orderId} importado.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar la importación.');
    } finally {
      setBusy(false);
    }
  };

  const lines = preview?.rows.length ?? 0;
  const summary = preview
    ? `${lines} ${lines === 1 ? 'línea' : 'líneas'}${preview.partyName ? ` · ${preview.partyName}` : ''}`
    : undefined;

  return (
    <Modal
      title={kind === 'purchase' ? 'Importar compra' : 'Importar pedido'}
      subtitle="PDF y Word se leen con IA. XML, CSV y Excel pasan por una vista previa antes de confirmar."
      onClose={onClose}
      footer={
        <>
          {blocked ? (
            <span className="import-blocked" role="status">
              <Icon name="alert" />
              {blocked === 1 ? '1 línea sin stock' : `${blocked} líneas sin stock`}: no se puede crear el pedido.
            </span>
          ) : null}
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="save" disabled={!preview || busy || blocked > 0} onClick={() => void commit()}>
            {busy && preview ? 'Creando…' : createLabel}
          </Btn>
        </>
      }
    >
      <FileDropZone
        id="import-file"
        formats={IMPORT_FORMATS}
        rejected={IMPORT_REJECTED}
        maxSizeMb={MAX_SIZE_MB}
        status={status}
        file={file}
        route={route}
        steps={route === 'ai' ? AI_STEPS : PREVIEW_STEPS}
        step={step}
        summary={summary}
        error={fileError}
        onFiles={([picked]) => void readFile(picked)}
        onReject={(message, rejectedFile) => {
          setFile({ name: rejectedFile.name, size: rejectedFile.size });
          setRoute(null);
          setPreview(null);
          fail(message);
        }}
        onClear={reset}
      />

      {preview ? (
        <div className="form-grid import-party">
          <div className="field">
            <label htmlFor="import-party">{party}</label>
            <input
              id="import-party"
              value={preview.partyName}
              onChange={(event) => setPreview({ ...preview, partyName: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="import-doc">Documento</label>
            <input
              id="import-doc"
              value={preview.docNumber}
              onChange={(event) => setPreview({ ...preview, docNumber: event.target.value })}
            />
          </div>
        </div>
      ) : null}

      {issues?.general.length ? (
        <div className="import-general" role="status">
          <Icon name="info" />
          <ul>
            {issues.general.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="import-summary">
            <span>
              <b>{num(importable.length)}</b> {importable.length === 1 ? 'línea' : 'líneas'}
            </span>
            <span>
              <b>{num(units)}</b> u.
            </span>
            {total > 0 ? (
              <span>
                Total <b>{money(total)}</b>
              </span>
            ) : null}
            {errCount || infoCount ? (
              <div className="import-filters" role="group" aria-label="Filtrar líneas">
                <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  Todas {preview.rows.length}
                </button>
                {errCount ? (
                  <button type="button" className="err" aria-pressed={filter === 'err'} onClick={() => setFilter('err')}>
                    <i aria-hidden="true" />
                    Con error {errCount}
                  </button>
                ) : null}
                {infoCount ? (
                  <button type="button" className="info" aria-pressed={filter === 'info'} onClick={() => setFilter('info')}>
                    <i aria-hidden="true" />
                    Nuevos {infoCount}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="table-scroll import-table">
            <table>
              <colgroup>
                <col className="c-product" />
                <col className="c-qty" />
                <col className="c-pack" />
                <col className="c-date" />
                <col className="c-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Empaque</th>
                  <th>
                    Caducidad <small>opcional</small>
                  </th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => {
                  const view = views[index];
                  const hidden =
                    filter !== 'all' && !(filter === 'err' ? view.tone === 'err' : view.tone === 'info');
                  return (
                    <tr key={`${row.code}-${index}`} className={`import-row ${view.tone}`} hidden={hidden}>
                      <td className="import-product">
                        <strong title={row.name}>{row.name}</strong>
                        <span className="sub">{row.code}</span>
                      </td>
                      <td className="import-qty">{num(row.qty)}</td>
                      <td className="import-pack">{row.packCode}</td>
                      <td className="import-date">
                        <input
                          aria-label={`Caducidad de ${row.code} (opcional)`}
                          type="date"
                          value={row.expiry}
                          onChange={(event) => {
                            const rows = preview.rows.map((item, i) =>
                              i === index ? { ...item, expiry: event.target.value } : item,
                            );
                            setPreview({ ...preview, rows });
                          }}
                        />
                      </td>
                      <td className="import-state">
                        {view.tone === 'ok' ? (
                          <span className="import-status ok">{view.label}</span>
                        ) : (
                          <TooltipButton
                            className={`import-status ${view.tone}`}
                            label={`${view.label}: ${view.title}. Ver detalle`}
                            content={
                              <>
                                <b>{view.title}</b>
                                {view.detail}
                                {view.extra.length ? (
                                  <ul>
                                    {view.extra.map((message) => (
                                      <li key={message}>{message}</li>
                                    ))}
                                  </ul>
                                ) : null}
                                {view.action ? <span className="ui-tooltip-note">{view.action}</span> : null}
                              </>
                            }
                          >
                            <Icon name={view.tone === 'info' ? 'info' : 'alert'} />
                            {view.label}
                          </TooltipButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {error ? <div className="form-error visible">{error}</div> : null}
    </Modal>
  );
}
