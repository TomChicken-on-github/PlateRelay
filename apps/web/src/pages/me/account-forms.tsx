import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { BackHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/sheet";
import { ApiError, client, errorText, idem, unwrap } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Field } from "../auth/auth-layout";
import { PasswordInput } from "../auth/password-input";

/* ---------- nickname ---------- */

function useNickname(done: () => void) {
  const { user } = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState(user.displayName);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/me", {
          params: idem(),
          body: { version: user.version, displayName: name.trim() },
        }),
      ),
    onSuccess: (me) => (qc.setQueryData(["me"], me), done()),
  });
  const ready = !!name.trim() && name.trim() !== user.displayName && !save.isPending;
  const reset = () => (setName(user.displayName), save.reset());
  return { name, setName, save, ready, reset };
}

function NicknameField({ f, compact }: { f: ReturnType<typeof useNickname>; compact?: boolean }) {
  return (
    <>
      <Field label="昵称" htmlFor="nickname">
        <Input id="nickname" autoComplete="nickname" maxLength={40} value={f.name} onChange={(e) => f.setName(e.target.value)} className={cn(compact && "h-11")} />
      </Field>
      {f.save.error && <Alert>{errorText(f.save.error)}</Alert>}
    </>
  );
}

/** Phone: the nickname on a page of its own. */
export function NicknamePage() {
  const navigate = useNavigate();
  const back = () => navigate(-1);
  const f = useNickname(back);
  const submit = (e: FormEvent) => (e.preventDefault(), f.ready && f.save.mutate());
  return (
    <>
      <BackHeader title="昵称" onBack={back} />
      <form onSubmit={submit} className="flex flex-col gap-[18px] lg:max-w-[440px]">
        <NicknameField f={f} />
        <Button type="submit" size="lg" className="mt-1.5" disabled={!f.ready}>
          保存
        </Button>
      </form>
    </>
  );
}

/** Desktop: the nickname in a 400px dialog over 我的. */
export function NicknameDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const f = useNickname(() => onOpenChange(false));
  return (
    <Modal
      open={open}
      onOpenChange={(v) => (v && f.reset(), onOpenChange(v))}
      title="修改昵称"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" form="nickname-form" disabled={!f.ready}>
            保存
          </Button>
        </>
      }
    >
      <form id="nickname-form" onSubmit={(e) => (e.preventDefault(), f.ready && f.save.mutate())} className="flex flex-col gap-4">
        <NicknameField f={f} compact />
      </form>
    </Modal>
  );
}

/* ---------- password ---------- */

const EMPTY = { current: "", next: "", again: "" };

function usePassword(done: () => void) {
  const [p, setP] = useState(EMPTY);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT("/me/password", {
          params: idem(),
          body: { current: p.current, next: p.next },
        }),
      ),
    onSuccess: done,
  });
  const mismatch = !!p.again && p.again !== p.next;
  const ready = !!p.current && p.next.length >= 8 && p.again === p.next && !save.isPending;
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setP((s) => ({ ...s, [k]: e.target.value }));
  const reset = () => (setP(EMPTY), save.reset());
  return { p, set, save, mismatch, ready, reset };
}

function PasswordFields({ f, compact }: { f: ReturnType<typeof usePassword>; compact?: boolean }) {
  const c = cn(compact && "h-11");
  return (
    <>
      <Field label="当前密码" htmlFor="pw-current">
        <PasswordInput id="pw-current" autoComplete="current-password" value={f.p.current} onChange={f.set("current")} className={c} />
      </Field>
      <Field label="新密码" htmlFor="pw-next">
        <PasswordInput id="pw-next" autoComplete="new-password" minLength={8} value={f.p.next} onChange={f.set("next")} className={c} />
      </Field>
      <Field label="确认新密码" htmlFor="pw-again">
        <PasswordInput id="pw-again" autoComplete="new-password" aria-invalid={f.mismatch || undefined} value={f.p.again} onChange={f.set("again")} className={c} />
      </Field>
      {f.mismatch && <Alert>两次输入的新密码不一致</Alert>}
      {f.save.error && <Alert>{f.save.error instanceof ApiError && f.save.error.code === "bad_credentials" ? "当前密码不正确" : errorText(f.save.error)}</Alert>}
    </>
  );
}

/** Phone: changing the password on a page of its own. */
export function PasswordPage() {
  const navigate = useNavigate();
  const back = () => navigate(-1);
  const f = usePassword(back);
  return (
    <>
      <BackHeader title="修改密码" onBack={back} />
      <form onSubmit={(e) => (e.preventDefault(), f.ready && f.save.mutate())} className="flex flex-col gap-[18px] lg:max-w-[440px]">
        <PasswordFields f={f} />
        <Button type="submit" size="lg" className="mt-1.5" disabled={!f.ready}>
          保存
        </Button>
      </form>
    </>
  );
}

/** Desktop: changing the password in a 440px dialog over 我的. */
export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const f = usePassword(() => onOpenChange(false));
  return (
    <Modal
      open={open}
      onOpenChange={(v) => (v && f.reset(), onOpenChange(v))}
      title="修改密码"
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" form="password-form" disabled={!f.ready}>
            保存
          </Button>
        </>
      }
    >
      <form id="password-form" onSubmit={(e) => (e.preventDefault(), f.ready && f.save.mutate())} className="flex flex-col gap-4">
        <PasswordFields f={f} compact />
      </form>
    </Modal>
  );
}

/* ---------- login methods ---------- */

/**
 * The ways this account can sign in. Only the password for now: the server cannot yet say which external
 * accounts are linked, or link and unlink them.
 */
export function LoginMethodList({ onChangePassword }: { onChangePassword: () => void }) {
  return (
    <ul className="m-0 flex list-none flex-col rounded-2xl bg-card p-0">
      <li className="flex min-h-14 items-center gap-3 px-4 py-2">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-subtle-foreground">
          <KeyRound className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] leading-[22px]">密码</span>
          <span className="truncate text-xs leading-[18px] text-muted-foreground">已设置</span>
        </span>
        <Button variant="secondary" size="sm" onClick={onChangePassword}>
          修改
        </Button>
      </li>
    </ul>
  );
}

/** Phone: 登录方式 as a page of its own. */
export function LoginMethodsPage() {
  const navigate = useNavigate();
  return (
    <>
      <BackHeader title="登录方式" onBack={() => navigate(-1)} />
      <div className="lg:max-w-[440px]">
        <LoginMethodList onChangePassword={() => navigate("/me/password")} />
      </div>
    </>
  );
}
