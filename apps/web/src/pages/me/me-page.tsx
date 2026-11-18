import { ChevronRight, LogOut } from "lucide-react";
import { Link } from "react-router";
import { NotificationBell, PageHeader } from "@/components/page-header";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import type { Schemas } from "@/lib/api";
import { useMe, useSessionActions } from "@/lib/session";

export const ROLE: Record<Schemas["Role"], string> = { APPLICANT: "用户", STAFF: "现场人员", ADMIN: "管理员" };

/** 我的: the account card (opens 个人资料) and sign-out. */
export function MePage() {
  const { user } = useMe();
  const { logout } = useSessionActions();
  return (
    <>
      <PageHeader title="我的" actions={<NotificationBell />} />
      <Link to="/me/profile" className="flex items-center gap-3.5 rounded-2xl bg-card p-4 text-inherit no-underline">
        <UserAvatar id={user.id} name={user.displayName} url={user.avatarUrl} size={56} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-lg leading-[26px] font-bold">{user.displayName}</span>
          <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{[ROLE[user.role], user.email ?? user.username].join(" · ")}</span>
        </span>
        <ChevronRight className="size-5 text-faint" aria-hidden="true" />
      </Link>
      <Button variant="card" className="h-12 text-[15px] text-alert lg:self-start lg:px-8" onClick={() => void logout()}>
        <LogOut className="size-[18px]" aria-hidden="true" />
        退出登录
      </Button>
    </>
  );
}
