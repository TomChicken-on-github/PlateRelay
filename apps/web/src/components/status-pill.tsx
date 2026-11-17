import { TONE, type Tone } from "@/components/printer/status";
import { cn } from "@/lib/utils";

/** Rounded status label with a coloured dot. */
export function StatusPill({ tone, label, dot, className }: { tone: Tone; label: string; dot?: "breathe" | "hollow"; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-[9px] text-xs font-semibold whitespace-nowrap", t.surface, t.text, className)}>
      <i className={cn("size-2 rounded-full border-[1.5px]", t.border, dot === "hollow" ? "bg-transparent" : t.dot, dot === "breathe" && "animate-breathe")} />
      {label}
    </span>
  );
}

/** Small coloured dot and text, without the pill background. */
export function StatusText({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs leading-[18px] font-semibold", t.text, className)}>
      <i className={cn("size-2 rounded-full", t.dot)} />
      {label}
    </span>
  );
}
