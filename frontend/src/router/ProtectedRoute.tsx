import { ReactNode, useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../common/constants/routes";
import { UserType } from "../common/types/auth.types";

interface ProtectedRouteProps {
  children: ReactNode;
  userType?: UserType;
  requiresVerification?: boolean;
}

// command for checking the mock authentication
// localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test User', userType: 'admin' }));

// Authentication hook
export const useAuth = () => {
  // Get user data from localStorage
  const user = localStorage.getItem("user")
    ? JSON.parse(localStorage.getItem("user") || "{}")
    : null;

  // For admin users, always consider them verified
  const isVerified =
    user?.userType === "admin"
      ? true
      : (user?.isVerified as boolean | undefined);

  return {
    user,
    isAuthenticated: !!user,
    userType: user?.userType as UserType | undefined,
    isVerified,
  };
};

const ProtectedRoute = ({
  children,
  userType,
  requiresVerification = false,
}: ProtectedRouteProps) => {
  const { isAuthenticated, user, isVerified } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // If not authenticated, redirect to login
    if (!isAuthenticated) {
      navigate(ROUTES.LOGIN, { replace: true, state: { from: location } });
      return;
    }

    // Handle verification routes
    if (requiresVerification) {
      // If user is already verified, redirect to dashboard
      if (isVerified) {
        const dashboardRoute =
          user?.userType === "admin"
            ? ROUTES.ADMIN.DASHBOARD
            : user?.userType === "teacher"
            ? ROUTES.TEACHER.DASHBOARD
            : ROUTES.STUDENT.DASHBOARD;
        navigate(dashboardRoute, { replace: true });
        return;
      }
    } else {
      // For non-verification routes, if user is not verified and not an admin, redirect to verify email
      if (!isVerified && user?.userType !== "admin") {
        navigate(ROUTES.VERIFY_EMAIL, { replace: true });
        return;
      }

      // If userType is specified and doesn't match the user's type, redirect to unauthorized
      if (userType && user?.userType !== userType) {
        navigate(ROUTES.ERROR.UNAUTHORIZED, { replace: true });
        return;
      }
    }
  }, [
    isAuthenticated,
    isVerified,
    user,
    userType,
    requiresVerification,
    location,
    navigate,
  ]);

  // If not authenticated or not meeting verification requirements, render nothing while redirect happens
  if (
    !isAuthenticated ||
    (requiresVerification && isVerified) ||
    (!requiresVerification && !isVerified && user?.userType !== "admin") ||
    (userType && user?.userType !== userType)
  ) {
    return null;
  }

  // If all checks pass, render the children
  return <>{children}</>;
};

export default ProtectedRoute;
