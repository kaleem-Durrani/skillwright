import React, { useState, useEffect } from "react";
import {
  Modal,
  Select,
  Button,
  message,
  Typography,
  Avatar,
  Empty,
} from "antd";
import { UserOutlined, SearchOutlined } from "@ant-design/icons";
import {
  conversationService,
  Contact,
  ConversationListItem,
} from "../../../../services/conversationService";

const { Text } = Typography;
const { Option } = Select;

interface NewConversationModalProps {
  open: boolean;
  onClose: () => void;
  onConversationCreated: (conversation: ConversationListItem) => void;
}

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
  open,
  onClose,
  onConversationCreated,
}) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Load contacts when modal opens
  useEffect(() => {
    if (open) {
      loadContacts();
      setSelectedContact(null);
    }
  }, [open]);

  const loadContacts = async () => {
    try {
      setLoading(true);
      const response = await conversationService.teacher.getContacts();

      if (response.success && response.data) {
        setContacts(response.data);
      }
    } catch (error) {
      message.error("Failed to load students");
      console.error("Error loading contacts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConversation = async () => {
    if (!selectedContact) {
      message.warning("Please select a student");
      return;
    }

    try {
      setCreating(true);
      const response = await conversationService.teacher.createConversation({
        participantId: selectedContact,
      });

      if (response.success && response.data) {
        const selectedContactData = contacts.find(
          (c) => c.id === selectedContact
        );

        if (selectedContactData) {
          const newConversation: ConversationListItem = {
            id: response.data.id,
            participant: {
              id: selectedContactData.id,
              name: selectedContactData.name,
              email: selectedContactData.email,
            },
            lastMessage: null,
            unreadCount: 0,
            createdAt: response.data.createdAt,
            updatedAt: response.data.updatedAt,
          };

          onConversationCreated(newConversation);
          message.success(
            `Conversation started with ${selectedContactData.name}`
          );
        }
      }
    } catch (error: any) {
      // Check if it's a "conversation already exists" error
      if (
        error?.response?.status === 409 ||
        error?.response?.data?.message?.includes("already exists")
      ) {
        message.info("Conversation already exists with this student");
      } else {
        message.error("Failed to create conversation");
      }
      console.error("Error creating conversation:", error);
    } finally {
      setCreating(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const filterOption = (input: string, option: any) => {
    const contact = contacts.find((c) => c.id === option.value);
    if (!contact) return false;

    return (
      contact.name.toLowerCase().includes(input.toLowerCase()) ||
      contact.email.toLowerCase().includes(input.toLowerCase()) ||
      contact.enrollmentNo?.toLowerCase().includes(input.toLowerCase()) ||
      contact.department.name.toLowerCase().includes(input.toLowerCase())
    );
  };

  return (
    <Modal
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UserOutlined style={{ color: "#25d366" }} />
          <span>Start New Conversation</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="create"
          type="primary"
          loading={creating}
          disabled={!selectedContact}
          onClick={handleCreateConversation}
          style={{ background: "#25d366", borderColor: "#25d366" }}
        >
          Start Conversation
        </Button>,
      ]}
      width={500}
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          Select a student from your courses to start a conversation
        </Text>
      </div>

      <Select
        placeholder="Search and select a student..."
        style={{ width: "100%" }}
        size="large"
        loading={loading}
        value={selectedContact}
        onChange={setSelectedContact}
        showSearch
        filterOption={filterOption}
        suffixIcon={<SearchOutlined />}
        optionLabelProp="label"
        notFoundContent={
          loading ? (
            <div style={{ textAlign: "center", padding: 20 }}>
              Loading students...
            </div>
          ) : contacts.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No students found in your courses"
            />
          ) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              No students match your search
            </div>
          )
        }
      >
        {contacts.map((contact) => (
          <Option key={contact.id} value={contact.id} label={contact.name}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar
                size={32}
                style={{ backgroundColor: "#25d366", fontSize: "12px" }}
              >
                {getInitials(contact.name)}
              </Avatar>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "#111b21" }}>
                  {contact.name}
                </div>
                <div style={{ fontSize: "12px", color: "#667781" }}>
                  {contact.email} • {contact.enrollmentNo} •{" "}
                  {contact.department.name}
                </div>
              </div>
            </div>
          </Option>
        ))}
      </Select>

      {selectedContact && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#f8f9fa",
            borderRadius: 8,
            border: "1px solid #e0e0e0",
          }}
        >
          {(() => {
            const selected = contacts.find((c) => c.id === selectedContact);
            return selected ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar size={40} style={{ backgroundColor: "#25d366" }}>
                  {getInitials(selected.name)}
                </Avatar>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {selected.name}
                  </div>
                  <div style={{ fontSize: "13px", color: "#667781" }}>
                    {selected.email}
                  </div>
                  <div style={{ fontSize: "12px", color: "#667781" }}>
                    {selected.enrollmentNo} • {selected.department.name}
                  </div>
                </div>
              </div>
            ) : null;
          })()}
        </div>
      )}
    </Modal>
  );
};
