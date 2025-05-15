import React, { useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Space } from 'antd';
import { Admin } from '@/common/types';

const { Title } = Typography;

interface ProfileFormProps {
  admin: Admin;
  loading: boolean;
  onSubmit: (values: any) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

/**
 * Form component for editing admin profile
 */
const ProfileForm: React.FC<ProfileFormProps> = ({
  admin,
  loading,
  onSubmit,
  onCancel,
  isSubmitting,
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (admin) {
      form.setFieldsValue({
        name: admin.name,
        phoneNumber: admin.phoneNumber,
        role: admin.role,
      });
    }
  }, [admin, form]);

  return (
    <Card loading={loading} className="shadow-sm">
      <Title level={4} className="mb-4">Edit Profile</Title>
      
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        initialValues={{
          name: admin?.name,
          phoneNumber: admin?.phoneNumber,
          role: admin?.role,
        }}
      >
        <Form.Item
          name="name"
          label="Full Name"
          rules={[
            { required: true, message: 'Please enter your name' },
            { min: 2, message: 'Name must be at least 2 characters' },
          ]}
        >
          <Input placeholder="Enter your full name" />
        </Form.Item>

        <Form.Item
          name="phoneNumber"
          label="Phone Number"
          rules={[
            { pattern: /^\+?[1-9]\d{1,14}$/, message: 'Please enter a valid phone number' },
          ]}
        >
          <Input placeholder="Enter your phone number" />
        </Form.Item>

        <Form.Item
          name="role"
          label="Role"
        >
          <Input placeholder="Enter your role" disabled />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={isSubmitting}
            >
              Save Changes
            </Button>
            <Button onClick={onCancel}>
              Cancel
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default ProfileForm;
