import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
import { AppShell } from "./components/app-shell";
import { setSignedOutHandler } from "./lib/api";
import { useLiveUpdates } from "./lib/live";
import { signOut, useSession } from "./lib/session";
import { LoginPage } from "./pages/auth/login-page";
import { RegisterPage } from "./pages/auth/register-page";
import { OverviewPage } from "./pages/overview/overview-page";
import { MePage } from "./pages/me/me-page";
import { ProfilePage } from "./pages/me/profile-page";
import { OrderDetailPage } from "./pages/order/order-detail-page";
import { OrdersPage } from "./pages/orders/orders-page";
import { SubmitPage } from "./pages/submit/submit-page";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
setSignedOutHandler(() => signOut(queryClient));

/** Pages behind sign-in; while the session loads nothing is drawn. */
function SignedIn({ children }: { children: ReactNode }) {
  const s = useSession();
  const { pathname } = useLocation();
  useLiveUpdates(!!s.data);
  if (s.isPending) return null;
  if (!s.data) return <Navigate to="/login" replace state={{ from: pathname }} />;
  return children;
}

/** Sign-in pages send a signed-in visitor home. */
function SignedOut({ children }: { children: ReactNode }) {
  const s = useSession();
  if (s.isPending) return null;
  return s.data ? <Navigate to="/" replace /> : children;
}

const router = createBrowserRouter([
  { path: "/login", element: <SignedOut><LoginPage /></SignedOut> },
  { path: "/register", element: <SignedOut><RegisterPage /></SignedOut> },
  {
    element: (
      <SignedIn>
        <AppShell />
      </SignedIn>
    ),
    children: [
      { path: "/", element: <OverviewPage /> },
      { path: "/submit", element: <SubmitPage /> },
      { path: "/orders", element: <OrdersPage /> },
      { path: "/orders/:id", element: <OrderDetailPage /> },
      { path: "/me", element: <MePage /> },
      { path: "/me/profile", element: <ProfilePage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* reducedMotion="user": no transform animations when the system asks for reduced motion */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  );
}
