import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { t } from '../i18n/uk';
import { isValidBarcode } from '../lib/barcode';
import { webApp } from '../lib/telegram';

export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handled = useRef(false);
  const cb = useRef(onCode);
  cb.current = onCode;

  const [status, setStatus] = useState<'starting' | 'live' | 'error'>('starting');
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;

    const video = videoRef.current;
    if (!navigator.mediaDevices?.getUserMedia || !video) {
      setStatus('error');
      setError(t.scan.noCamera);
      return;
    }

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });

    reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result, _err, controls) => {
          if (!result || handled.current) return;
          const code = result.getText();
          // Відсікаємо хибні розпізнавання: контрольна цифра має збігатися
          if (!isValidBarcode(code)) return;
          handled.current = true;
          controls.stop();
          navigator.vibrate?.(60);
          webApp()?.HapticFeedback?.notificationOccurred('success');
          cb.current(code);
        },
      )
      .then((controls) => {
        if (cancelled) controls.stop();
        else {
          stop = () => controls.stop();
          setStatus('live');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : '';
        setStatus('error');
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? t.scan.denied : t.scan.cameraError);
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  function submitManual() {
    const code = manual.replace(/\s+/g, '');
    if (!isValidBarcode(code)) {
      setManualError(true);
      return;
    }
    handled.current = true;
    cb.current(code);
  }

  return (
    <>
      <div className="scanner">
        <video ref={videoRef} playsInline muted autoPlay />
        {status !== 'error' && <div className="scan-frame" />}
        {status === 'starting' && <div className="scan-msg">{t.scan.starting}</div>}
        {status === 'error' && <div className="scan-msg">{error}</div>}
      </div>
      {status === 'live' && <p className="muted small center-text">{t.scan.hint}</p>}

      <label className="field">
        <span>{t.scan.manualLabel}</span>
        <div className="inline">
          <input
            inputMode="numeric"
            value={manual}
            placeholder="5901234123457"
            onChange={(e) => {
              setManual(e.target.value.replace(/[^\d\s]/g, ''));
              setManualError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitManual();
            }}
          />
          <button type="button" className="secondary" onClick={submitManual}>
            {t.scan.manualGo}
          </button>
        </div>
      </label>
      {manualError && <p className="error">{t.scan.badCode}</p>}
    </>
  );
}
