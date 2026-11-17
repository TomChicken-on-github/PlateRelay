import type * as React from "react";
import { cn } from "@/lib/utils";

/* Inline message: red only for things the user has to act on. */
function Alert({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn("flex items-center gap-2.5 rounded-xl bg-alert-surface px-3.5 py-3 text-sm leading-5 text-alert [&>svg]:size-[18px] [&>svg]:shrink-0", className)}
      {...props}
    />
  );
}

export { Alert };
