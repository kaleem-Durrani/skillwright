import React from "react";
import { Form, Input, Button, Typography, Checkbox, Divider } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { ROUTES } from "@/common/constants";

const { Title, Text } = Typography;

interface TeacherLoginProps {
  className?: string;
}

const TeacherLogin: React.FC<TeacherLoginProps> = ({ className = "" }) => {
  const onFinish = (values: any) => {
    console.log("Teacher login values:", values);
    // Handle teacher login logic here
  };

  return (
    <div className={`p-8 ${className}`}>
      <Title level={2} className="mb-6 text-center">
        Teacher Login
      </Title>

      <Form
        name="teacher_login"
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
            className="w-full rounded-lg h-12 text-lg"
          >
            Log in
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
            Register as a teacher
          </Link>
        </div>
      </Form>
    </div>
  );
};

export default TeacherLogin;
