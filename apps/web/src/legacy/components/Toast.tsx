import { AnimatePresence, motion } from "motion/react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { duration, easing } from "../lib/motion";

const ToastCtx = createContext<(msg: string) => void>(() => {});

/** MD3 snackbar, one at a time, 2.6s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMsg({ id: Date.now(), text });
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <AnimatePresence>
          {msg && (
            <motion.div
              key={msg.id}
              role="status"
              className="fixed bottom-6 left-1/2 z-[60] flex min-h-12 items-center rounded-lg bg-on-surface px-4 text-body-m text-sc shadow-[0_4px_12px_rgb(0_0_0/0.3)] max-sm:bottom-4 max-sm:w-[calc(100%-32px)] sm:whitespace-nowrap"
              style={{ x: "-50%" }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { duration: duration.medium2, ease: easing.emphasizedDecelerate } }}
              exit={{ opacity: 0, transition: { duration: duration.short3, ease: easing.emphasizedAccelerate } }}
            >
              {msg.text}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
