import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
import { useAuth } from "@/context/AuthContext";
import { ROUTES } from "@/common/constants";

interface LogoutButtonProps {
  className?: string;
  type?: "link" | "text" | "default" | "primary" | "dashed";
  icon?: boolean;
  text?: boolean;
}

/**
 * LogoutButton component that handles user logout
 *
 * @param className - Additional CSS classes
 * @param type - Button type (default: 'default')
 * @param icon - Whether to show the logout icon (default: true)
 * @param text - Whether to show the text "Logout" (default: true)
 */
const LogoutButton: React.FC<LogoutButtonProps> = ({
  className = "",
  type = "default",
  icon = true,
  text = true,
}) => {
  const navigate = useNavigate();
  const { logout, isLoading } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate(ROUTES.LOGIN);
    } catch (error) {
      // Error handling is done in the AuthContext
      console.error("Logout failed:", error);
      // Even if logout fails, redirect to login
      navigate(ROUTES.LOGIN);
    }
  };

  return (
    <Button
      type={type}
      className={className}
      onClick={handleLogout}
      loading={isLoading}
      icon={icon ? <LogoutOutlined /> : undefined}
    >
      {text && "Logout"}
    </Button>
  );
};

export default LogoutButton;
