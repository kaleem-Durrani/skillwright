import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, Switch, Upload, Button } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useTeacherQuery } from '@/hooks';
import { ResourceCreateData } from '@/common/types';

const { Option } = Select;
const { TextArea } = Input;

interface CreateResourceModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: ResourceCreateData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for creating a new resource
 */
const CreateResourceModal: React.FC<CreateResourceModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();
  const { getMyCoursesQuery } = useTeacherQuery();
  const coursesQuery = getMyCoursesQuery();
  const courses = coursesQuery.data?.data?.data || [];

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleSubmit = (values: any) => {
    const formattedValues: ResourceCreateData = {
      ...values,
      isPublic: values.isPublic || false,
    };
    
    onSubmit(formattedValues);
  };

  const normFile = (e: any) => {
    if (Array.isArray(e)) {
      return e;
    }
    return e?.fileList;
  };

  return (
    <Modal
      title="Create New Resource"
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
          isPublic: false,
          type: 'DOCUMENT',
        }}
      >
        <Form.Item
          name="title"
          label="Resource Title"
          rules={[
            { required: true, message: 'Please enter resource title' },
            { min: 3, message: 'Title must be at least 3 characters' },
          ]}
        >
          <Input placeholder="Enter resource title" />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
        >
          <TextArea
            placeholder="Enter resource description"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>

        <Form.Item
          name="type"
          label="Resource Type"
          rules={[{ required: true, message: 'Please select resource type' }]}
        >
          <Select placeholder="Select resource type">
            <Option value="DOCUMENT">Document</Option>
            <Option value="VIDEO">Video</Option>
            <Option value="LINK">Link</Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="courseId"
          label="Course"
          rules={[{ required: true, message: 'Please select a course' }]}
        >
          <Select
            placeholder="Select course"
            loading={coursesQuery.isLoading}
          >
            {courses.map((course) => (
              <Option key={course.id} value={course.id}>
                {course.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="url"
          label="Resource URL"
          rules={[
            { required: true, message: 'Please enter resource URL' },
            { type: 'url', message: 'Please enter a valid URL' },
          ]}
        >
          <Input placeholder="Enter resource URL" />
        </Form.Item>

        <Form.Item
          name="isPublic"
          label="Make Public"
          valuePropName="checked"
          extra="Public resources are visible to all students"
        >
          <Switch />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            Create Resource
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateResourceModal;
