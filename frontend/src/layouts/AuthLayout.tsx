import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Layout, Menu, Button, Typography } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { AUTH_MENU } from "@/common/constants/navigation";

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

const AuthLayout = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  const menuItems = AUTH_MENU.map((item) => ({
    key: item.path,
    label: <Link to={item.path}>{item.label}</Link>,
  }));

  return (
    <Layout className="min-h-[calc(100vh-4  0px)]">
      <Header className="flex items-center justify-between px-4 bg-white shadow-sm">
        {/* Logo and Brand */}
        <Link to="/" className="flex items-center">
          <Title level={4} className="!m-0 text-blue-600">
            MVT
          </Title>
          <Title level={4} className="hidden sm:block ml-2 !m-0 text-gray-800">
            Millat Vocational Training
          </Title>
        </Link>

        {/* Desktop Menu */}
        <Menu
          mode="horizontal"
          selectedKeys={[location.pathname]}
          className="hidden sm:flex flex-1 justify-end border-0 bg-transparent"
          items={menuItems}
        />

        {/* Mobile Menu Button */}
        <Button
          type="text"
          icon={<MenuOutlined />}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="sm:hidden"
        />
      </Header>

      {/* Mobile Menu Dropdown */}
      {isMenuOpen && (
        <Menu
          mode="vertical"
          selectedKeys={[location.pathname]}
          className="sm:hidden mt-16 shadow-md"
          items={menuItems}
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <Content className="">
        {/* <div className="mx-auto py-8"> */}
        <Outlet />
        {/* </div> */}
      </Content>

      {/* Footer */}
      <Footer className="justify-center flex">
        © {new Date().getFullYear()} Millat Vocational Training. All rights
        reserved.
      </Footer>
    </Layout>
  );
};

export default AuthLayout;
