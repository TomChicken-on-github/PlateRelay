import type * as React from "react";
import { cn } from "@/lib/utils";

/* Cards in the designs are plain white (dark: neutral-900) blocks with 16px corners and no shadow. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("flex flex-col rounded-2xl bg-card text-card-foreground", className)} {...props} />;
}

export { Card };
