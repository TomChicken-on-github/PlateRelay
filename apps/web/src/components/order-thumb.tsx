import { Box } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** The plate's preview from the slicer, or a box icon when there is none. */
export function OrderThumb({ url, className }: { url: string | null | undefined; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-xl bg-muted", className)}>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} className="size-full object-contain" /> : <Box className="size-6 text-faint" aria-hidden="true" />}
    </span>
  );
}
