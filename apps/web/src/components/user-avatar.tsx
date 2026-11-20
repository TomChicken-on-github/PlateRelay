import { cn } from "@/lib/utils";

/* Avatar colours, picked by the account id so a person keeps the same one everywhere. */
const TONES = ["bg-rose-500", "bg-orange-500", "bg-amber-600", "bg-emerald-600", "bg-teal-600", "bg-sky-600", "bg-blue-600", "bg-violet-600", "bg-fuchsia-600"];

function toneOf(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}

/** The uploaded picture, or the last character of the name on a colour. */
export function UserAvatar({ id, name, url, size = 32, className }: { id: string; name: string; url?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (url) return <img src={url} alt="" className={cn("shrink-0 rounded-full object-cover", className)} style={style} />;
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white", toneOf(id), className)} style={style}>
      {[...name.trim()].at(-1) ?? "?"}
    </span>
  );
}
