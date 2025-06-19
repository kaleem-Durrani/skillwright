import React, { useEffect } from "react";
import { Modal, Form, Input, Select, Button } from "antd";
import { useDepartmentContext } from "@/context/DepartmentContext";
import { TeacherCreateData } from "@/common/types";

const { Option } = Select;

interface CreateTeacherModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: TeacherCreateData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for creating a new teacher
 */
const CreateTeacherModal: React.FC<CreateTeacherModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();
  const { departments, loading: departmentsLoading } = useDepartmentContext();

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleSubmit = (values: TeacherCreateData) => {
    onSubmit(values);
  };

  return (
    <Modal
      title="Create New Teacher"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={600}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="name"
          label="Full Name"
          rules={[
            { required: true, message: "Please enter teacher name" },
            { min: 3, message: "Name must be at least 3 characters" },
          ]}
        >
          <Input placeholder="Enter teacher's full name" />
        </Form.Item>

        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: "Please enter email" },
            { type: "email", message: "Please enter a valid email" },
          ]}
        >
          <Input placeholder="Enter email address" />
        </Form.Item>

        <Form.Item
          name="password"
          label="Password"
          rules={[
            { required: true, message: "Please enter password" },
            { min: 6, message: "Password must be at least 6 characters" },
          ]}
        >
          <Input.Password placeholder="Enter password" />
        </Form.Item>

        <Form.Item
          name="phoneNumber"
          label="Phone Number"
          rules={[
            {
              pattern: /^\+?[1-9]\d{1,14}$/,
              message: "Please enter a valid phone number",
            },
          ]}
        >
          <Input placeholder="Enter phone number" />
        </Form.Item>

        <Form.Item name="departmentId" label="Department">
          <Select
            placeholder="Select department"
            allowClear
            loading={departmentsLoading}
          >
            {departments.map((dept) => (
              <Option key={dept.id} value={dept.id}>
                {dept.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="qualification"
          label="Qualification"
          rules={[{ required: true, message: "Please enter qualification" }]}
        >
          <Input placeholder="Enter qualification" />
        </Form.Item>

        <Form.Item name="specialization" label="Specialization">
          <Input placeholder="Enter specialization" />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            Create Teacher
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateTeacherModal;
