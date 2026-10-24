import { MotionConfig } from "motion/react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { ToastProvider } from "./components/Toast";
import { LoginPage } from "./pages/login/LoginPage";
import { OrderAdminPage } from "./pages/admin/OrderAdminPage";
import { MyOrdersPage } from "./pages/orders/MyOrdersPage";
import { OverviewPage } from "./pages/overview/OverviewPage";
import { PrinterDetailPage } from "./pages/detail/PrinterDetailPage";
import { PrintersPage } from "./pages/printers/PrintersPage";
import { ScanPage } from "./pages/scan/ScanPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { SubmitPage } from "./pages/submit/SubmitPage";
import { TodoPage } from "./pages/todo/TodoPage";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage key="login" mode="login" /> },
  { path: "/register", element: <LoginPage key="register" mode="register" /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <OverviewPage /> },
      { path: "/printers/:id", element: <PrinterDetailPage /> },
      { path: "/submit", element: <SubmitPage /> },
      { path: "/orders", element: <MyOrdersPage /> },
      { path: "/todo", element: <TodoPage /> },
      { path: "/scan", element: <ScanPage /> },
      { path: "/review", element: <OrderAdminPage mode="review" /> },
      { path: "/review/:id", element: <OrderAdminPage mode="review" /> },
      { path: "/manage/orders", element: <OrderAdminPage mode="manage" /> },
      { path: "/manage/orders/:id", element: <OrderAdminPage mode="manage" /> },
      { path: "/manage/printers", element: <PrintersPage /> },
      { path: "/settings", element: <Navigate to="/settings/form" replace /> },
      { path: "/settings/:tab", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    /* reducedMotion="user" turns transform animations off when the OS asks for reduced motion */
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </MotionConfig>
  );
}
