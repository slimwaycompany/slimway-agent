import { useState, useRef, useEffect } from 'react';
import jsQR from 'jsqr';
import { extractIBData } from './qrFromImage';

export function useQrCamera(onQr: (ibData: string) => void) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopCamera() {
    if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  function scheduleScan() {
    if (!streamRef.current) return;
    scanTimerRef.current = setTimeout(scanFrame, 200);
  }

  function scanFrame() {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    if (video.readyState < 2 || video.videoWidth === 0) { scheduleScan(); return; }
    const ctx = canvas.getContext('2d')!;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) {
      const hit = extractIBData(code.data);
      if (hit) { stopCamera(); onQr(hit); return; }
    }
    scheduleScan();
  }

  async function startCamera() {
    setCameraErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      setCameraActive(true);
      video.addEventListener('loadedmetadata', () => scheduleScan(), { once: true });
      await video.play().catch(() => {});
    } catch (e: unknown) {
      const name = (e as Error)?.name;
      if (name === 'NotAllowedError') setCameraErr('Разрешите доступ к камере в настройках браузера');
      else if (name === 'NotFoundError') setCameraErr('Камера не найдена');
      else setCameraErr('Камера недоступна, сфотографируйте лист кнопкой ниже');
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopCamera(); }, []);

  return { cameraActive, cameraErr, videoRef, canvasRef, startCamera, stopCamera };
}
