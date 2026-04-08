import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getUser, saveAuth, extractSSOToken } from "@/api/auth";
import { apiPost } from "@/api/client";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { KeyboardHelp } from "@/components/ui/KeyboardHelp";
import { ThemeProvider } from "@/lib/theme";
import { Loader2 } from "lucide-react";

// Layouts (eagerly loaded — always needed)
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { SelfServiceLayout } from "@/components/layout/SelfServiceLayout";

// Route groups (lazy-loaded page imports live inside these files)
import { AdminRoutes } from "@/routes/admin.routes";
import { SelfServiceRoutes } from "@/routes/self-service.routes";

// Standalone lazy pages
const LoginPage = lazy(() =>
  import("@/pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const OnboardingPage = lazy(() =>
  import("@/pages/onboarding/OnboardingPage").then((m) => ({ default: m.OnboardingPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
    </div>
  );
}

const ADMIN_ROLES = ["org_admin", "hr_admin", "hr_manager"];

function RoleRedirect() {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (ADMIN_ROLES.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/my" replace />;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (!ADMIN_ROLES.includes(user.role)) {
    return <Navigate to="/my" replace />;
  }
  return <>{children}</>;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function SSOGate({ children }: { children: React.ReactNode }) {
  const [ssoToken] = useState(() => extractSSOToken());
  const [ready, setReady] = useState(!ssoToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ssoToken) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await apiPost<{
          user: any;
          tokens: { accessToken: string; refreshToken: string };
        }>("/auth/sso", { token: ssoToken });

        if (cancelled) return;

        saveAuth(res.data!);

        // Redirect to dashboard after SSO login
        if (window.location.pathname === "/" || window.location.pathname === "/login") {
          window.location.replace("/dashboard");
          return;
        }
        setReady(true);
      } catch (err: any) {
        if (cancelled) return;
        console.error("SSO exchange failed:", err);
        setError("SSO login failed. Please try logging in manually.");
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ssoToken]);

  if (!ready) return <PageLoader />;
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-600">{error}</p>
          <a href="/login" className="text-brand-600 underline">
            Go to login
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SSOGate>
            <BrowserRouter>
              <CommandPalette />
              <KeyboardHelp />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<AuthLayout />}>
                    <Route path="/login" element={<LoginPage />} />
                  </Route>

                  <Route path="/" element={<RoleRedirect />} />

                  <Route
                    element={
                      <AdminGuard>
                        <DashboardLayout />
                      </AdminGuard>
                    }
                  >
                    {AdminRoutes()}
                  </Route>

                  <Route
                    element={
                      <AuthGuard>
                        <SelfServiceLayout />
                      </AuthGuard>
                    }
                  >
                    {SelfServiceRoutes()}
                  </Route>

                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </SSOGate>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
