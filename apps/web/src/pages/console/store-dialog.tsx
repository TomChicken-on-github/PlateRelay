import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/sheet";
import { client, errorText, idem, unwrap } from "@/lib/api";
import { orderName, orderNo } from "@/lib/order-status";
import type { OrderSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Photo from the camera or the library, shrunk to a JPEG (the server wants one) of at most 1600 px. */
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85));
}


/**
 * 入库: where the finished print goes, a photo of it, and that the bed has been cleared. A slot that
 * already holds another order is refused before the request is made.
 */
export function StoreDialog({ order, open, onOpenChange, occupied }: { order: OrderSummary; open: boolean; onOpenChange: (open: boolean) => void; occupied: Map<string, string> }) {
  const qc = useQueryClient();
  const [seg, setSeg] = useState(["", "", ""]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [bed, setBed] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const slot = seg.every(Boolean) ? seg.join("-") : "";
  const clash = slot ? occupied.get(slot.toUpperCase()) : undefined;
  const skipped = useQuery({
    queryKey: ["order-parts", order.id],
    enabled: open,
    retry: false,
    queryFn: () => unwrap(client.GET("/orders/{orderId}/parts", { params: { path: { orderId: order.id } } })),
  });
  const skippedNames = (skipped.data?.parts ?? []).filter((p) => skipped.data?.skipped.includes(p.id)).map((p) => p.name);
  const needsBed = !!order.printer && order.printer.state === "CLEARING_REQUIRED";

  const store = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("expectedStatus", "PRINTED");
      body.append("slot", slot.toUpperCase());
      body.append("bedCleared", "true");
      body.append("photo", photo!.blob, "store.jpg");
      return unwrap(client.POST("/orders/{orderId}/store", { params: { path: { orderId: order.id }, ...idem() }, body: body as never, bodySerializer: (b: unknown) => b as FormData }));
    },
    onSuccess: () => {
      for (const k of ["orders", "order", "printers", "overview", "todo"]) void qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
  });

  const set = (i: number, v: string) => setSeg((s) => s.map((x, j) => (j === i ? v.toUpperCase().slice(0, 3) : x)));
  const input = "h-11 w-full rounded-xl border bg-transparent px-3 text-center font-mono text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
  void needsBed;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="入库"
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!slot || !!clash || !photo || !bed || store.isPending} onClick={() => store.mutate()}>
            确认入库
          </Button>
        </>
      }
    >
      <span className="-mt-3 text-[13px] leading-5 text-muted-foreground">
        {order.fileName ?? orderName(order)} · {orderNo(order.number)}
      </span>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-muted-foreground">暂存位</span>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="暂存位">
          {["区", "排", "格"].map((n, i) => (
            <input key={n} aria-label={n} placeholder={n} value={seg[i]} onChange={(e) => set(i, e.target.value)} aria-invalid={!!clash} className={cn(input, clash && "border-alert-dot ring-[3px] ring-alert-dot/20")} />
          ))}
        </div>
        {clash && (
          <span className="flex items-center gap-1.5 text-[13px] text-alert">
            <TriangleAlert className="size-4" aria-hidden="true" />
            该暂存位已存放 {clash}
          </span>
        )}
      </div>
      {skippedNames.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">跳过的零件</span>
          <div className="flex flex-wrap gap-2">
            {skippedNames.map((n) => (
              <span key={n} className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-[13px] text-subtle-foreground">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-muted-foreground">入库照片</span>
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const blob = await toJpeg(f).catch(() => null);
            if (blob) setPhoto({ blob, url: URL.createObjectURL(blob) });
          }}
        />
        <button type="button" onClick={() => file.current?.click()} aria-label={photo ? "重拍入库照片" : "拍摄入库照片"} className="relative grid size-24 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {photo ? <img src={photo.url} alt="" className="size-full object-cover" /> : <Camera className="size-6" aria-hidden="true" />}
        </button>
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox checked={bed} onCheckedChange={(v) => setBed(v === true)} />
        热床已清理
      </label>
      {store.error && <span className="text-[13px] text-alert">{errorText(store.error)}</span>}
    </Modal>
  );
}


