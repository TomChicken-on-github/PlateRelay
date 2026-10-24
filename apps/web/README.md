# @platerelay/web

PlateRelay 面板前端：React 19 + Vite + Tailwind CSS v4 + Motion + React Router。默认数据来自 `src/mock/`，不连后端，也不会碰任何打印机；提交页的文件解析总是走 `apps/server`。

## 运行

```bash
pnpm install
pnpm dev:web        # 在仓库根目录；或 cd apps/web && pnpm dev
pnpm build:web      # tsc 类型检查 + 生产构建
```

接后端：先 `pnpm dev:server`，再用 `VITE_API=http pnpm dev:web` 启动前端。这样需要登录（`/login`），菜单和页面按账号的权限节点显示，扫码核销和取件码走真实接口；其余页面暂时仍是 mock。不设 `VITE_API` 时自动以原型用户（Builder）登录，所有页面都能看。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/styles/index.css` | MD3 颜色、字号、动效 token（明暗两套），Tailwind `@theme` 映射 |
| `src/lib/motion.ts` | MD3 easing / duration token，供 Motion 使用；尊重 `prefers-reduced-motion` |
| `src/components/` | 通用组件：按钮（36px 全圆角）、筛选标签、弹窗/底部面板、输入框、开关、复选框、波浪进度条等 |
| `src/pages/` | 九个页面：概况 + 设备详情、提交订单、我的订单、待办、扫码核销、审核队列、订单管理 + 详情、打印机管理、系统设置 |
| `src/lib/api.ts`、`session.ts` | 接口客户端、登录会话、页面权限表 |
| `src/mock/` | 假数据；用 `createStore` 共享，切页面后状态保留 |

字体（Roboto、Noto Sans SC、Inter）和 Material Symbols Rounded 图标都本地打包，场馆内网离线也能用。
