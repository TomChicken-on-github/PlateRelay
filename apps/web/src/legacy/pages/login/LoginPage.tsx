import { type FormEvent, type ReactNode, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Button, IconButton } from "../../components/Button";
import { Field, TextInput } from "../../components/Field";
import { FigmaIcon } from "../../components/icons/FigmaIcon";
import { Icon } from "../../components/icons/Icon";
import { login, register, session } from "../../lib/session";

type Mode = "login" | "register";
type Errs = Partial<Record<"username" | "displayName" | "password", string>>;

/* Only same-site paths, so ?next= cannot send someone off to another site after signing in. */
const safeNext = (s: string | null) => (s && s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/login") && !s.startsWith("/register") ? s : "/");

function PasswordField({ value, onChange, error, hint, autoComplete }: { value: string; onChange: (v: string) => void; error?: string; hint?: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label="密码" error={error} hint={hint}>
      {(id, cls) => (
        <div className="relative flex">
          <input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} pr-[52px]`} />
          <IconButton size={40} label={show ? "隐藏密码" : "显示密码"} icon={show ? "visibility_off" : "visibility"} onClick={() => setShow((v) => !v)} className="absolute top-1 right-1" />
        </div>
      )}
    </Field>
  );
}

function Banner({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl bg-err-bg px-4 py-3.5 text-err">
      <Icon name="error" />
      <div>
        <b className="block text-label-l font-medium">{title}</b>
        {children && <span className="text-body-s">{children}</span>}
      </div>
    </div>
  );
}

/**
 * Sign-in and self sign-up (/login, /register). A card on wide screens, the full screen on phones.
 * Accounts are username + password (apps/server auth); new accounts get the User role.
 */
export function LoginPage({ mode }: { mode: Mode }) {
  const s = session.use();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [errs, setErrs] = useState<Errs>({});
  const [banner, setBanner] = useState<{ t: string; s?: string } | null>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (s.st === "in") return <Navigate to={next} replace />;
  const reg = mode === "register";
  const other = `${reg ? "/login" : "/register"}${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;

  const check = (): Errs => {
    const e: Errs = {};
    if (!username.trim()) e.username = "请输入用户名";
    else if (reg && !/^[\p{L}\p{N}_.-]{2,32}$/u.test(username.trim())) e.username = "2–32 位，只能用字母、数字、_ . -";
    if (reg && !displayName.trim()) e.displayName = "请输入显示名称";
    if (!password) e.password = "请输入密码";
    else if (reg && password.length < 8) e.password = "密码至少 8 位";
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = check();
    setErrs(e);
    setBanner(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    const r = reg ? await register(username.trim(), displayName.trim(), password) : await login(username.trim(), password);
    setBusy(false);
    if (r.ok) return navigate(next, { replace: true });
    const err = r.error as { code: string; message: string; issues?: { path: string; message: string }[] };
    if (err.code === "registration-closed") return setClosed(true);
    if (err.code === "bad-credentials") return setBanner({ t: "用户名或密码错误", s: "忘记密码请找现场工作人员重置。" });
    if (err.code === "username-taken") return setErrs({ username: "这个用户名已经有人用了" });
    if (err.code === "invalid" && err.issues?.length) return setErrs(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
    setBanner({ t: reg ? "注册失败" : "登录失败", s: err.message });
  };

  /* Typing in a field clears that field's error. */
  const field = (k: keyof Errs, set: (v: string) => void) => (x: string) => {
    set(x);
    if (errs[k]) setErrs({ ...errs, [k]: undefined });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface px-4 py-10 text-on-surface max-sm:justify-start max-sm:gap-8 max-sm:px-6 max-sm:pt-14">
      <div className="flex items-center gap-2.5 text-title-l font-semibold max-sm:self-start">
        <FigmaIcon name="brand" className="h-8 w-[35px] text-primary" />
        <span>PlateRelay</span>
      </div>
      <section className="flex w-full max-w-[400px] flex-col gap-6 rounded-2xl bg-sc p-8 max-sm:max-w-none max-sm:rounded-none max-sm:bg-transparent max-sm:p-0">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-headline-s font-medium max-sm:text-[28px] max-sm:leading-9">{reg ? "注册" : "登录"}</h1>
          <p className="m-0 text-body-m text-on-variant">{reg ? "新账号是选手身份，可以提交打印和查看自己的订单。" : "用面板账号登录，登录后回到刚才的页面。"}</p>
        </div>

        {closed ? (
          <>
            <div role="status" className="flex flex-col items-center gap-2 rounded-2xl bg-sc-high px-4 py-8 text-center max-sm:bg-sc">
              <Icon name="lock" size={40} className="text-on-variant" />
              <b className="text-title-m font-medium">现在没有开放注册</b>
              <span className="text-body-m text-on-variant">请找现场工作人员为你开账号，拿到用户名和密码后回来登录。</span>
            </div>
            <Link to={other.replace("/register", "/login")} className="state-layer flex h-9 items-center justify-center rounded-full text-label-l font-medium text-primary no-underline shadow-[inset_0_0_0_1px_var(--md-outline)]">
              返回登录
            </Link>
          </>
        ) : (
          <>
            {banner && <Banner title={banner.t}>{banner.s}</Banner>}
            <form className="m-0 flex flex-col gap-4" onSubmit={submit} noValidate>
              <Field label="用户名" error={errs.username} hint={reg ? "2–32 位，可以用字母、数字、_ . -，登录时用" : undefined}>
                {(id, cls) => (
                  <TextInput id={id} className={cls} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={(e) => field("username", setUsername)(e.target.value)} />
                )}
              </Field>
              {reg && (
                <Field label="显示名称" error={errs.displayName} hint="工作人员核销取件时看到的名字">
                  {(id, cls) => <TextInput id={id} className={cls} autoComplete="nickname" maxLength={32} value={displayName} onChange={(e) => field("displayName", setDisplayName)(e.target.value)} />}
                </Field>
              )}
              <PasswordField value={password} onChange={field("password", setPassword)} error={errs.password} autoComplete={reg ? "new-password" : "current-password"} />
              <Button type="submit" disabled={busy} className="mt-2 w-full">
                {busy ? (reg ? "正在注册…" : "正在登录…") : reg ? "注册并登录" : "登录"}
              </Button>
            </form>
            <div className="flex items-center justify-center gap-1 text-body-m text-on-variant">
              <span>{reg ? "已有账号？" : "还没有账号？"}</span>
              <Link to={other} className="state-layer inline-flex h-9 items-center rounded-full px-3 text-label-l font-medium text-primary no-underline">
                {reg ? "登录" : "注册"}
              </Link>
            </div>
          </>
        )}
      </section>
      <p className="m-0 text-body-s text-on-variant max-sm:hidden">共享 3D 打印管理面板 · GPLv3</p>
    </main>
  );
}
