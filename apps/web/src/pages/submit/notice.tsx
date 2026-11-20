import { ChevronLeft } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDesktop } from "@/lib/use-desktop";
import { cn } from "@/lib/utils";

/*
 * 提交须知. The settings have no field for it yet, so this default text lives here; once the
 * organiser can edit it, it will come from the server.
 */
const CHECKS = [
  "悬空部分是否开启了支撑，支撑类型和接触面是否合适",
  "模型与热床的接触面积是否过小，必要时开启 Brim 或调整摆放方向",
  "切片的机型、喷嘴口径、打印板类型是否与「本场可用资源」中的一致",
  "耗材类型、颜色及左右喷嘴分配是否正确",
  "只用到一个喷嘴的模型是否切给了单喷头机型，不要无端占用双喷头打印机",
  "模型是否有破面、壁厚过薄、尺寸或比例错误",
  "预计用时和耗材用量是否合理",
];
const DUTIES: [string, string][] = [
  ["模型或切片问题由提交者自行承担", "因模型缺陷或切片参数错误（包括但不限于机型、喷嘴、耗材设置不当）导致的打印失败、翘边变形、强度不足、尺寸偏差、外观瑕疵等问题，均由提交者自行承担。如需重打，请修正后重新提交。"],
  ["设备原因由现场人员安排重打", "因打印机故障、耗材异常等设备原因导致的失败，由现场人员判定后安排重打，无需重新提交。"],
  ["审核不代表质量确认", "审核仅确认是否符合本场规则，不负责检查模型或切片参数，发现明显问题时可以驳回。通过审核不代表文件无误。"],
];
const COMPLIANCE = ["提交的模型及其用途须遵守国家法律法规，不得侵犯他人知识产权等合法权益。", "须遵守本场活动规则；禁止打印武器、管制器具及其仿制品。", "违反上述要求的订单将被驳回。"];
const OTHER = ["零件入库后凭取件码到取件处领取，超过存放期限未领取的零件由现场统一处理。"];

function NoticeText({ compact }: { compact?: boolean }) {
  const h2 = cn("m-0 mt-3 leading-[26px] font-bold text-foreground first:mt-0", compact ? "text-base" : "text-[17px]");
  const h3 = cn("m-0 mt-1 leading-[22px] font-semibold text-foreground", compact ? "text-sm" : "text-[15px]");
  const list = "m-0 flex list-disc flex-col gap-1.5 pl-5 marker:text-faint";
  return (
    <div className={cn("flex flex-none flex-col gap-3 leading-6 text-subtle-foreground", compact ? "text-sm" : "text-[15px]")}>
      <h2 className={h2}>提交前请自行检查</h2>
      <ul className={list}>
        {CHECKS.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <h2 className={h2}>责任说明</h2>
      {DUTIES.map(([t, p]) => (
        <div key={t} className="contents">
          <h3 className={h3}>{t}</h3>
          <p className="m-0">{p}</p>
        </div>
      ))}
      <h2 className={h2}>合规要求</h2>
      <ul className={list}>
        {COMPLIANCE.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <h2 className={h2}>其他</h2>
      <ul className={list}>
        {OTHER.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** True once the box has been scrolled to the bottom (or never needed scrolling); it stays true. */
function useReadToEnd(open: boolean) {
  const [read, setRead] = useState(false);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const check = useCallback(() => {
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) setRead(true);
  }, [el]);
  useEffect(() => {
    if (!open) return setRead(false);
    if (!el) return;
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, el, check]);
  return { read, ref: setEl, onScroll: check };
}

/**
 * The notice to read before submitting. 我已阅读并同意 stays disabled until the text has been scrolled to
 * the end. Phone: a full page over the submit page. Desktop: a 600px dialog.
 */
export function NoticeDialog({ open, onOpenChange, onAgree }: { open: boolean; onOpenChange: (open: boolean) => void; onAgree: () => void }) {
  const desktop = useDesktop();
  const box = useReadToEnd(open);
  const agree = () => (onAgree(), onOpenChange(false));
  const agreeButton = (lg: boolean) => (
    <Button size={lg ? "default" : "lg"} disabled={!box.read} onClick={agree} className="disabled:bg-border disabled:text-muted-foreground disabled:opacity-100">
      {box.read ? "我已阅读并同意" : "请先完整阅读"}
    </Button>
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {desktop ? (
          <>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed top-1/2 left-1/2 z-50 flex w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-[20px] bg-card px-8 py-7 text-card-foreground shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              <Dialog.Title className="m-0 text-lg leading-[26px] font-bold">提交须知</Dialog.Title>
              <div ref={box.ref} onScroll={box.onScroll} className="-mx-8 max-h-[440px] overflow-auto px-8 pb-2 shadow-[inset_0_-1px_0_var(--border)]">
                <NoticeText compact />
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="secondary">关闭</Button>
                </Dialog.Close>
                {agreeButton(true)}
              </div>
            </Dialog.Content>
          </>
        ) : (
          <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
            <header className="flex flex-none items-center gap-2 pt-5 pr-4 pb-3 pl-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="返回">
                  <ChevronLeft className="size-[22px]" />
                </Button>
              </Dialog.Close>
              <Dialog.Title className="m-0 text-xl leading-7 font-semibold">提交须知</Dialog.Title>
            </header>
            <div ref={box.ref} onScroll={box.onScroll} className="min-h-0 flex-1 overflow-auto px-5 pt-2 pb-6">
              <NoticeText />
            </div>
            <div className="flex flex-none flex-col px-4 pt-3 pb-[max(34px,env(safe-area-inset-bottom))] shadow-[0_-1px_0_var(--border)]">{agreeButton(false)}</div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
