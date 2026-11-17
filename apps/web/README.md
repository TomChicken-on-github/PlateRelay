# @platerelay/web

PlateRelay 面板前端：React 19 + Vite + Tailwind CSS v4 + shadcn/ui + TanStack Query / Table + Motion + React Router。数据全部来自 `apps/server` 的接口，类型由共享契约（`packages/shared/schema/openapi.yaml`）生成。

## 运行

```bash
pnpm install
pnpm --filter @platerelay/shared build   # 前端从共享包的构建产物里取代码
pnpm dev:server                          # 在仓库根目录；面板后端，监听 :3000
pnpm dev:web                             # 前端，/api 代理到 :3000
```

后端只接受来自 `PLATERELAY_PUBLIC_ORIGIN` 的写请求，开发时把它设成前端的地址（默认 `http://localhost:5173`）。第一次启动没有账户，按 `apps/server/README.md` 建第一个管理员。

## 两套页面

| 入口 | 路径 | 内容 |
| --- | --- | --- |
| `index.html` → `src/main.tsx` | 除 `/legacy` 以外的全部 | 新面板：shadcn/ui，按设计画布实现 |
| `legacy.html` → `src/legacy/main.tsx` | `/legacy/*` | 旧的 MD3 页面（mock 数据），后台页重新设计完之前先保留；新面板侧栏里的后台链接指向这里 |

两个入口各自打包各自的样式表，主题互不影响。开发和 `vite preview` 时 `/legacy/*` 自动返回 `legacy.html`；部署时反向代理也要这样配。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/styles/globals.css` | 主题 token：表面和文字用 Tailwind neutral，状态五层（ok 绿 / busy 蓝 / wait 琥珀 / idle 灰 / alert 红）各有文字、底色、圆点三个值；明暗两套，跟随系统 |
| `src/components/ui/` | shadcn/ui 组件（按钮是全圆角胶囊） |
| `src/components/` | 外壳（桌面 232 宽侧栏，手机底部导航）、页头、头像、标志 |
| `src/lib/api.ts` | 带类型的接口客户端；写请求自动带 `Idempotency-Key`；错误码转中文 |
| `src/lib/session.ts` | 登录会话、权限判断 |
| `src/lib/live.ts` | 实时推送（SSE），收到变更就让相关查询重新取数 |
| `src/pages/` | 页面 |

颜色只用主题 token 或 Tailwind 调色板，不写十六进制。字体：Inter + Noto Sans SC，打印机名、序列号、取件码用 Maple Mono。字体都本地打包，场馆内网离线也能用。
