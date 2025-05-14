import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, InputNumber, Button } from 'antd';
import { useDepartmentQuery } from '@/hooks';
import { CourseCreateData } from '@/common/types';

const { Option } = Select;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

interface CreateCourseModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: CourseCreateData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for creating a new course
 */
const CreateCourseModal: React.FC<CreateCourseModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();
  const { getAllDepartmentsQuery } = useDepartmentQuery();
  const departmentsQuery = getAllDepartmentsQuery();
  const departments = departmentsQuery.data?.data?.data || [];

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleSubmit = (values: any) => {
    const { dateRange, ...rest } = values;
    
    const formattedValues: CourseCreateData = {
      ...rest,
      startDate: dateRange?.[0]?.toISOString(),
      endDate: dateRange?.[1]?.toISOString(),
    };
    
    onSubmit(formattedValues);
  };

  return (
    <Modal
      title="Create New Course"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={700}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          capacity: 30,
        }}
      >
        <Form.Item
          name="name"
          label="Course Name"
          rules={[
            { required: true, message: 'Please enter course name' },
            { min: 3, message: 'Course name must be at least 3 characters' },
          ]}
        >
          <Input placeholder="Enter course name" />
        </Form.Item>

        <Form.Item
          name="code"
          label="Course Code"
          rules={[
            { required: true, message: 'Please enter course code' },
            { pattern: /^[A-Z0-9-]+$/, message: 'Course code must contain only uppercase letters, numbers, and hyphens' },
          ]}
        >
          <Input placeholder="e.g. CS-101" />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
        >
          <TextArea
            placeholder="Enter course description"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>

        <Form.Item
          name="departmentId"
          label="Department"
          rules={[{ required: true, message: 'Please select a department' }]}
        >
          <Select
            placeholder="Select department"
            loading={departmentsQuery.isLoading}
          >
            {departments.map((dept) => (
              <Option key={dept.id} value={dept.id}>
                {dept.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="duration"
          label="Duration"
          rules={[{ required: true, message: 'Please enter course duration' }]}
        >
          <Input placeholder="e.g. 3 months, 1 semester" />
        </Form.Item>

        <Form.Item
          name="capacity"
          label="Capacity"
          rules={[{ required: true, message: 'Please enter course capacity' }]}
        >
          <InputNumber min={1} max={500} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="dateRange"
          label="Course Period"
        >
          <RangePicker style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="syllabus"
          label="Syllabus URL"
        >
          <Input placeholder="Enter syllabus URL" />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            Create Course
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateCourseModal;
