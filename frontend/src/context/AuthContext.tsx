import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

import { authService, UserType } from "../services/authService";
import { Admin, Teacher, Student, LoginCredentials } from "../common/types";
import { handleApiError, ERROR_DISPLAY_TYPES } from "../utils/errorHandler";

export type User = Admin | Teacher | Student;

interface AuthContextType {
  user: User | null;
  userType: UserType | null;
  isAuthenticated: boolean;
  isVerified: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials, type: UserType) => Promise<void>;
  logout: () => Promise<void>;
  updateUserVerification: (isVerified: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userType, setUserType] = useState<UserType | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state from localStorage and attempt token refresh
  useEffect(() => {
    initializeAuth();

    // Listen for force logout events from API interceptor
    const handleForceLogout = () => {
      logout();
    };

    window.addEventListener("auth:forceLogout", handleForceLogout);

    return () => {
      window.removeEventListener("auth:forceLogout", handleForceLogout);
    };
  }, []);

  // Listen for logout events from API interceptor
  useEffect(() => {
    const handleForceLogout = () => {
      setUser(null);
      setUserType(null);
      localStorage.removeItem("user");
      localStorage.removeItem("userType");
      console.warn("Session expired. Please login again.");
    };

    window.addEventListener("auth:forceLogout", handleForceLogout);

    return () => {
      window.removeEventListener("auth:forceLogout", handleForceLogout);
    };
  }, []);

  const initializeAuth = async () => {
    try {
      // Get stored user data
      const storedUser = localStorage.getItem("user");
      const storedUserType = localStorage.getItem("userType");

      if (
        storedUser &&
        storedUser !== "undefined" &&
        storedUser !== "null" &&
        storedUserType &&
        storedUserType !== "undefined" &&
        storedUserType !== "null"
      ) {
        try {
          setUser(JSON.parse(storedUser));
          setUserType(storedUserType as UserType);
        } catch (parseError) {
          console.warn("Failed to parse stored user data:", parseError);
          localStorage.removeItem("user");
          localStorage.removeItem("userType");
        }
      }

      // Try to get fresh profile data if we have stored user data
      if (
        storedUser &&
        storedUserType &&
        storedUser !== "undefined" &&
        storedUserType !== "undefined"
      ) {
        try {
          let response;
          // Call the appropriate profile endpoint based on user type
          if (storedUserType === "admin") {
            response = await authService.getAdminProfile();
          } else if (storedUserType === "teacher") {
            response = await authService.getTeacherProfile();
          } else if (storedUserType === "student") {
            response = await authService.getStudentProfile();
          }

          if (response?.success && response.data) {
            const userData = {
              ...response.data,
              userType: storedUserType as UserType,
            };
            setUser(userData as User);
            setUserType(storedUserType as UserType);
            localStorage.setItem("user", JSON.stringify(userData));
            localStorage.setItem("userType", storedUserType);
          }
        } catch (profileError) {
          // If profile fetch fails, the axios interceptor will handle 401s
          // For other errors, keep using stored data
          console.warn("Profile fetch failed, using stored user data");
        }
      }
    } catch (error) {
      // Only logout if we don't have any stored user data
      const storedUser = localStorage.getItem("user");
      const storedUserType = localStorage.getItem("userType");
      if (
        !storedUser ||
        !storedUserType ||
        storedUser === "undefined" ||
        storedUserType === "undefined"
      ) {
        await logout();
      } else {
        try {
          setUser(JSON.parse(storedUser));
          setUserType(storedUserType as UserType);
        } catch (parseError) {
          console.warn(
            "Failed to parse stored user data in catch block:",
            parseError
          );
          await logout();
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (
    credentials: LoginCredentials,
    type: UserType
  ): Promise<void> => {
    try {
      setIsLoading(true);

      let response;
      switch (type) {
        case "admin":
          response = await authService.adminLogin(credentials);
          break;
        case "teacher":
          response = await authService.teacherLogin(credentials);
          break;
        case "student":
          response = await authService.studentLogin(credentials);
          break;
        default:
          throw new Error("Invalid user type");
      }

      if (response.success && response.data) {
        setUser(response.data);
        setUserType(response.data.userType);
        localStorage.setItem("user", JSON.stringify(response.data));
        localStorage.setItem("userType", response.data.userType);
      } else {
        throw new Error(response.message || "Login failed");
      }
    } catch (error) {
      handleApiError(error, {
        displayType: ERROR_DISPLAY_TYPES.MESSAGE,
        customMessage: "Login failed. Please check your credentials.",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      // Try to logout on server based on user type
      if (userType === "admin") {
        await authService.adminLogout();
      } else if (userType === "teacher") {
        await authService.teacherLogout();
      } else if (userType === "student") {
        await authService.studentLogout();
      }
    } catch (error) {
      // Even if server logout fails, clear local state
      console.warn("Server logout failed:", error);
    } finally {
      // Clear local state
      setUser(null);
      setUserType(null);
      localStorage.removeItem("user");
      localStorage.removeItem("userType");

      // Reset any logout flags in the API client
      window.dispatchEvent(new CustomEvent("auth:manualLogout"));

      console.log("Logged out successfully");
    }
  };

  const updateUserVerification = (isVerified: boolean): void => {
    if (user) {
      const updatedUser = { ...user, isVerified };
      setUser(updatedUser as User);
      localStorage.setItem("user", JSON.stringify(updatedUser));
    }
  };

  // Get isVerified from user data (backend provides this)
  const isVerified =
    userType === "admin" ? true : (user as any)?.isVerified || false;

  const value: AuthContextType = {
    user,
    userType,
    isAuthenticated: !!user && !!userType,
    isVerified,
    isLoading,
    login,
    logout,
    updateUserVerification,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
