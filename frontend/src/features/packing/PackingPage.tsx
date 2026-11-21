import { useMemo, useState } from 'react';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { money } from '../../shared/lib/inventory';
import { Btn, Empty, PageHead } from '../../shared/components/ui';
import { Select } from '../../shared/components/Select';

type Preview = Awaited<ReturnType<typeof api.previewLoad>>;

export function PackingPage() {
  const { state, applyResponse, toast } = useAppState();
  const [picked, setPicked] = useState<string[]>([]);
  const [plate, setPlate] = useState('');
  const [weight, setWeight] = useState('');
  const [volume, setVolume] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = useMemo(
    () => (state?.orders ?? []).filter((order) => order.status === 'Preparado'),
    [state?.orders],
  );
  if (!state) return null;
  const vehicles = (state.vehicles ?? []).filter((vehicle) => vehicle.active);

  const toggle = (id: string) => {
    setPreview(null);
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const pack = async (orderId: string) => {
    setBusy(true);
    setError('');
    try {
      applyResponse(await api.packOrder({ orderId, weightKg: Number(weight), volumeM3: Number(volume) }));
      toast('Bulto registrado.');
      setWeight('');
      setVolume('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empacar.');
    } finally {
      setBusy(false);
    }
  };

  const calculate = async () => {
    if (!plate || !picked.length) return;
    setBusy(true);
    setError('');
    try {
      setPreview(await api.previewLoad(plate, picked));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo calcular la carga.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Logística"
        title="Empaque y carga"
        desc="Pesa el bulto, mira si el camión llega al 80 % y en qué orden se carga: lo último en subir es la primera parada."
      />
      {error ? <div className="form-error visible">{error}</div> : null}
      {ready.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Bultos</th>
                <th>Peso kg</th>
                <th>m³</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ready.map((order) => {
                const parcels = (state.parcels ?? []).filter((parcel) => parcel.orderId === order.id);
                const client = state.clients.find((item) => item.id === order.clientId);
                return (
                  <tr key={order.id}>
                    <td>
                      <input type="checkbox" checked={picked.includes(order.id)} onChange={() => toggle(order.id)} aria-label={`Cargar ${order.id}`} />
                    </td>
                    <td>{order.id}</td>
                    <td>{client?.name}</td>
                    <td>{parcels.length || 'Sin pesar'}</td>
                    <td>
                      <input aria-label={`Peso de ${order.id}`} value={picked.includes(order.id) ? weight : ''} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" />
                    </td>
                    <td>
                      <input aria-label={`Volumen de ${order.id}`} value={picked.includes(order.id) ? volume : ''} onChange={(event) => setVolume(event.target.value)} inputMode="decimal" />
                    </td>
                    <td>
                      <Btn size="small" disabled={busy} onClick={() => void pack(order.id)}>Empacar</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Nada preparado" desc="El empaque empieza cuando el pedido ya tiene lote de salida." />
      )}
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Camión</h2>
        <div className="field">
          <label htmlFor="pack-plate">Placa</label>
          <Select id="pack-plate" value={plate} onChange={(event) => { setPlate(event.target.value); setPreview(null); }}>
            <option value="">Selecciona…</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.plate}>
                {vehicle.plate} · {vehicle.label}
                {vehicle.fuel ? ` · ${vehicle.fuel}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Btn disabled={busy || !plate || !picked.length} onClick={() => void calculate()}>Calcular llenado</Btn>
        {preview ? (
          <div>
            <p>
              {preview.kg} kg · {preview.m3} m³ · llenado {Math.round(preview.fill * 100)} %.
              {preview.underMin ? ' Está por debajo del 80 %.' : ' Llega al llenado mínimo.'}
              {preview.over ? ' Supera la capacidad del vehículo.' : ''}
            </p>
            <p>
              Viaje de {preview.trip.km} km: {money(preview.trip.allIn)} todo incluido
              {preview.trip.fuel ? `, combustible ${money(preview.trip.fuel)} (${preview.trip.fuelUnits} ${preview.trip.fuelType === 'electrico' ? 'kWh' : 'gal'})` : ''}.
            </p>
            <p>Orden de carga, de la bodega hacia la puerta: {preview.loadSequence.join(' → ') || '—'}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
