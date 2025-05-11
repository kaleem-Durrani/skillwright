import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Layout,
  Menu,
  Typography,
  Button,
  Avatar,
  Dropdown,
  Divider,
} from "antd";
import type { MenuProps } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  BellOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { LogoutButton } from "@/components/common";
import { getMenuItemsByUserType } from "@/common/constants/menus";
import { getUserTypeFromPath } from "@/utils/routeUtils";
import "./AppLayout.scss";

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

const AppLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const navigate = useNavigate();
  const location = useLocation();

  // Get user data from localStorage
  const getUserData = () => {
    const userData = localStorage.getItem("user");
    return userData ? JSON.parse(userData) : null;
  };

  const user = getUserData();

  // Determine user type from path or localStorage
  const pathUserType = getUserTypeFromPath(location.pathname);
  const userType = pathUserType || user?.userType || "student"; // Default to student if no user type

  // Update selected key when location changes
  useEffect(() => {
    setSelectedKey(location.pathname);
  }, [location.pathname]);

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  // Handle menu item click
  const handleMenuClick: MenuProps["onClick"] = (e) => {
    navigate(e.key);
  };

  // Get menu items based on user type
  const menuItems = getMenuItemsByUserType(
    userType as "student" | "teacher" | "admin"
  );

  // User dropdown menu
  const userMenuItems: MenuProps["items"] = [
    {
      key: `/${userType}/profile`,
      icon: <UserOutlined />,
      label: "Profile",
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "Settings",
    },
    {
      type: "divider",
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: <LogoutButton type="text" icon={false} />,
    },
  ];

  return (
    <Layout className="app-layout">
      {/* Background gradient */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-50"></div>
      </div>

      {/* Header with glassmorphism */}
      <Header
        className="app-header"
        style={{
          background: "rgba(255, 255, 255, 0.8)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.3)",
        }}
      >
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
          className="sider-control-btn mr-4 text-blue-600"
        />
        <div className="app-inner-header flex h-full w-full justify-between">
          <div className="logo">
            <Title level={4} className="!m-0 text-blue-600">
              Millat Vocational
            </Title>
          </div>

          <div className="user-area flex items-center gap-4">
            {/* Notifications */}
            <Button
              type="text"
              icon={<BellOutlined />}
              className="text-gray-600"
            />

            <Divider type="vertical" />

            {/* User dropdown */}
            <Dropdown
              menu={{
                items: userMenuItems,
                onClick: (e) => {
                  if (e.key !== "logout" && e.key !== "settings") {
                    navigate(e.key);
                  }
                },
              }}
              placement="bottomRight"
              arrow
              rootClassName="user-dropdown"
            >
              <div className="flex items-center cursor-pointer">
                <Avatar icon={<UserOutlined />} className="bg-blue-500" />
                <div className="ml-2 hidden md:block">
                  <Text strong>{user?.name || "User"}</Text>
                  <Text className="block text-xs text-gray-500">
                    {userType.charAt(0).toUpperCase() + userType.slice(1)}
                  </Text>
                </div>
              </div>
            </Dropdown>
          </div>
        </div>
      </Header>

      <Layout className="layout-content">
        {/* Sidebar with glassmorphism */}
        <Sider
          width={200}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          className="app-sider relative z-10 shadow-lg bg-gradient-to-br from-blue-700 to-blue-300 "
          style={{
            backdropFilter: "blur(10px)",
            borderRight: "1px solid rgba(255, 255, 255, 0.3)",
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            onClick={handleMenuClick}
            className="border-r-0 bg-transparent"
            style={{ width: "100%" }}
            items={menuItems}
          />
        </Sider>

        {/* Content */}
        <Content className="app-content bg-white/10 backdrop-blur-sm rounded-lg shadow-sm z-10">
          <section className="content-section">
            <Outlet />
          </section>
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
