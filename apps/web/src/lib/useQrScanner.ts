import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Camera QR scanning. Decoding uses the browser's native BarcodeDetector when it supports QR (Chrome on
 * Android/macOS, Safari 17+ on iOS); elsewhere (Chrome on Windows, Firefox) jsQR is loaded on demand.
 * getUserMedia only exists in a secure context: HTTPS or localhost.
 */

export type CamState = "idle" | "starting" | "live" | "denied" | "nocam" | "busy" | "insecure" | "unsupported" | "error";

type Detect = (v: HTMLVideoElement) => Promise<string | null>;

interface NativeDetector {
  detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type NativeDetectorCtor = {
  new (o: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

let decoder: Promise<Detect> | null = null;

function loadDecoder(): Promise<Detect> {
  return (decoder ??= (async () => {
    const BD = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (BD && (await BD.getSupportedFormats().catch((): string[] => [])).includes("qr_code")) {
      const det = new BD({ formats: ["qr_code"] });
      return async (v) => (await det.detect(v))[0]?.rawValue ?? null;
    }
    const { default: jsQR } = await import("jsqr");
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    return async (v) => {
      /* Decode the centre square (what the 1:1 viewfinder shows), scaled down to keep each pass cheap. */
      const side = Math.min(v.videoWidth, v.videoHeight);
      if (!side) return null;
      const out = Math.min(side, 640);
      cv.width = cv.height = out;
      ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out);
      const img = ctx.getImageData(0, 0, out, out);
      return jsQR(img.data, out, out, { inversionAttempts: "dontInvert" })?.data ?? null;
    };
  })());
}

function failState(e: unknown): CamState {
  const n = (e as { name?: string })?.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "denied";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "nocam";
  if (n === "NotReadableError" || n === "AbortError") return "busy";
  return "error";
}

/**
 * Runs the camera into `videoRef` and calls `onCode` with each decoded QR payload while `active`.
 * The camera starts on `start()`, or by itself when the site already has camera permission.
 */
export function useQrScanner(active: boolean, onCode: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [state, setState] = useState<CamState>("idle");
  const [mirror, setMirror] = useState(false);
  /* The last payload and when it was last seen: a code still held in view after a reset is not read again. */
  const last = useRef({ text: "", at: 0 });

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!window.isSecureContext) return setState("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return setState("unsupported");
    setState("starting");
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      stream.current = s;
      setMirror(s.getVideoTracks()[0]?.getSettings().facingMode === "user");
      const v = videoRef.current;
      if (!v) return stop();
      v.srcObject = s;
      await v.play();
      setState("live");
      /* A camera unplugged or taken over mid-session ends the track. */
      s.getVideoTracks()[0]?.addEventListener("ended", () => setState("busy"));
    } catch (e) {
      stop();
      setState(failState(e));
    }
  }, [stop]);

  /* Start without a tap when permission was granted before; otherwise wait for the user. */
  useEffect(() => {
    let gone = false;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        if (!gone && p.state === "granted" && window.isSecureContext) start();
      })
      .catch(() => {});
    return () => {
      gone = true;
      stop();
    };
  }, [start, stop]);

  useEffect(() => {
    if (!active || state !== "live") return;
    let alive = true;
    let timer = 0;
    /* Restart the hold-off window, so the code that was just handled is not read again on resume. */
    last.current.at = Date.now();
    const tick = async () => {
      const v = videoRef.current;
      if (!alive || !v) return;
      if (v.readyState >= 2) {
        const text = await (await loadDecoder())(v).catch(() => null);
        if (!alive) return;
        if (text) {
          const now = Date.now();
          const again = text === last.current.text && now - last.current.at < 3000;
          last.current = { text, at: now };
          if (!again) return cb.current(text);
        }
      }
      timer = window.setTimeout(tick, 120);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, state]);

  return { videoRef, state, start, mirror };
}
