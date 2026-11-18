import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { UserAvatar } from "@/components/user-avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { client, errorText, idem, unwrap } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ROLE } from "./me-page";

/** 个人资料: avatar, nickname (editable), username, email, role. */
export function ProfilePage() {
  const { user } = useMe();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const rows: [string, string | null][] = [
    ["用户名", user.username],
    ["邮箱", user.email],
    ["身份", ROLE[user.role]],
  ];
  const row = "flex h-[52px] items-center gap-3 px-4";
  return (
    <>
      <header className="-ml-1 flex h-11 items-center gap-2">
        <button type="button" aria-label="返回" onClick={() => navigate("/me")} className="grid size-10 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="m-0 text-xl leading-7 font-semibold">个人资料</h1>
      </header>
      <div className="flex flex-col items-center lg:max-w-[560px]">
        <UserAvatar id={user.id} name={user.displayName} url={user.avatarUrl} size={88} />
      </div>
      <ul className="m-0 flex list-none flex-col rounded-2xl bg-card p-0 lg:max-w-[560px]">
        <li>
          <button type="button" onClick={() => setEditing(true)} className={cn(row, "w-full rounded-t-2xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
            <span className="shrink-0 text-[15px]">昵称</span>
            <span className="min-w-0 flex-1 truncate text-right text-sm text-muted-foreground">{user.displayName}</span>
            <ChevronRight className="size-[18px] text-faint" aria-hidden="true" />
          </button>
        </li>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <li key={k} className={cn(row, "shadow-[inset_0_1px_0_var(--border)]")}>
              <span className="shrink-0 text-[15px]">{k}</span>
              <span className="min-w-0 flex-1 truncate text-right text-sm text-muted-foreground">{v}</span>
            </li>
          ))}
      </ul>
      <NicknameSheet open={editing} onOpenChange={setEditing} />
    </>
  );
}

function NicknameSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState(user.displayName);
  const save = useMutation({
    mutationFn: () => unwrap(client.PATCH("/me", { params: idem(), body: { version: user.version, displayName: name.trim() } })),
    onSuccess: (me) => (qc.setQueryData(["me"], me), onOpenChange(false)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => (v && setName(user.displayName), onOpenChange(v))}
      title="昵称"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            返回
          </Button>
          <Button size="lg" disabled={!name.trim() || name.trim() === user.displayName || save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input aria-label="昵称" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        {save.error && <Alert>{errorText(save.error)}</Alert>}
      </div>
    </Sheet>
  );
}
