import { ChevronRight, LogOut, Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { NotificationBell, PageHeader } from "@/components/page-header";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import type { Schemas } from "@/lib/api";
import { useMe, useSessionActions } from "@/lib/session";
import { cn } from "@/lib/utils";
import { LoginMethodList, NicknameDialog, PasswordDialog } from "./account-forms";

export const ROLE: Record<Schemas["Role"], string> = { APPLICANT: "用户", STAFF: "现场人员", ADMIN: "管理员" };

const rule = "shadow-[inset_0_1px_0_var(--border)]";

/** 我的. Phone: the account card (opens 个人资料), settings rows and sign-out. Desktop: everything on one page. */
export function MePage() {
  return (
    <>
      <PageHeader title="我的" actions={<NotificationBell />} />
      <div className="contents lg:hidden">
        <PhoneMe />
      </div>
      <div className="hidden lg:contents">
        <DesktopMe />
      </div>
    </>
  );
}

function SignOut({ className }: { className?: string }) {
  const { logout } = useSessionActions();
  return (
    <Button variant="card" className={cn("text-alert", className)} onClick={() => void logout()}>
      <LogOut className="size-[18px]" aria-hidden="true" />
      退出登录
    </Button>
  );
}

function PhoneMe() {
  const { user } = useMe();
  return (
    <>
      <Link to="/me/profile" className="flex items-center gap-3.5 rounded-2xl bg-card p-4 text-inherit no-underline">
        <UserAvatar id={user.id} name={user.displayName} url={user.avatarUrl} size={56} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-lg leading-[26px] font-bold">{user.displayName}</span>
          <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{[ROLE[user.role], user.email ?? user.username].join(" · ")}</span>
        </span>
        <ChevronRight className="size-5 text-faint" aria-hidden="true" />
      </Link>
      <ul className="m-0 flex list-none flex-col rounded-2xl bg-card p-0">
        <li>
          <Link to="/me/login-methods" className="flex h-[52px] items-center gap-3 rounded-2xl px-4 text-inherit no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="flex-1 text-[15px]">登录方式</span>
            <ChevronRight className="size-[18px] text-faint" aria-hidden="true" />
          </Link>
        </li>
      </ul>
      <SignOut className="h-12 rounded-2xl text-[15px] shadow-none" />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 px-1 text-[15px] leading-[22px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function DesktopMe() {
  const { user } = useMe();
  const [nickname, setNickname] = useState(false);
  const [password, setPassword] = useState(false);
  const rows: [string, string | null][] = [
    ["用户名", user.username],
    ["邮箱", user.email],
    ["身份", ROLE[user.role]],
  ];
  const row = "flex h-[52px] items-center gap-3 px-4";
  const key = "w-16 shrink-0 text-sm text-muted-foreground";
  const val = "min-w-0 flex-1 truncate text-[15px]";
  return (
    <div className="flex w-[400px] flex-col gap-7">
      <Section title="个人资料">
        <div className="rounded-2xl bg-card">
          <div className="flex items-center gap-4 px-4 py-5">
            <UserAvatar id={user.id} name={user.displayName} url={user.avatarUrl} size={72} />
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            <li className={cn(row, rule)}>
              <span className={key}>昵称</span>
              <span className={val}>{user.displayName}</span>
              <Button variant="ghost" size="icon-sm" aria-label="修改昵称" className="text-muted-foreground" onClick={() => setNickname(true)}>
                <Pencil className="size-4" />
              </Button>
            </li>
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <li key={k} className={cn(row, rule)}>
                  <span className={key}>{k}</span>
                  <span className={val}>{v}</span>
                </li>
              ))}
          </ul>
        </div>
      </Section>
      <Section title="登录方式">
        <LoginMethodList onChangePassword={() => setPassword(true)} />
      </Section>
      <div>
        <SignOut />
      </div>
      <NicknameDialog open={nickname} onOpenChange={setNickname} />
      <PasswordDialog open={password} onOpenChange={setPassword} />
    </div>
  );
}
