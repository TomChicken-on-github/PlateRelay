import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import { duration, easing } from "../lib/motion";
import { useMedia } from "../lib/useMedia";
import { Icon } from "./icons/Icon";

/**
 * MD3 dialog on wide screens, MD3 bottom sheet at 640px and below (same content either way).
 * `dismissible={false}` keeps it open on scrim click and Escape, e.g. while a one-time token is shown.
 */
export function Sheet({
  open,
  onClose,
  title,
  titleSize = "sm",
  icon,
  sub,
  footer,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  titleSize?: "sm" | "lg";
  /** A Material Symbols name, or a node such as a FigmaIcon. */
  icon?: string | ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  children?: ReactNode;
}) {
  const mobile = useMedia("(max-width: 640px)");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),textarea:not([disabled])") ?? ref.current;
      el?.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, dismissible, onClose]);

  const enter = { duration: duration.medium4, ease: easing.emphasizedDecelerate };
  const exit = { duration: duration.short4, ease: easing.emphasizedAccelerate };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" key="sheet">
          <motion.div
            className="absolute inset-0 bg-black/32"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            onClick={dismissible ? onClose : undefined}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cx(
              "absolute flex flex-col gap-4 overflow-auto bg-sc-high shadow-[0_8px_24px_rgb(0_0_0/0.35)] outline-none",
              mobile
                ? "inset-x-0 bottom-0 max-h-[85vh] rounded-t-[28px] px-6 pt-3 pb-[calc(24px+env(safe-area-inset-bottom,0px))]"
                : "top-1/2 left-1/2 max-h-[calc(100vh-32px)] w-[min(400px,calc(100vw-32px))] rounded-[28px] p-6",
            )}
            style={mobile ? undefined : { x: "-50%", y: "-50%" }}
            initial={mobile ? { y: "100%" } : { opacity: 0, scale: 0.92 }}
            animate={mobile ? { y: 0, transition: enter } : { opacity: 1, scale: 1, transition: enter }}
            exit={mobile ? { y: "100%", transition: exit } : { opacity: 0, scale: 0.96, transition: exit }}
          >
            {mobile && <div className="h-1 w-8 flex-none self-center rounded-sm bg-outline opacity-60" />}
            {icon && (typeof icon === "string" ? <Icon name={icon} className="self-center text-primary" /> : <span className="flex self-center text-primary">{icon}</span>)}
            <h2 className={cx("m-0", titleSize === "lg" ? "text-headline-s font-normal" : "text-[20px] leading-7 font-medium", icon && "-mt-1 text-center")}>{title}</h2>
            {sub && <div className="-mt-2 text-note text-on-variant">{sub}</div>}
            {children}
            {footer && <div className="flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
