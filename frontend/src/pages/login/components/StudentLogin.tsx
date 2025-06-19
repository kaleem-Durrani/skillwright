import React from "react";
import { Form, Input, Button, Typography, Checkbox, Divider } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import LoginTypeSelector, { LoginType } from "./LoginTypeSelector";
import { useAuth } from "@/context/AuthContext";
import { LoginCredentials } from "@/common/types";

const { Title, Text } = Typography;

interface StudentLoginProps {
  className?: string;
  onTypeChange: (type: LoginType) => void;
}

const StudentLogin: React.FC<StudentLoginProps> = ({
  className = "",
  onTypeChange,
}) => {
  const navigate = useNavigate();
  const { login, isLoading, user } = useAuth();
  const [form] = Form.useForm();

  const onFinish = async (values: LoginCredentials) => {
    try {
      await login(values, "student");

      // Check if student is verified after login
      if (user && "isVerified" in user && user.isVerified) {
        navigate(ROUTES.STUDENT.DASHBOARD);
      } else {
        navigate(ROUTES.VERIFY_EMAIL);
      }
    } catch (error) {
      // Error handling is done in the AuthContext
      console.error("Login failed:", error);
    }
  };

  return (
    <div className={`p-6 flex flex-col ${className}`}>
      <div className="mb-6 glass-login-selector mx-auto">
        <LoginTypeSelector selectedType="student" onChange={onTypeChange} />
      </div>

      <Title level={2} className="mb-6 text-center text-blue-700">
        Student Login
      </Title>
      <Form
        form={form}
        name="student_login"
        initialValues={{ remember: true }}
        onFinish={onFinish}
        layout="vertical"
        size="large"
        className="max-w-md mx-auto w-full"
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
            placeholder="Email"
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
            loading={isLoading}
            className="w-full rounded-lg h-12 text-lg"
          >
            {isLoading ? "Logging in..." : "Log in"}
          </Button>
        </Form.Item>

        <Divider plain>
          <Text type="secondary">New to the platform?</Text>
        </Divider>

        <div className="text-center">
          <Link
            to={ROUTES.REGISTER}
            className="text-blue-600 hover:text-blue-800"
          >
            Register as a student
          </Link>
        </div>
      </Form>
    </div>
  );
};

export default StudentLogin;
