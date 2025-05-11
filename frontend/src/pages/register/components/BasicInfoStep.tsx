import React from "react";
import { Form, Input, Radio } from "antd";
import { UserOutlined, MailOutlined } from "@ant-design/icons";

interface BasicInfoStepProps {
  handleUserTypeChange: (e: any) => void;
}

const BasicInfoStep: React.FC<BasicInfoStepProps> = ({
  handleUserTypeChange,
}) => {
  return (
    <>
      <Form.Item
        name="userType"
        initialValue="student"
        rules={[{ required: true, message: "Please select user type" }]}
      >
        <Radio.Group
          onChange={handleUserTypeChange}
          buttonStyle="solid"
          className="w-full flex mb-6"
        >
          <Radio.Button value="student" className="w-1/2 text-center">
            Student
          </Radio.Button>
          <Radio.Button value="teacher" className="w-1/2 text-center">
            Teacher
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      <Form.Item
        name="name"
        rules={[{ required: true, message: "Please enter your full name" }]}
      >
        <Input
          prefix={<UserOutlined className="site-form-item-icon" />}
          placeholder="Full Name"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="email"
        rules={[
          { required: true, message: "Please enter your email" },
          { type: "email", message: "Please enter a valid email address" },
        ]}
      >
        <Input
          prefix={<MailOutlined className="site-form-item-icon" />}
          placeholder="Email"
          size="large"
        />
      </Form.Item>
    </>
  );
};

export default BasicInfoStep;
