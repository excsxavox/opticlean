import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

type Props = {
  onDetect: (code: string) => void;
  onClose: () => void;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

export function QrScanner({ onDetect, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let detector: BarcodeDetectorLike | null = null;

    const run = async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike })
          .BarcodeDetector;
        if (Detector) {
          detector = new Detector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped.current || !videoRef.current) return;
          if (detector && videoRef.current.readyState >= 2) {
            try {
              const codes = await detector.detect(videoRef.current);
              const value = codes[0]?.rawValue?.trim();
              if (value) {
                onDetect(value);
                return;
              }
            } catch {
              /* keep scanning */
            }
          }
          timer = window.setTimeout(() => void tick(), 350);
        };
        void tick();
        if (!detector) {
          setError('Este dispositivo no lee QR por cámara. Escribe el código o usa ingreso manual.');
        }
      } catch {
        setError('No se pudo abrir la cámara. Usa el código manual.');
      }
    };

    void run();
    return () => {
      stopped.current = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="scan-sheet">
      <header>
        <strong>Escanear producto</strong>
        <button type="button" className="icon-btn light" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" />
        </button>
      </header>
      <div className="scan-frame">
        <video ref={videoRef} muted playsInline />
        <div className="scan-reticle" />
      </div>
      {error ? <p className="scan-error">{error}</p> : <p className="scan-help">Apunta al QR o código de barras del producto</p>}
      <form
        className="scan-manual"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onDetect(manual.trim());
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Código / SKU"
          autoCapitalize="characters"
          enterKeyHint="done"
        />
        <button type="submit" className="btn primary">
          Usar código
        </button>
      </form>
    </div>
  );
}
