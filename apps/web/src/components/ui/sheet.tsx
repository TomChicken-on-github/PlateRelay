import { AlertDialog, Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const overlay = "fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";

/**
 * A task sheet: slides up from the bottom on phones, a centred dialog on desktop. Title and a muted
 * subtitle on top, the body, then a two-button row (返回 + the action).
 */
export function Sheet({ open, onOpenChange, title, sub, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; sub?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex max-h-[92dvh] flex-col gap-5 overflow-y-auto bg-card text-card-foreground outline-none",
            "inset-x-0 bottom-0 rounded-t-3xl px-5 pt-2.5 pb-[max(36px,env(safe-area-inset-bottom))] data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            "lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[440px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:px-6 lg:pt-6 lg:pb-6 lg:data-[state=closed]:slide-out-to-bottom-0 lg:data-[state=closed]:zoom-out-95 lg:data-[state=open]:slide-in-from-bottom-0 lg:data-[state=open]:zoom-in-95",
          )}
        >
          <span aria-hidden="true" className="h-1 w-9 shrink-0 self-center rounded-full bg-neutral-300 lg:hidden dark:bg-neutral-700" />
          <div className="flex flex-col gap-0.5">
            <Dialog.Title className="m-0 text-lg leading-[26px] font-bold">{title}</Dialog.Title>
            {sub && <span className="text-[13px] leading-5 text-muted-foreground">{sub}</span>}
          </div>
          {children}
          <div className="grid grid-cols-2 gap-2.5">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A centred desktop dialog for a short form: title, fields, then 取消 and the action aligned right. */
export function Modal({ open, onOpenChange, title, width = 400, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; width?: 400 | 440; children: ReactNode; footer: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[92dvh] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-[20px] bg-card px-8 py-7 text-card-foreground shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            width === 440 ? "max-w-[440px]" : "max-w-[400px]",
          )}
        >
          <Dialog.Title className="m-0 text-lg leading-[26px] font-bold">{title}</Dialog.Title>
          {children}
          <div className="mt-1 flex justify-end gap-2">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A small centred confirmation over everything else, for steps that cannot be undone. */
export function Confirm({ open, onOpenChange, title, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-64px)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-[20px] bg-card px-5 pt-6 pb-5 text-card-foreground outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex flex-col gap-1.5">
            <AlertDialog.Title className="m-0 text-[17px] leading-6 font-bold">{title}</AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-sm leading-[22px] text-subtle-foreground">{children}</AlertDialog.Description>
          </div>
          <div className="grid grid-cols-2 gap-2.5">{footer}</div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export { AlertDialog, Dialog };
