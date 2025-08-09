import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Layout, Menu, Button, Typography } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { AUTH_MENU } from "@/common/constants/navigation";

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

const AuthLayout = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Function to handle smooth scrolling for hash links
  const handleNavClick = (path: string) => {
    setIsMenuOpen(false);

    // If it's the home link, navigate to home and scroll to top
    if (path === "/") {
      navigate("/");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // If it's a hash link
    if (path.startsWith("#")) {
      const targetId = path.substring(1);

      // If we're not on the home page, navigate to home first
      if (location.pathname !== "/") {
        navigate("/");
        // Wait for navigation to complete before scrolling
        setTimeout(() => {
          const element = document.getElementById(targetId);
          if (element) {
            element.scrollIntoView({ behavior: "smooth" });
          }
        }, 100);
      } else {
        // We're already on the home page, just scroll
        const element = document.getElementById(targetId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }
      return;
    }

    // Regular navigation for other links
    navigate(path);
  };

  // Create menu items from AUTH_MENU
  const menuItems = AUTH_MENU.map((item) => ({
    key: item.path,
    label: item.label,
    onClick: () => handleNavClick(item.path),
  }));

  // Close mobile menu on resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 640) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Handle scroll events to change header appearance
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <style>{`
        /* Target menu items specifically with high specificity */
        .ant-menu.ant-menu-horizontal .ant-menu-item,
        .ant-menu.ant-menu-vertical .ant-menu-item {
          color: #000 !important; /* Gold/yellow color */
          text-shadow: 2px 2px 4px rgba(255, 255, 255, 0.8) !important;
          font-weight: 900 !important;
          font-size: 1.2rem !important;
        }

        .ant-menu.ant-menu-horizontal .ant-menu-item:hover,
        .ant-menu.ant-menu-vertical .ant-menu-item:hover {
          color: #000 !important; /* Lighter yellow on hover */
          // text-shadow: 3px 3px 6px rgba(0, 0, 0, 0.9) !important;
        }

        .ant-menu.ant-menu-horizontal .ant-menu-item-selected,
        .ant-menu.ant-menu-vertical .ant-menu-item-selected {
          color: #000 !important; /* White for selected */
          // text-shadow: 2px 2px 4px rgba(0, 0, 0, 1) !important;
          background-color: rgba(255, 255, 255, 0.1) !important;
        }

        /* Target the text inside menu items */
        .ant-menu.ant-menu-horizontal .ant-menu-item span,
        .ant-menu.ant-menu-vertical .ant-menu-item span {
          color: inherit !important;
          text-shadow: inherit !important;
        }
      `}</style>

      <Layout className=" ">
        {/* Background Image */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-purple-700"></div>
          <div
            className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?q=80&w=2070')] bg-cover bg-center opacity-30"
            style={{ filter: "blur(1px)" }}
          ></div>
        </div>

        {/* Header with Glassmorphism */}
        <Header
          className={`site-header flex items-center justify-between px-4 z-50 transition-all duration-300 ${
            scrolled ? "bg-blue-600/90" : "bg-blue-600/50"
          } backdrop-blur-md border-b border-white/20`}
        >
          <div className="flex items-center">
            <Title
              level={3}
              className="!m-0 text-white cursor-pointer"
              onClick={() => handleNavClick("/")}
            >
              Millat Vocational
            </Title>
          </div>

          {/* Desktop Menu */}
          <Menu
            mode="horizontal"
            selectedKeys={[
              location.pathname === "/"
                ? location.hash || "/"
                : location.pathname,
            ]}
            className="hidden sm:flex bg-transparent border-0"
            items={menuItems}
            style={{
              backgroundColor: "transparent",
              minWidth: "auto",
            }}
            theme="dark"
            disabledOverflow={true}
          />

          {/* Mobile Menu Toggle */}
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="sm:hidden text-white"
          />
        </Header>

        {/* Mobile Menu Dropdown with Glassmorphism */}
        {isMenuOpen && (
          <Menu
            mode="vertical"
            selectedKeys={[
              location.pathname === "/"
                ? location.hash || "/"
                : location.pathname,
            ]}
            className="sm:hidden mt-16 backdrop-blur-md bg-blue-600/80 border-b border-white/20 shadow-lg z-40"
            items={menuItems}
            style={{
              backgroundColor: "transparent",
            }}
            theme="dark"
            onClick={() => setIsMenuOpen(false)}
            disabledOverflow={true}
          />
        )}

        {/* Main Content */}
        <Content className="site-content h-full relative z-10">
          <Outlet />
        </Content>

        {/* Footer with Glassmorphism */}
        <Footer className="justify-center flex backdrop-blur-md bg-blue-600/50 text-white border-t border-white/20 z-10">
          © {new Date().getFullYear()} Millat Vocational Training. All rights
          reserved.
        </Footer>
      </Layout>
    </>
  );
};

export default AuthLayout;
