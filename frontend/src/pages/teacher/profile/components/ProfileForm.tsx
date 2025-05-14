import React, { useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Space } from 'antd';
import { Teacher } from '@/common/types';

const { Title } = Typography;
const { TextArea } = Input;

interface ProfileFormProps {
  teacher: Teacher;
  loading: boolean;
  onSubmit: (values: any) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

/**
 * Form component for editing teacher profile
 */
const ProfileForm: React.FC<ProfileFormProps> = ({
  teacher,
  loading,
  onSubmit,
  onCancel,
  isSubmitting,
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (teacher) {
      form.setFieldsValue({
        name: teacher.name,
        phoneNumber: teacher.phoneNumber,
        qualification: teacher.qualification,
        specialization: teacher.specialization,
      });
    }
  }, [teacher, form]);

  return (
    <Card loading={loading} className="shadow-sm">
      <Title level={4} className="mb-4">Edit Profile</Title>
      
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        initialValues={{
          name: teacher?.name,
          phoneNumber: teacher?.phoneNumber,
          qualification: teacher?.qualification,
          specialization: teacher?.specialization,
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
          name="qualification"
          label="Qualification"
          rules={[
            { required: true, message: 'Please enter your qualification' },
          ]}
        >
          <Input placeholder="Enter your qualification" />
        </Form.Item>

        <Form.Item
          name="specialization"
          label="Specialization"
        >
          <TextArea 
            placeholder="Enter your specialization" 
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
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
