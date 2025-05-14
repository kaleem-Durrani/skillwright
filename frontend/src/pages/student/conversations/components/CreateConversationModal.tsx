import React from "react";
import { Modal, Form, Input, Select, Button } from "antd";
import { ConversationCreateData } from "@/common/types";

const { Option } = Select;

interface Teacher {
  id: string;
  name: string;
}

interface Admin {
  id: string;
  name: string;
}

interface CreateConversationModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreateConversation: (values: FormValues) => void;
  isPending: boolean;
  teachers: Teacher[];
  admins: Admin[];
}

interface FormValues {
  title: string;
  teacherId: string;
  adminId?: string;
}

/**
 * Modal component for creating a new conversation
 */
const CreateConversationModal: React.FC<CreateConversationModalProps> = ({
  visible,
  onCancel,
  onCreateConversation,
  isPending,
  teachers,
  admins,
}) => {
  const [form] = Form.useForm<FormValues>();

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      onCreateConversation(values);
    });
  };

  return (
    <Modal
      title="New Conversation"
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button
          key="create"
          type="primary"
          onClick={handleSubmit}
          loading={isPending}
        >
          Create
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="title"
          label="Conversation Title"
          rules={[{ required: true, message: "Please enter a title" }]}
        >
          <Input placeholder="Enter a title for this conversation" />
        </Form.Item>

        <Form.Item
          name="teacherId"
          label="Select Teacher"
          rules={[
            { required: true, message: "Please select at least one teacher" },
          ]}
        >
          <Select placeholder="Select a teacher">
            {teachers.map((teacher) => (
              <Option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="adminId" label="Include Administrator">
          <Select placeholder="Select an administrator (optional)">
            {admins.map((admin) => (
              <Option key={admin.id} value={admin.id}>
                {admin.name}
              </Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateConversationModal;
