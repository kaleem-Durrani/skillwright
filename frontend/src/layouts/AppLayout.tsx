import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Layout, Menu, Typography, Button, Avatar, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  BellOutlined,
  SettingOutlined,
} from "@ant-design/icons";

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

const AppLayout = () => {
  const [collapsed, setCollapsed] = useState(false);

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  // User dropdown menu
  const userMenuItems: MenuProps["items"] = [
    {
      key: "profile",
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
      label: "Logout",
    },
  ];

  return (
    <Layout className="min-h-screen">
      {/* Background gradient */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-50"></div>
      </div>

      {/* Sidebar with glassmorphism */}
      <Sider
        width={250}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        className="relative z-10 shadow-lg overflow-hidden"
        style={{
          background: "rgba(255, 255, 255, 0.8)",
          backdropFilter: "blur(10px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.3)",
        }}
      >
        <div className="p-4 flex items-center justify-center border-b border-gray-100">
          <Title level={4} className="!m-0 text-blue-600">
            {collapsed ? "MVT" : "Millat Vocational"}
          </Title>
        </div>
        <Menu
          mode="inline"
          defaultSelectedKeys={["1"]}
          className="border-r-0 bg-transparent"
          items={[
            {
              key: "1",
              icon: <UserOutlined />,
              label: "Dashboard",
            },
            {
              key: "2",
              icon: <UserOutlined />,
              label: "Courses",
            },
            {
              key: "3",
              icon: <UserOutlined />,
              label: "Resources",
            },
            {
              key: "4",
              icon: <UserOutlined />,
              label: "Profile",
            },
          ]}
        />
      </Sider>

      <Layout>
        {/* Header with glassmorphism */}
        <Header
          className="px-6 flex items-center justify-between z-10"
          style={{
            background: "rgba(255, 255, 255, 0.8)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.3)",
          }}
        >
          <div className="flex items-center">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleSidebar}
              className="mr-4 text-blue-600"
            />
            <Title level={4} className="!m-0 text-gray-800">
              Dashboard
            </Title>
          </div>

          <div className="flex items-center gap-4">
            {/* Notifications */}
            <Button
              type="text"
              icon={<BellOutlined />}
              className="text-gray-600"
            />

            {/* User dropdown */}
            <Dropdown
              menu={{ items: userMenuItems }}
              placement="bottomRight"
              arrow
            >
              <div className="flex items-center cursor-pointer">
                <Avatar icon={<UserOutlined />} className="bg-blue-500" />
                <div className="ml-2 hidden md:block">
                  <Text strong>John Doe</Text>
                  <Text className="block text-xs text-gray-500">Admin</Text>
                </div>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* Content */}
        <Content className="m-6 p-6 bg-white/70 backdrop-blur-sm rounded-lg shadow-sm relative z-10">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
