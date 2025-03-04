import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { routes } from "./routes";
import ProtectedRoute from "./ProtectedRoute";

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
        {routes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              route.protected ? (
                <ProtectedRoute userType={route.userType}>
                  <route.component />
                </ProtectedRoute>
              ) : (
                <route.component />
              )
            }
          />
        ))}
      </Routes>
    </Suspense>
  );
};

export default Router;
