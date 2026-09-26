import { FormEvent, useEffect, useRef, useState } from 'react';
import Modal from './Modal';

// The camera (getUserMedia) only exists in a secure context — https or
// localhost. Over plain http on the LAN it's undefined, so instead of a dead
// button this says why and offers typing the number, which also suits
// USB/Bluetooth scanners (they "type" the code and press Enter).
const cameraPossible = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

export default function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [starting, setStarting] = useState(cameraPossible);
  const done = useRef(false);
  // Held in a ref so a parent re-render doesn't restart the camera.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!cameraPossible) return;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let frame = 0;
    let cancelled = false;

    const found = (code: string) => {
      if (done.current) return;
      done.current = true;
      navigator.vibrate?.(60);
      onDetectedRef.current(code);
    };

    (async () => {
      try {
        const Native = (window as any).BarcodeDetector;
        const nativeOk = Native && (await Native.getSupportedFormats?.())?.includes('ean_13');
        if (nativeOk) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (cancelled || !video.current) return;
          video.current.srcObject = stream;
          await video.current.play();
          setStarting(false);
          const detector = new Native({ formats: FORMATS });
          const tick = async () => {
            if (cancelled || done.current || !video.current) return;
            try {
              const codes = await detector.detect(video.current);
              if (codes[0]?.rawValue) return found(codes[0].rawValue);
            } catch {
              /* a bad frame — try the next one */
            }
            frame = requestAnimationFrame(tick);
          };
          tick();
        } else {
          // iPhones and Firefox: no BarcodeDetector, so decode in JS (loaded only when needed).
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (cancelled || !video.current) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (result) => {
            if (result) found(result.getText());
          });
          stopZxing = () => controls.stop();
          setStarting(false);
        }
      } catch (e: any) {
        setStarting(false);
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera permission was refused. Allow it in the browser settings, or type the number below.'
            : `Couldn't start the camera: ${e?.message ?? e}`
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = typed.replace(/\s+/g, '');
    if (code) onDetected(code);
  }

  return (
    <Modal title="Scan a barcode" onClose={onClose}>
      {cameraPossible ? (
        <div className="scanner">
          <video ref={video} playsInline muted />
          <div className="scanner-frame" aria-hidden="true" />
          {starting && <p className="scanner-note">Starting camera…</p>}
        </div>
      ) : (
        <p className="notice warn">
          The camera only works over a secure (https) connection — open KitchenAid from the Home Assistant app or your https Home
          Assistant address to scan. You can still type the number, or use a USB/Bluetooth barcode scanner.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <form className="inline-form" onSubmit={submit}>
        <input
          inputMode="numeric"
          autoFocus={!cameraPossible}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="…or type the barcode number"
          aria-label="Barcode number"
        />
        <button type="submit" className="button secondary">
          Look up
        </button>
      </form>
    </Modal>
  );
}
