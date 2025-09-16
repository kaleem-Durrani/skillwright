// This is an example of a dashboard navigation component.
// It was made simply to represent the design of the navigation

import React, { useState } from "react";
import {
  Layout,
  Menu,
  Card,
  Row,
  Col,
  Badge,
  Avatar,
  Input,
  Dropdown,
  Space,
  Button,
  Breadcrumb,
  Typography,
  Statistic,
} from "antd";
import {
  BookOutlined,
  FileOutlined,
  UserOutlined,
  BellOutlined,
  SearchOutlined,
  MessageOutlined,
  CalendarOutlined,
  TeamOutlined,
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const { Search } = Input;

interface SectionCardProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  description: string;
  color: string;
  onClick: () => void;
}

const SectionCard: React.FC<SectionCardProps> = ({
  title,
  icon,
  count,
  description,
  color,
  onClick,
}) => (
  <Card
    hoverable
    style={{
      borderTop: `4px solid ${color}`,
      height: "100%",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.09)",
    }}
    onClick={onClick}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <div>
        <Title level={4} style={{ marginTop: 0 }}>
          {title}
        </Title>
        <Text type="secondary">{description}</Text>
      </div>
      <Avatar
        size={48}
        style={{
          backgroundColor: color,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {icon}
      </Avatar>
    </div>
    <Statistic
      value={count}
      valueStyle={{ color: color, fontSize: "24px", marginTop: "16px" }}
      suffix={count === 1 ? "item" : "items"}
    />
  </Card>
);

const DashboardNavigation: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  const handleSectionClick = (section: string) => {
    setSelectedSection(section);
  };

  const userMenu = (
    <Menu>
      <Menu.Item key="profile" icon={<UserOutlined />}>
        Profile
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item key="logout" icon={<LogoutOutlined />}>
        Logout
      </Menu.Item>
    </Menu>
  );

  const notificationsMenu = (
    <Menu>
      <Menu.Item key="notification1">
        <Text strong>New course available</Text>
        <br />
        <Text type="secondary">Web Development Fundamentals</Text>
      </Menu.Item>
      <Menu.Item key="notification2">
        <Text strong>Assignment due soon</Text>
        <br />
        <Text type="secondary">JavaScript Basics - Due in 2 days</Text>
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item key="viewAll">
        <Button type="link" block>
          View all notifications
        </Button>
      </Menu.Item>
    </Menu>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Top Navigation Bar */}
      <Header
        style={{
          padding: "0 24px",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ marginRight: "16px" }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleSidebar}
              style={{ fontSize: "16px" }}
            />
          </div>
          <Title level={4} style={{ margin: 0 }}>
            Millat Vocational Training
          </Title>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <Search
            placeholder="Search..."
            style={{ width: 250, marginRight: 16 }}
            prefix={<SearchOutlined />}
          />

          <Dropdown
            overlay={userMenu}
            trigger={["click"]}
            placement="bottomRight"
          >
            <Space style={{ cursor: "pointer" }}>
              <Avatar icon={<UserOutlined />} />
              <span>John Doe</span>
            </Space>
          </Dropdown>
        </div>
      </Header>

      <Layout>
        {/* Sidebar - Only visible when a section is selected */}
        {selectedSection && (
          <Sider
            width={250}
            collapsible
            collapsed={collapsed}
            trigger={null}
            style={{
              background: "#fff",
              boxShadow: "2px 0 8px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                padding: "24px 16px",
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              <Title
                level={4}
                style={{ margin: 0, textTransform: "capitalize" }}
              >
                {collapsed ? "" : selectedSection}
              </Title>
            </div>
            <Menu
              mode="inline"
              defaultSelectedKeys={["1"]}
              style={{ borderRight: 0 }}
            >
              {selectedSection === "courses" && (
                <>
                  <Menu.Item key="1" icon={<BookOutlined />}>
                    All Courses
                  </Menu.Item>
                  <Menu.Item key="2" icon={<FileOutlined />}>
                    My Enrollments
                  </Menu.Item>
                  <Menu.Item key="3" icon={<CalendarOutlined />}>
                    Course Schedule
                  </Menu.Item>
                </>
              )}

              {selectedSection === "resources" && (
                <>
                  <Menu.Item key="1" icon={<FileOutlined />}>
                    Documents
                  </Menu.Item>
                  <Menu.Item key="2" icon={<FileOutlined />}>
                    Videos
                  </Menu.Item>
                  <Menu.Item key="3" icon={<FileOutlined />}>
                    Links
                  </Menu.Item>
                </>
              )}

              {selectedSection === "profile" && (
                <>
                  <Menu.Item key="1" icon={<UserOutlined />}>
                    Personal Info
                  </Menu.Item>
                  <Menu.Item key="2" icon={<FileOutlined />}>
                    Academic Records
                  </Menu.Item>
                  <Menu.Item key="3" icon={<SettingOutlined />}>
                    Account Settings
                  </Menu.Item>
                </>
              )}

              {selectedSection === "messages" && (
                <>
                  <Menu.Item key="1" icon={<MessageOutlined />}>
                    Inbox
                  </Menu.Item>
                  <Menu.Item key="2" icon={<TeamOutlined />}>
                    Group Chats
                  </Menu.Item>
                  <Menu.Item key="3" icon={<UserOutlined />}>
                    Contacts
                  </Menu.Item>
                </>
              )}
            </Menu>
          </Sider>
        )}

        <Layout style={{ padding: "24px" }}>
          {/* Breadcrumb navigation */}
          {selectedSection ? (
            <Breadcrumb style={{ marginBottom: "16px" }}>
              <Breadcrumb.Item>
                <Link to="/" onClick={() => setSelectedSection(null)}>
                  Home
                </Link>
              </Breadcrumb.Item>
              <Breadcrumb.Item>{selectedSection}</Breadcrumb.Item>
            </Breadcrumb>
          ) : (
            <Title level={2}>Dashboard</Title>
          )}

          <Content
            style={{
              background: "#fff",
              padding: 24,
              margin: 0,
              borderRadius: 8,
              minHeight: 280,
            }}
          >
            {selectedSection ? (
              <div>
                <Title level={3} style={{ marginTop: 0 }}>
                  {selectedSection === "courses" && "Available Courses"}
                  {selectedSection === "resources" && "Learning Resources"}
                  {selectedSection === "profile" && "Your Profile"}
                  {selectedSection === "messages" && "Messages"}
                </Title>
                <Text>
                  Content for {selectedSection} will be displayed here.
                </Text>
              </div>
            ) : (
              /* Dashboard Cards */
              <Row gutter={[24, 24]}>
                <Col xs={24} sm={12} lg={6}>
                  <SectionCard
                    title="Courses"
                    icon={<BookOutlined />}
                    count={12}
                    description="Available courses"
                    color="#1890ff"
                    onClick={() => handleSectionClick("courses")}
                  />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <SectionCard
                    title="Resources"
                    icon={<FileOutlined />}
                    count={48}
                    description="Learning materials"
                    color="#52c41a"
                    onClick={() => handleSectionClick("resources")}
                  />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <SectionCard
                    title="Profile"
                    icon={<UserOutlined />}
                    count={1}
                    description="Your information"
                    color="#722ed1"
                    onClick={() => handleSectionClick("profile")}
                  />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <SectionCard
                    title="Messages"
                    icon={<MessageOutlined />}
                    count={5}
                    description="Unread messages"
                    color="#fa8c16"
                    onClick={() => handleSectionClick("messages")}
                  />
                </Col>

                {/* Second row with additional cards */}
                <Col xs={24} sm={12} lg={8}>
                  <Card
                    title="Upcoming Events"
                    extra={<a href="#">View All</a>}
                    style={{ height: "100%", borderRadius: "8px" }}
                  >
                    <div style={{ marginBottom: "12px" }}>
                      <Text strong>Web Development Workshop</Text>
                      <br />
                      <Text type="secondary">Tomorrow, 10:00 AM</Text>
                    </div>
                    <div>
                      <Text strong>JavaScript Fundamentals Exam</Text>
                      <br />
                      <Text type="secondary">Friday, 2:00 PM</Text>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={8}>
                  <Card
                    title="Recent Announcements"
                    extra={<a href="#">View All</a>}
                    style={{ height: "100%", borderRadius: "8px" }}
                  >
                    <div style={{ marginBottom: "12px" }}>
                      <Text strong>
                        New Course Added: Mobile App Development
                      </Text>
                      <br />
                      <Text type="secondary">2 days ago</Text>
                    </div>
                    <div>
                      <Text strong>Holiday Notice: Independence Day</Text>
                      <br />
                      <Text type="secondary">1 week ago</Text>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} lg={8}>
                  <Card
                    title="Your Progress"
                    style={{ height: "100%", borderRadius: "8px" }}
                  >
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Statistic
                          title="Courses Enrolled"
                          value={3}
                          valueStyle={{ color: "#1890ff" }}
                        />
                      </Col>
                      <Col span={12}>
                        <Statistic
                          title="Completed"
                          value={1}
                          valueStyle={{ color: "#52c41a" }}
                        />
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            )}
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
};

export default DashboardNavigation;
