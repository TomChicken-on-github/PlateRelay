# @platerelay/web

PlateRelay 面板前端原型：React 19 + Vite + Tailwind CSS v4 + Motion + React Router。目前只有前端，数据全部来自 `src/mock/`，不连后端，也不会碰任何打印机。

## 运行

```bash
pnpm install
pnpm dev:web        # 在仓库根目录；或 cd apps/web && pnpm dev
pnpm build:web      # tsc 类型检查 + 生产构建
```

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/styles/index.css` | MD3 颜色、字号、动效 token（明暗两套），Tailwind `@theme` 映射 |
| `src/lib/motion.ts` | MD3 easing / duration token，供 Motion 使用；尊重 `prefers-reduced-motion` |
| `src/components/` | 通用组件：按钮（36px 全圆角）、筛选标签、弹窗/底部面板、输入框、开关、复选框、波浪进度条等 |
| `src/pages/` | 九个页面：概况 + 设备详情、提交订单、我的订单、待办、扫码核销、审核队列、订单管理 + 详情、打印机管理、系统设置 |
| `src/mock/` | 假数据；用 `createStore` 共享，切页面后状态保留 |

字体（Roboto、Noto Sans SC、Inter）和 Material Symbols Rounded 图标都本地打包，场馆内网离线也能用。
