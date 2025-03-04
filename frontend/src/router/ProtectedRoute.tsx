import { ReactNode, useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../common/constants/routes";
import { UserType } from "../common/types/auth.types";

interface ProtectedRouteProps {
  children: ReactNode;
  userType?: UserType;
}

// Mock authentication - replace with actual auth logic later
const useAuth = () => {
  // This is a placeholder. In a real app, you would use a context or hook to get the user's auth state
  const user = localStorage.getItem("user")
    ? JSON.parse(localStorage.getItem("user") || "{}")
    : null;
  return {
    user,
    isAuthenticated: !!user,
    userType: user?.userType as UserType | undefined,
  };
};

const ProtectedRoute = ({ children, userType }: ProtectedRouteProps) => {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // If not authenticated, redirect to login
    if (!isAuthenticated) {
      navigate(ROUTES.LOGIN, { replace: true, state: { from: location } });
      return;
    }

    // If userType is specified and doesn't match the user's type, redirect to unauthorized
    if (userType && user?.userType !== userType) {
      navigate(ROUTES.ERROR.UNAUTHORIZED, { replace: true });
    }
  }, [isAuthenticated, user, userType, location, navigate]);

  // If not authenticated or not authorized, render nothing while the redirect happens
  if (!isAuthenticated || (userType && user?.userType !== userType)) {
    return null;
  }

  // If authenticated and authorized, render the children
  return <>{children}</>;
};

export default ProtectedRoute;
