import { useState } from "react";
import { Outlet } from "react-router-dom";
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
import "./AppLayout.scss";

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
              menu={{ items: userMenuItems }}
              placement="bottomRight"
              arrow
              rootClassName="user-dropdown"
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
        </div>
      </Header>

      <Layout className="layout-content">
        {/* Sidebar with glassmorphism */}
        <Sider
          width={250}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          className="app-sider relative z-10 shadow-lg"
          style={{
            background: "rgba(255, 255, 255, 0.8)",
            backdropFilter: "blur(10px)",
            borderRight: "1px solid rgba(255, 255, 255, 0.3)",
          }}
        >
          <Menu
            mode="inline"
            defaultSelectedKeys={["1"]}
            className="border-r-0 bg-transparent"
            style={{ width: "100%" }}
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
