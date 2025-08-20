import React, { useState, useEffect } from "react";
import { Modal, Select, Form, message, Spin } from "antd";
import { UserOutlined } from "@ant-design/icons";
import {
  ConversationListItem,
  conversationService,
  Contact,
} from "@/services/conversationService";

interface NewConversationModalProps {
  open: boolean;
  onCancel: () => void;
  onConversationCreated: (conversation: ConversationListItem) => void;
}

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
  open,
  onCancel,
  onConversationCreated,
}) => {
  const [form] = Form.useForm();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      loadContacts();
    }
  }, [open]);

  const loadContacts = async () => {
    try {
      setLoading(true);
      const response = await conversationService.student.getContacts();
      
      if (response.success && response.data) {
        setContacts(response.data);
      }
    } catch (error) {
      message.error("Failed to load teachers");
      console.error("Error loading contacts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: { participantId: string }) => {
    try {
      setCreating(true);
      const response = await conversationService.student.createConversation({
        participantId: values.participantId,
      });

      if (response.success && response.data) {
        // Find the selected contact to get participant info
        const selectedContact = contacts.find(
          (contact) => contact.id === values.participantId
        );

        if (selectedContact) {
          const newConversation: ConversationListItem = {
            id: response.data.id,
            participant: {
              id: selectedContact.id,
              name: selectedContact.name,
              email: selectedContact.email,
            },
            lastMessage: null,
            unreadCount: 0,
            createdAt: response.data.createdAt,
            updatedAt: response.data.updatedAt,
          };

          onConversationCreated(newConversation);
          form.resetFields();
          message.success("Conversation created successfully");
        }
      }
    } catch (error: any) {
      message.error(
        error.response?.data?.message || "Failed to create conversation"
      );
      console.error("Error creating conversation:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title="Start New Conversation"
      open={open}
      onCancel={handleCancel}
      onOk={() => form.submit()}
      confirmLoading={creating}
      okText="Start Conversation"
      cancelText="Cancel"
    >
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="participantId"
          label="Select Teacher"
          rules={[{ required: true, message: "Please select a teacher" }]}
        >
          <Select
            placeholder="Choose a teacher to message"
            loading={loading}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
            }
            options={contacts.map((contact) => ({
              value: contact.id,
              label: (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <UserOutlined style={{ marginRight: 8, color: "#25d366" }} />
                  <div>
                    <div style={{ fontWeight: 500 }}>{contact.name}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {contact.email}
                    </div>
                  </div>
                </div>
              ),
            }))}
          />
        </Form.Item>
      </Form>

      {loading && (
        <div style={{ textAlign: "center", padding: "20px" }}>
          <Spin size="large" />
          <div style={{ marginTop: 8, color: "#666" }}>Loading teachers...</div>
        </div>
      )}
    </Modal>
  );
};
