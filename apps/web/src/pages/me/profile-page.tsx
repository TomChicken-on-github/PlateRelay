import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import { BackHeader } from "@/components/page-header";
import { UserAvatar } from "@/components/user-avatar";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ROLE } from "./me-page";

/** 个人资料: avatar, nickname (editable), username, email, role. */
export function ProfilePage() {
  const { user } = useMe();
  const navigate = useNavigate();
  const rows: [string, string | null][] = [
    ["用户名", user.username],
    ["邮箱", user.email],
    ["身份", ROLE[user.role]],
  ];
  const row = "flex h-[52px] items-center gap-3 px-4";
  return (
    <>
      <BackHeader title="个人资料" onBack={() => navigate("/me")} />
      <div className="flex flex-col items-center lg:max-w-[560px]">
        <UserAvatar id={user.id} name={user.displayName} url={user.avatarUrl} size={88} />
      </div>
      <ul className="m-0 flex list-none flex-col rounded-2xl bg-card p-0 lg:max-w-[560px]">
        <li>
          <button type="button" onClick={() => navigate("/me/nickname")} className={cn(row, "w-full rounded-t-2xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
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
    </>
  );
}
