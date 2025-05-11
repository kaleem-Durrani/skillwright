import React, { useState } from 'react';
import { Modal, Form, Select, Input, Button, message } from 'antd';
import { UserWithRole } from '@/common/types';

const { Option } = Select;
const { TextArea } = Input;

interface NewConversationModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreateConversation: (recipientId: string, initialMessage: string) => void;
  isLoading: boolean;
  recipients: UserWithRole[];
}

/**
 * New conversation modal component for creating a new conversation
 */
const NewConversationModal: React.FC<NewConversationModalProps> = ({
  visible,
  onCancel,
  onCreateConversation,
  isLoading,
  recipients,
}) => {
  const [form] = Form.useForm();
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);

  const handleSubmit = () => {
    form.validateFields()
      .then((values) => {
        if (selectedRecipient) {
          onCreateConversation(selectedRecipient, values.message);
          form.resetFields();
          setSelectedRecipient(null);
        } else {
          message.error('Please select a recipient');
        }
      })
      .catch((error) => {
        console.error('Validation failed:', error);
      });
  };

  const handleCancel = () => {
    form.resetFields();
    setSelectedRecipient(null);
    onCancel();
  };

  // Group recipients by role
  const teacherRecipients = recipients.filter(user => user.role === 'TEACHER');
  const adminRecipients = recipients.filter(user => user.role === 'ADMIN');

  return (
    <Modal
      title="New Conversation"
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={isLoading}
          onClick={handleSubmit}
          disabled={!selectedRecipient}
        >
          Start Conversation
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="recipient"
          label="Recipient"
          rules={[{ required: true, message: 'Please select a recipient' }]}
        >
          <Select
            placeholder="Select a recipient"
            onChange={(value) => setSelectedRecipient(value)}
            showSearch
            filterOption={(input, option) =>
              (option?.children as unknown as string)
                .toLowerCase()
                .indexOf(input.toLowerCase()) >= 0
            }
          >
            {teacherRecipients.length > 0 && (
              <Select.OptGroup label="Teachers">
                {teacherRecipients.map((user) => (
                  <Option key={user.id} value={user.id}>
                    {user.name}
                  </Option>
                ))}
              </Select.OptGroup>
            )}
            
            {adminRecipients.length > 0 && (
              <Select.OptGroup label="Administrators">
                {adminRecipients.map((user) => (
                  <Option key={user.id} value={user.id}>
                    {user.name}
                  </Option>
                ))}
              </Select.OptGroup>
            )}
          </Select>
        </Form.Item>
        
        <Form.Item
          name="message"
          label="Message"
          rules={[{ required: true, message: 'Please enter a message' }]}
        >
          <TextArea
            placeholder="Type your message here..."
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default NewConversationModal;
