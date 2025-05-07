import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, notification } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { useAuthQuery } from '@/hooks';
import { ROUTES } from '@/common/constants';

interface LogoutButtonProps {
  className?: string;
  type?: 'link' | 'text' | 'default' | 'primary' | 'dashed';
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
  className = '',
  type = 'default',
  icon = true,
  text = true,
}) => {
  const navigate = useNavigate();
  const { 
    adminLogoutMutation, 
    teacherLogoutMutation, 
    studentLogoutMutation 
  } = useAuthQuery();

  // Get user data from localStorage
  const getUserData = () => {
    const userData = localStorage.getItem('user');
    return userData ? JSON.parse(userData) : null;
  };

  const handleLogout = async () => {
    try {
      const userData = getUserData();
      
      if (!userData) {
        // If no user data, just clear localStorage and redirect
        localStorage.removeItem('user');
        navigate(ROUTES.LOGIN);
        return;
      }

      // Call the appropriate logout mutation based on user type
      let response;
      switch (userData.userType) {
        case 'admin':
          response = await adminLogoutMutation.mutateAsync();
          break;
        case 'teacher':
          response = await teacherLogoutMutation.mutateAsync();
          break;
        case 'student':
          response = await studentLogoutMutation.mutateAsync();
          break;
        default:
          // If userType is not recognized, just clear localStorage and redirect
          localStorage.removeItem('user');
          navigate(ROUTES.LOGIN);
          return;
      }

      // Clear user data from localStorage
      localStorage.removeItem('user');

      // Show success notification
      notification.success({
        message: 'Logout Successful',
        description: 'You have been logged out successfully.',
      });

      // Redirect to login page
      navigate(ROUTES.LOGIN);
    } catch (error: any) {
      // Handle error
      notification.error({
        message: 'Logout Failed',
        description: error?.response?.data?.message || 'An error occurred during logout.',
      });
      
      // Even if the API call fails, clear localStorage and redirect
      localStorage.removeItem('user');
      navigate(ROUTES.LOGIN);
    }
  };

  return (
    <Button
      type={type}
      className={className}
      onClick={handleLogout}
      icon={icon ? <LogoutOutlined /> : undefined}
    >
      {text && 'Logout'}
    </Button>
  );
};

export default LogoutButton;
