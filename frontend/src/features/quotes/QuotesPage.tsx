import { useMemo, useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { money } from '../../shared/lib/inventory';
import { Btn, Empty, PageHead } from '../../shared/components/ui';
import { Modal, ModalActions } from '../../shared/components/Modal';
import { Select } from '../../shared/components/Select';
import type { CustomerQuote, SalesChannel } from '../../shared/types';
import '../../styles/clients.css';

const channels: Array<{ id: SalesChannel; label: string }> = [
  { id: 'ejecutivo', label: 'Ejecutivo' },
  { id: 'portal', label: 'Portal' },
  { id: 'reposicion', label: 'Reposición' },
];

function viewOf(quote: CustomerQuote) {
  return quote.status === 'Abierta' && quote.validUntil < new Date().toISOString().slice(0, 10) ? 'Vencida' : quote.status;
}

function totalOf(quote: CustomerQuote) {
  return quote.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
}

export function QuotesPage() {
  const { state, applyResponse, toast } = useAppState();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([{ productId: '', qty: 1, unitPrice: 0 }]);

  const quotes = useMemo(() => state?.quotes ?? [], [state?.quotes]);
  if (!state) return null;

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      applyResponse(
        await api.addQuote({
          clientId: data.clientId,
          validUntil: data.validUntil,
          channel: data.channel,
          note: data.note,
          lines: lines.filter((line) => line.productId),
        }),
      );
      toast('Cotización registrada.');
      setOpen(false);
      setLines([{ productId: '', qty: 1, unitPrice: 0 }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, win: boolean) => {
    setError('');
    try {
      applyResponse(win ? await api.winQuote(id) : await api.loseQuote(id));
      toast(win ? 'Cotización ganada. El pedido ya está por preparar.' : 'Cotización marcada como perdida.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar.');
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Comercial"
        title="Cotizaciones"
        desc="Precio y vigencia antes de convertir la oferta en pedido."
        actions={<Btn icon="plus" onClick={() => setOpen(true)}>Nueva cotización</Btn>}
      />
      {error ? <div className="form-error visible">{error}</div> : null}
      {quotes.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Canal</th>
                <th>Vigencia</th>
                <th>Total</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => {
                const status = viewOf(quote);
                const client = state.clients.find((item) => item.id === quote.clientId);
                return (
                  <tr key={quote.id}>
                    <td>{quote.number}</td>
                    <td>{client?.name ?? quote.clientId}</td>
                    <td>{channels.find((item) => item.id === quote.channel)?.label}</td>
                    <td>{quote.validUntil}</td>
                    <td>{money(totalOf(quote))}</td>
                    <td>{status}</td>
                    <td>
                      {status === 'Abierta' ? (
                        <>
                          <Btn size="small" onClick={() => void act(quote.id, true)}>Ganar</Btn>
                          <Btn size="small" onClick={() => void act(quote.id, false)}>Perder</Btn>
                        </>
                      ) : (
                        quote.orderId ?? ''
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin cotizaciones" desc="La primera queda vigente hasta la fecha que indiques." />
      )}
      {open ? (
        <Modal
          title="Nueva cotización"
          subtitle="Si se gana, nace un pedido con el mismo canal."
          onClose={() => setOpen(false)}
          footer={<ModalActions onCancel={() => setOpen(false)} submitLabel="Guardar" formId="quote-form" />}
        >
          <form id="quote-form" onSubmit={save}>
            <div className="field">
              <label htmlFor="quote-client">Cliente</label>
              <Select id="quote-client" name="clientId" required defaultValue="">
                <option value="" disabled>Selecciona…</option>
                {state.clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label htmlFor="quote-until">Vigente hasta</label>
              <input id="quote-until" name="validUntil" type="date" required />
            </div>
            <div className="field">
              <label htmlFor="quote-channel">Canal</label>
              <Select id="quote-channel" name="channel" defaultValue="ejecutivo">
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.label}</option>
                ))}
              </Select>
            </div>
            {lines.map((line, index) => (
              <div className="form-grid" key={index}>
                <div className="field">
                  <label>Producto</label>
                  <Select
                    value={line.productId}
                    onChange={(event) => {
                      const productId = event.target.value;
                      const price = state.products.find((item) => item.id === productId)?.price ?? 0;
                      setLines(lines.map((item, i) => (i === index ? { ...item, productId, unitPrice: price } : item)));
                    }}
                  >
                    <option value="">Selecciona…</option>
                    {state.products.filter((item) => item.kind !== 'raw').map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="field">
                  <label>Cantidad</label>
                  <input
                    type="number"
                    min={1}
                    value={line.qty}
                    onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, qty: Number(event.target.value) } : item)))}
                  />
                </div>
              </div>
            ))}
            <Btn type="button" size="small" onClick={() => setLines([...lines, { productId: '', qty: 1, unitPrice: 0 }])}>
              Otra línea
            </Btn>
            <div className="field">
              <label htmlFor="quote-note">Nota</label>
              <input id="quote-note" name="note" />
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
