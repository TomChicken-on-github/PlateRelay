import { Maximize, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { client, idem, unwrap } from "@/lib/api";
import { CameraView } from "./camera-view";

type Session = Awaited<ReturnType<typeof openSession>>;
const openSession = (printerId: string) => unwrap(client.POST("/printers/{printerId}/camera/session", { params: { path: { printerId }, ...idem() }, body: {} }));

/**
 * Live camera in a 960px dialog (desktop only). When there is no stream to be had (no stream on this
 * camera, the stream dropped, too many viewers, the server refused), it shows the latest still with its time.
 */
export function LiveDialog({ printerId, name, modelName, snapshotAt, open, onOpenChange }: { printerId: string; name: string; modelName?: string | null; snapshotAt: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    if (!open) return;
    let gone = false;
    setFailed(false);
    setSession(null);
    openSession(printerId).then(
      (s) => !gone && setSession(s),
      () => !gone && setFailed(true),
    );
    return () => void (gone = true);
  }, [open, printerId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(960px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[20px] bg-card p-5 text-card-foreground shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center gap-2 pl-1">
            <Dialog.Title className="m-0 font-mono text-lg leading-[26px] font-bold">{name}</Dialog.Title>
            <span className="flex-1 text-sm text-muted-foreground">实况</span>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭">
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </div>
          <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-950">
            {failed || !open ? (
              <CameraView printerId={printerId} name={name} modelName={modelName} snapshotAt={snapshotAt} className="aspect-video rounded-none" />
            ) : session?.kind === "video" ? (
              <VideoStream session={session} onFail={fail} />
            ) : session?.kind === "jpeg-frames" ? (
              <FrameStream url={session.wsUrl} onFail={fail} />
            ) : null}
            {!failed && session && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="全屏"
                onClick={() => void box.current?.requestFullscreen?.()}
                className="absolute right-3 bottom-3 bg-black/45 text-white hover:bg-black/60 hover:text-white"
              >
                <Maximize className="size-4" />
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** WebRTC through WHEP; LL-HLS where the browser plays it natively. */
function VideoStream({ session, onFail }: { session: Extract<Session, { kind: "video" }>; onFail: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let pc: RTCPeerConnection | null = null;
    let gone = false;
    const hls = () => {
      if (session.hlsUrl && v.canPlayType("application/vnd.apple.mpegurl")) v.src = session.hlsUrl;
      else onFail();
    };
    const whep = async (url: string) => {
      pc = new RTCPeerConnection();
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (e) => (v.srcObject = e.streams[0] ?? new MediaStream([e.track]));
      pc.onconnectionstatechange = () => pc?.connectionState === "failed" && !gone && onFail();
      await pc.setLocalDescription(await pc.createOffer());
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${session.token}` }, body: pc.localDescription!.sdp });
      if (!r.ok) throw new Error(`whep ${r.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    };
    if (session.whepUrl) whep(session.whepUrl).catch(() => !gone && (pc?.close(), hls()));
    else hls();
    v.onerror = () => !gone && onFail();
    return () => {
      gone = true;
      pc?.close();
      v.removeAttribute("src");
      v.srcObject = null;
    };
  }, [session, onFail]);
  return <video ref={video} autoPlay muted playsInline className="size-full object-contain" />;
}

/** Cameras without video send one JPEG per WebSocket message. */
function FrameStream({ url, onFail }: { url: string; onFail: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const ws = new WebSocket(url);
    ws.binaryType = "blob";
    let last: string | null = null;
    ws.onmessage = (e) => {
      if (!(e.data instanceof Blob)) return;
      const next = URL.createObjectURL(e.data);
      setSrc(next);
      if (last) URL.revokeObjectURL(last);
      last = next;
    };
    ws.onerror = () => onFail();
    ws.onclose = (e) => e.code !== 1000 && onFail();
    return () => {
      ws.onclose = null;
      ws.close(1000);
      if (last) URL.revokeObjectURL(last);
    };
  }, [url, onFail]);
  return src ? <img src={src} alt="实况画面" className="size-full object-contain" /> : null;
}
