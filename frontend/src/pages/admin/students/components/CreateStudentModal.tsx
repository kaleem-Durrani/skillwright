import React, { useEffect } from "react";
import { Modal, Form, Input, Select, Button } from "antd";
import { useApi } from "@/hooks";
import { departmentService } from "@/services";
import { StudentCreateData } from "@/common/types";

const { Option } = Select;

interface CreateStudentModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: StudentCreateData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for creating a new student
 */
const CreateStudentModal: React.FC<CreateStudentModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();

  // API call for departments
  const departmentsQuery = useApi(
    () => departmentService.getDepartmentsForSelect(),
    { immediate: true }
  );

  const departments = departmentsQuery.data?.data || [];

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleSubmit = (values: StudentCreateData) => {
    onSubmit(values);
  };

  return (
    <Modal
      title="Create New Student"
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
            { required: true, message: "Please enter student name" },
            { min: 3, message: "Name must be at least 3 characters" },
          ]}
        >
          <Input placeholder="Enter student's full name" />
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
          name="enrollmentNo"
          label="Enrollment Number"
          rules={[
            { required: true, message: "Please enter enrollment number" },
          ]}
        >
          <Input placeholder="Enter enrollment number" />
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
            loading={departmentsQuery.loading}
          >
            {departments.map((dept) => (
              <Option key={dept.value} value={dept.value}>
                {dept.label}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="semester" label="Semester">
          <Input placeholder="Enter semester" />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            Create Student
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateStudentModal;
