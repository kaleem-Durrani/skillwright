import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button } from 'antd';
import { useAdminQuery, useStudentQuery } from '@/hooks';
import { ConversationCreateData } from '@/common/types';

const { Option } = Select;
const { TextArea } = Input;

interface CreateConversationModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreateConversation: (values: FormValues) => void;
  isPending: boolean;
}

interface FormValues {
  title: string;
  participants: string[];
  initialMessage?: string;
}

/**
 * Modal component for creating a new conversation
 */
const CreateConversationModal: React.FC<CreateConversationModalProps> = ({
  visible,
  onCancel,
  onCreateConversation,
  isPending,
}) => {
  const [form] = Form.useForm();
  const { getStudentsQuery } = useAdminQuery();
  const studentsQuery = getStudentsQuery();
  const students = studentsQuery.data?.data?.data || [];
  
  const { getAdminsQuery } = useAdminQuery();
  const adminsQuery = getAdminsQuery();
  const admins = adminsQuery.data?.data?.data || [];

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleSubmit = (values: FormValues) => {
    onCreateConversation(values);
  };

  return (
    <Modal
      title="Start New Conversation"
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
          name="title"
          label="Conversation Title (Optional)"
        >
          <Input placeholder="Enter conversation title" />
        </Form.Item>

        <Form.Item
          name="participants"
          label="Select Participants"
          rules={[{ required: true, message: 'Please select at least one participant' }]}
        >
          <Select
            mode="multiple"
            placeholder="Select students or admins"
            loading={studentsQuery.isLoading || adminsQuery.isLoading}
            optionFilterProp="children"
          >
            <Select.OptGroup label="Students">
              {students.map((student) => (
                <Option key={`student-${student.id}`} value={`student-${student.id}`}>
                  {student.name} (Student)
                </Option>
              ))}
            </Select.OptGroup>
            <Select.OptGroup label="Admins">
              {admins.map((admin) => (
                <Option key={`admin-${admin.id}`} value={`admin-${admin.id}`}>
                  {admin.name} (Admin)
                </Option>
              ))}
            </Select.OptGroup>
          </Select>
        </Form.Item>

        <Form.Item
          name="initialMessage"
          label="Initial Message (Optional)"
        >
          <TextArea
            placeholder="Type your first message"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isPending}>
            Start Conversation
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateConversationModal;
