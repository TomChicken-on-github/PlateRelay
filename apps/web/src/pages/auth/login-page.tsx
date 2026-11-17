import { CircleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Logo } from "@/components/logo";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/api";
import { useAuthMethods, useSessionActions } from "@/lib/session";
import { AuthLayout, Field } from "./auth-layout";
import { PasswordInput } from "./password-input";

export function LoginPage() {
  const { login } = useSessionActions();
  const methods = useAuthMethods().data;
  const navigate = useNavigate();
  const back = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(back, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const canRegister = !!methods && (methods.register.includes("INVITE") || methods.register.includes("OPEN"));

  return (
    <AuthLayout
      footer={
        canRegister && (
          <>
            没有账户？
            <Link to="/register" className="font-semibold text-foreground">
              {methods.register.includes("INVITE") ? "使用邀请码注册" : "注册"}
            </Link>
          </>
        )
      }
    >
      <div className="flex flex-col gap-8 pt-[88px]">
        <div className="flex flex-col gap-5">
          <Logo size={52} />
          <h1 className="m-0 text-[28px] leading-9 font-bold tracking-[-0.5px]">登录 PlateRelay</h1>
        </div>
        {error && (
          <Alert>
            <CircleAlert aria-hidden="true" />
            {error}
          </Alert>
        )}
        <form onSubmit={submit} className="flex flex-col gap-[18px]">
          <Field label="用户名" htmlFor="username">
            <Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="密码" htmlFor="password">
            <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" size="lg" className="mt-1.5" disabled={busy || !username.trim() || !password}>
            登录
          </Button>
        </form>
        {methods && methods.oidc.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 text-[13px] text-faint">
              <i className="h-px flex-1 bg-border" />或<i className="h-px flex-1 bg-border" />
            </div>
            {methods.oidc.map((p) => (
              <Button key={p.id} variant="outline" size="lg" asChild>
                <a href={`/api/v1/auth/oidc/${encodeURIComponent(p.id)}/start`}>
                  {/* the provider's own logo is not in the contract yet: its initial stands in */}
                  <span aria-hidden="true" className="grid size-5 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
                    {[...p.displayName][0]}
                  </span>
                  使用{p.displayName}登录
                </a>
              </Button>
            ))}
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
