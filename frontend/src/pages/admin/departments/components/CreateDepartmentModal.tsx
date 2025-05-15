import React, { useEffect } from 'react';
import { Modal, Form, Input, Button } from 'antd';
import { Department } from '@/common/types';

const { TextArea } = Input;

interface CreateDepartmentModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: any) => void;
  isSubmitting: boolean;
  editingDepartment: Department | null;
  title?: string;
}

/**
 * Modal component for creating or editing a department
 */
const CreateDepartmentModal: React.FC<CreateDepartmentModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
  editingDepartment,
  title = 'Create New Department',
}) => {
  const [form] = Form.useForm();

  // Reset form when modal is opened/closed or editing department changes
  useEffect(() => {
    if (visible) {
      if (editingDepartment) {
        form.setFieldsValue({
          name: editingDepartment.name,
          description: editingDepartment.description,
        });
      } else {
        form.resetFields();
      }
    }
  }, [visible, form, editingDepartment]);

  const handleSubmit = (values: any) => {
    const submitData = editingDepartment 
      ? { ...values, id: editingDepartment.id } 
      : values;
    
    onSubmit(submitData);
  };

  return (
    <Modal
      title={editingDepartment ? 'Edit Department' : title}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="name"
          label="Department Name"
          rules={[
            { required: true, message: 'Please enter department name' },
            { min: 2, message: 'Name must be at least 2 characters' },
          ]}
        >
          <Input placeholder="Enter department name" />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
        >
          <TextArea
            placeholder="Enter department description"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            {editingDepartment ? 'Update Department' : 'Create Department'}
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateDepartmentModal;
