import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Input } from "@/components/ui/input";

/** Password field with a show/hide eye inside it. */
export function PasswordInput(props: Omit<ComponentProps<typeof Input>, "type">) {
  const [shown, setShown] = useState(false);
  const I = shown ? EyeOff : Eye;
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="pr-11" />
      <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? "隐藏密码" : "显示密码"} className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground">
        <I className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
