import React, { useState, useEffect } from "react";
import { Row, Col, App, Typography, Card } from "antd";
import { useConversationQuery } from "@/hooks";
import { Conversation, Message } from "@/common/types";
import {
  ConversationHeader,
  ConversationSidebar,
  MessageArea,
  MessageInput,
  CreateConversationModal,
} from "./components";

const { Title } = Typography;

const TeacherConversations: React.FC = () => {
  const { notification } = App.useApp();
  const {
    teacherGetConversationsQuery,
    teacherGetConversationQuery,
    teacherCreateConversationMutation,
    teacherSendMessageMutation,
  } = useConversationQuery();

  // State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // Get user data from localStorage
  useEffect(() => {
    const userDataString = localStorage.getItem("user");
    if (userDataString) {
      try {
        const userData = JSON.parse(userDataString);
        setCurrentUserId(userData.id);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  // Fetch conversations
  const conversationsQuery = teacherGetConversationsQuery();

  useEffect(() => {
    if (conversationsQuery.data?.data?.data) {
      let filteredConversations = [...conversationsQuery.data.data.data];

      // Apply search filter if any
      if (searchQuery) {
        filteredConversations = filteredConversations.filter(
          (conversation) =>
            conversation.title
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase()) ||
            conversation.participants?.some((p) =>
              p.name?.toLowerCase().includes(searchQuery.toLowerCase())
            )
        );
      }

      setConversations(filteredConversations);
    }
  }, [conversationsQuery.data, searchQuery]);

  useEffect(() => {
    if (conversationsQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load conversations. Please try again later.",
      });
    }
  }, [conversationsQuery.isError, notification]);

  // Fetch selected conversation
  const conversationQuery = teacherGetConversationQuery(
    selectedConversationId || ""
  );

  useEffect(() => {
    if (conversationQuery.data?.data?.data) {
      setSelectedConversation(conversationQuery.data.data.data);
    }
  }, [conversationQuery.data]);

  // Handlers
  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
  };

  const handleNewConversation = () => {
    setIsModalVisible(true);
  };

  const handleCancelModal = () => {
    setIsModalVisible(false);
  };

  const handleCreateConversation = async (values: any) => {
    try {
      // Format participants data
      const participants = values.participants.map((p: string) => {
        const [userType, userId] = p.split("-");
        return {
          userId,
          userType,
        };
      });

      const data = {
        title: values.title,
        participants,
        initialMessage: values.initialMessage,
      };

      const response = await teacherCreateConversationMutation.mutateAsync(
        data
      );

      if (response?.data?.data) {
        notification.success({
          message: "Success",
          description: "Conversation created successfully.",
        });
        setIsModalVisible(false);

        // Refetch conversations and select the new one
        await conversationsQuery.refetch();
        setSelectedConversationId(response.data.data.id);
      }
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to create conversation. Please try again.",
      });
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!selectedConversationId) return;

    try {
      await teacherSendMessageMutation.mutateAsync({
        conversationId: selectedConversationId,
        content,
      });

      // Refetch conversation to get the new message
      conversationQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to send message. Please try again.",
      });
    }
  };

  return (
    <div className="p-6">
      <Title level={2} className="mb-6">
        Messages
      </Title>

      <Card className="h-[calc(100vh-200px)] shadow-sm overflow-hidden">
        <Row className="h-full">
          <Col xs={24} sm={8} md={6} className="h-full">
            <ConversationSidebar
              conversations={conversations}
              loading={conversationsQuery.isLoading}
              selectedId={selectedConversationId}
              onSelect={handleSelectConversation}
              onNewConversation={handleNewConversation}
              onSearch={handleSearch}
            />
          </Col>

          <Col xs={24} sm={16} md={18} className="h-full flex flex-col">
            <ConversationHeader
              conversation={selectedConversation}
              loading={conversationQuery.isLoading}
            />

            <MessageArea
              messages={selectedConversation?.messages || []}
              loading={conversationQuery.isLoading}
              currentUserId={currentUserId}
            />

            <MessageInput
              onSend={handleSendMessage}
              disabled={!selectedConversationId}
              loading={teacherSendMessageMutation.isPending}
            />
          </Col>
        </Row>
      </Card>

      <CreateConversationModal
        visible={isModalVisible}
        onCancel={handleCancelModal}
        onCreateConversation={handleCreateConversation}
        isPending={teacherCreateConversationMutation.isPending}
      />
    </div>
  );
};

export default TeacherConversations;
