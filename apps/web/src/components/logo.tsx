import { cn } from "@/lib/utils";

/** PlateRelay mark: a build plate leaving the printer, on an ink tile. */
export function Logo({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center bg-primary text-primary-foreground", className)} style={{ width: size, height: size, borderRadius: size * 0.29 }}>
      <svg viewBox="0 0 24 24" width={size * 0.54} height={size * 0.54} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="14" height="14" rx="2" />
        <path d="M4 7.2L7.6 3.6A2 2 0 0 1 9 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-.6 1.4L17 19.8M16.6 7.4L20.4 3.6" />
        <path d="M4 11.5h12M6.5 18.6h7" />
        <rect x="8.5" y="9.5" width="3" height="3.5" rx=".8" fill="currentColor" stroke="none" />
        <path d="M9.25 13h1.5l-.75 1.2z" fill="currentColor" strokeWidth={0.8} />
        <rect x="8" y="15.5" width="4" height="2.3" rx=".5" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
