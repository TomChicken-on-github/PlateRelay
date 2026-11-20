import { ChevronLeft, CircleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/api";
import { useAuthMethods, useSessionActions } from "@/lib/session";
import { AuthLayout, Field } from "./auth-layout";
import { PasswordInput } from "./password-input";

export function RegisterPage() {
  const { register } = useSessionActions();
  const methods = useAuthMethods();
  const navigate = useNavigate();
  const [f, setF] = useState({ inviteCode: "", username: "", displayName: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const m = methods.data?.register ?? [];
  const invite = m.includes("INVITE");
  if (methods.data && !invite && !m.includes("OPEN")) return <Navigate to="/login" replace />;

  const ready = (!invite || f.inviteCode.trim()) && f.username.trim() && f.displayName.trim() && f.password.length >= 8 && agreed;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ username: f.username.trim(), displayName: f.displayName.trim(), password: f.password, ...(invite ? { inviteCode: f.inviteCode.trim() } : {}) });
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      footer={
        <>
          已有账户？
          <Link to="/login" className="font-semibold text-foreground">
            登录
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-7 pt-5">
        <header className="-ml-4 flex h-11 items-center">
          <Button variant="ghost" size="icon" aria-label="返回" onClick={() => navigate("/login")}>
            <ChevronLeft className="size-[22px]" />
          </Button>
        </header>
        <h1 className="m-0 text-[28px] leading-9 font-bold tracking-[-0.5px]">注册</h1>
        {error && (
          <Alert>
            <CircleAlert aria-hidden="true" />
            {error}
          </Alert>
        )}
        <form onSubmit={submit} className="flex flex-col gap-[18px]">
          <Field label="用户名" htmlFor="username">
            <Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={f.username} onChange={set("username")} required />
          </Field>
          <Field label="昵称" htmlFor="nickname">
            <Input id="nickname" autoComplete="nickname" value={f.displayName} onChange={set("displayName")} required />
          </Field>
          <Field label="密码" htmlFor="password">
            <PasswordInput id="password" autoComplete="new-password" minLength={8} value={f.password} onChange={set("password")} required />
          </Field>
          {invite && (
            <Field label="邀请码" htmlFor="invite">
              <Input id="invite" autoCapitalize="characters" spellCheck={false} value={f.inviteCode} onChange={set("inviteCode")} required />
            </Field>
          )}
          <label className="mt-0.5 flex items-start gap-2.5 text-sm leading-5">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
            {/* the agreement and policy texts have no source yet, so the titles are not links */}
            <span>
              我已阅读并同意<b className="font-semibold">《用户协议》</b>和<b className="font-semibold">《隐私政策》</b>
              <span aria-hidden="true" className="ml-0.5 text-alert">
                *
              </span>
            </span>
          </label>
          <Button type="submit" size="lg" className="mt-1.5" disabled={busy || !ready}>
            注册
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
