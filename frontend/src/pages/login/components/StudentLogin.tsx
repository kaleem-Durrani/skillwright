import React from "react";
import { Form, Input, Button, Typography, Checkbox, Divider, App } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import LoginTypeSelector, { LoginType } from "./LoginTypeSelector";
import { useAuthQuery } from "@/hooks";
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
  const { studentLoginMutation } = useAuthQuery();
  const [form] = Form.useForm();
  const { notification } = App.useApp();

  const onFinish = async (values: LoginCredentials) => {
    // Ant Design's Form component already prevents the default form submission behavior
    // No need for e.preventDefault() here
    try {
      const response = await studentLoginMutation.mutateAsync(values);

      // Check if the response was successful
      if (response?.data?.success) {
        // Store user data in localStorage
        const userData = response.data.data;
        if (!userData) {
          throw new Error("No user data received");
        }

        localStorage.setItem("user", JSON.stringify(userData));

        // Show success notification
        notification.success({
          message: "Login Successful",
          description: "Welcome back to the platform!",
        });

        // Redirect based on verification status
        // Use type assertion to help TypeScript understand the structure
        const user = userData as unknown as {
          isVerified?: boolean;
        };

        if (user.isVerified) {
          navigate(ROUTES.STUDENT.DASHBOARD);
        } else {
          navigate(ROUTES.VERIFY_EMAIL);
        }
      } else {
        // Handle unsuccessful response
        notification.error({
          message: "Login Failed",
          description: response?.data?.message || "Login was unsuccessful",
        });
      }
    } catch (error: any) {
      // Handle error
      console.error("Login error:", error);

      // Extract the error message from the response
      let errorMessage = "Please check your credentials and try again";

      if (error?.response?.data?.message) {
        // Use the error message from the API response
        errorMessage = error.response.data.message;
      } else if (error?.message) {
        // Use the error message from the Error object
        errorMessage = error.message;
      }

      notification.error({
        message: "Login Failed",
        description: errorMessage,
      });
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
            loading={studentLoginMutation.isPending}
            className="w-full rounded-lg h-12 text-lg"
          >
            {studentLoginMutation.isPending ? "Logging in..." : "Log in"}
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
