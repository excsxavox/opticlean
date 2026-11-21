import { useEffect, useState } from 'react';

export function DeliveryCodePage() {
  const params = new URLSearchParams(window.location.search);
  const [orderId, setOrderId] = useState(params.get('orderId') ?? '');
  const [key, setKey] = useState(params.get('k') ?? '');
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState('Abre el enlace que te envió la empresa.');

  useEffect(() => {
    if (!orderId || !key) return;
    const query = new URLSearchParams({ orderId, k: key });
    void fetch(`/api/public/delivery-code?${query}`)
      .then(async (res) => {
        const data = (await res.json()) as { code?: string | null; error?: string; status?: string };
        if (!res.ok) {
          setCode(null);
          setMessage(data.error ?? 'No se pudo leer el código.');
          return;
        }
        if (!data.code) {
          setCode(null);
          setMessage(data.status === 'Entregado' ? 'Este pedido ya fue entregado.' : 'El código todavía no está disponible.');
          return;
        }
        setCode(data.code);
        setMessage('Dicta este código a quien trae el pedido.');
      })
      .catch(() => setMessage('No hay conexión con la operación.'));
  }, [orderId, key]);

  return (
    <div className="page" style={{ maxWidth: 420, margin: '48px auto' }}>
      <h1>Código de entrega</h1>
      <p>{message}</p>
      {code ? <p style={{ fontSize: 40, letterSpacing: 6 }}>{code}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setOrderId(String(data.get('orderId') ?? ''));
          setKey(String(data.get('key') ?? ''));
        }}
      >
        <div className="field">
          <label htmlFor="delivery-order">Pedido</label>
          <input id="delivery-order" name="orderId" defaultValue={orderId} />
        </div>
        <div className="field">
          <label htmlFor="delivery-key">Llave del enlace</label>
          <input id="delivery-key" name="key" defaultValue={key} />
        </div>
        <button className="btn primary" type="submit">Ver código</button>
      </form>
    </div>
  );
}
