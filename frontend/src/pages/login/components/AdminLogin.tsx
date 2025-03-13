import React from "react";
import { Form, Input, Button, Typography, Checkbox } from "antd";
import { UserOutlined, LockOutlined, SafetyOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { ROUTES } from "@/common/constants";

const { Title, Text } = Typography;

interface AdminLoginProps {
  className?: string;
}

const AdminLogin: React.FC<AdminLoginProps> = ({ className = "" }) => {
  const onFinish = (values: any) => {
    console.log("Admin login values:", values);
    // Handle admin login logic here
  };

  return (
    <div className={`p-8 ${className}`}>
      <Title level={2} className="mb-6 text-center">
        Administrator Login
      </Title>

      <div className="flex justify-center mb-6">
        <SafetyOutlined className="text-5xl text-blue-600" />
      </div>

      <Text className="block text-center mb-6 text-gray-600">
        This area is restricted to authorized administrators only.
      </Text>

      <Form
        name="admin_login"
        initialValues={{ remember: true }}
        onFinish={onFinish}
        layout="vertical"
        size="large"
        className="max-w-md mx-auto"
      >
        <Form.Item
          name="email"
          rules={[
            { required: true, message: "Please enter your email!" },
            { type: "email", message: "Please enter a valid email!" },
          ]}
        >
          <Input
            prefix={<UserOutlined className="text-gray-400" />}
            placeholder="Admin Email"
            className="rounded-lg py-2"
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[{ required: true, message: "Please enter your password!" }]}
        >
          <Input.Password
            prefix={<LockOutlined className="text-gray-400" />}
            placeholder="Password"
            className="rounded-lg py-2"
          />
        </Form.Item>

        <Form.Item>
          <div className="flex justify-between items-center">
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>Remember me</Checkbox>
            </Form.Item>
            <Link
              to={ROUTES.FORGOT_PASSWORD}
              className="text-blue-600 hover:text-blue-800"
            >
              Forgot password?
            </Link>
          </div>
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            className="w-full rounded-lg h-12 text-lg"
          >
            Log in
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default AdminLogin;
