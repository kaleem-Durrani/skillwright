import { Outlet } from "react-router-dom";
import { Layout, Menu, Typography } from "antd";

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const AppLayout = () => {
  return (
    <Layout className="min-h-fit">
      {/* Sidebar */}
      <Sider width={250} theme="light" className="shadow-md">
        <div className="p-4">
          <Title level={4} className="!m-0">
            App Navigation
          </Title>
        </div>
        <Menu
          mode="inline"
          defaultSelectedKeys={["1"]}
          className="h-full border-r border-gray-200"
          items={[
            {
              key: "1",
              label: "Menu Item 1",
            },
            {
              key: "2",
              label: "Menu Item 2",
            },
          ]}
        />
      </Sider>

      <Layout>
        {/* Header */}
        <Header className="bg-white px-6 flex items-center shadow-sm">
          <Title level={4} className="!m-0 text-gray-800">
            App Header
          </Title>
        </Header>

        {/* Content */}
        <Content className="m-6 p-6 bg-white rounded-lg shadow-sm">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
