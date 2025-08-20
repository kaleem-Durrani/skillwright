import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { routes } from "./routes";
import ProtectedRoute from "./ProtectedRoute";
import { AuthLayout, AppLayout } from "@/layouts";
import { VerifyEmail } from "@/pages";
import { ROUTES } from "@/common/constants";

// Loading component for Suspense
const Loading = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
  </div>
);

const Router = () => {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Public routes with AuthLayout */}
        <Route element={<AuthLayout />}>
          {routes
            .filter(
              (route) => !route.protected && route.path !== ROUTES.VERIFY_EMAIL
            )
            .map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={<route.component />}
              />
            ))}

          {/* Special handling for verify-email route */}
          <Route path={ROUTES.VERIFY_EMAIL} element={<VerifyEmail />} />
        </Route>

        {/* Protected routes with AppLayout */}
        <Route element={<AppLayout />}>
          {routes
            .filter((route) => route.protected)
            .map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={
                  <ProtectedRoute
                    userType={route.userType}
                    requiresVerification={route.requiresVerification}
                  >
                    <route.component />
                  </ProtectedRoute>
                }
              />
            ))}
        </Route>
      </Routes>
    </Suspense>
  );
};

export default Router;
