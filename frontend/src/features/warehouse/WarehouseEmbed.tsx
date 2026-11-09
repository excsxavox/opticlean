import { useEffect, useRef } from 'react';
import '../../styles/warehouse-embed.css';

const EMBED_SRC = '/control-embed/index.html?embed=1#bodega';

type Props = {
  /** Altura del iframe. Por defecto ocupa el viewport disponible. */
  height?: string | number;
  title?: string;
};

/**
 * Embebe la bodega visual EXACTA de opticlean-control (misma UI, CSS y SVG).
 * Es una aplicación distinta; aquí solo se monta su pantalla de bodega
 * sin su sidebar, dentro del shell de opticlean.
 */
export function WarehouseEmbed({ height = 'calc(100vh - 72px)', title = 'Bodega visual OPTICLEAN' }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      // Reserva para sincronizar selección / navegación con React más adelante
      if (event.data?.source === 'opticlean-control-embed') {
        // no-op por ahora
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="warehouse-embed">
      <iframe
        ref={frameRef}
        className="warehouse-embed__frame"
        title={title}
        src={EMBED_SRC}
        style={{ height }}
        allow="clipboard-write"
      />
    </div>
  );
}
