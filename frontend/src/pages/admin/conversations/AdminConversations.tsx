import React, { useState } from "react";
import { App } from "antd";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { conversationApi } from "@/api";
import { ConversationCreateData, QueryParams } from "@/common/types";
import { useAuth } from "@/router/ProtectedRoute";
import {
  ConversationHeader,
  ConversationSidebar,
  MessageArea,
  MessageInput,
  CreateConversationModal,
} from "./components";

const AdminConversations: React.FC = () => {
  const { notification } = App.useApp();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.id || "admin-user-id";

  // State
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);

  // Queries
  const conversationsQuery = useQuery({
    queryKey: ["admin", "conversations", searchQuery],
    queryFn: () => {
      const params: QueryParams = {};
      if (searchQuery) {
        params.search = searchQuery;
      }
      return conversationApi.adminGetConversations(params);
    },
  });

  const selectedConversationQuery = useQuery({
    queryKey: ["admin", "conversation", selectedConversationId],
    queryFn: () =>
      conversationApi.adminGetConversation(selectedConversationId!),
    enabled: !!selectedConversationId,
  });

  // Mutations
  const sendMessageMutation = useMutation({
    mutationFn: ({
      conversationId,
      content,
    }: {
      conversationId: string;
      content: string;
    }) => conversationApi.adminSendMessage(conversationId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "conversation", selectedConversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "conversations"],
      });
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to send message. Please try again.",
      });
    },
  });

  const createConversationMutation = useMutation({
    mutationFn: (data: ConversationCreateData) =>
      conversationApi.adminCreateConversation(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "conversations"] });
      notification.success({
        message: "Success",
        description: "Conversation created successfully.",
      });
      setIsModalVisible(false);

      // Select the newly created conversation
      if (response?.data?.data?.id) {
        setSelectedConversationId(response.data.data.id);
      }
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to create conversation. Please try again.",
      });
    },
  });

  // Get data from queries
  const conversations = conversationsQuery.data?.data?.data || [];
  const selectedConversation =
    selectedConversationQuery.data?.data?.data || null;
  const messages = selectedConversation?.messages || [];

  // Handlers
  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
  };

  const handleSendMessage = (content: string) => {
    if (selectedConversationId) {
      sendMessageMutation.mutate({
        conversationId: selectedConversationId,
        content,
      });
    }
  };

  const handleNewConversation = () => {
    setIsModalVisible(true);
  };

  const handleCancelModal = () => {
    setIsModalVisible(false);
  };

  const handleCreateConversation = (data: ConversationCreateData) => {
    createConversationMutation.mutate(data);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/3 max-w-sm">
          <ConversationSidebar
            conversations={conversations}
            loading={conversationsQuery.isLoading}
            selectedId={selectedConversationId}
            onSelect={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onSearch={handleSearch}
          />
        </div>

        <div className="flex-1 flex flex-col">
          <ConversationHeader
            conversation={selectedConversation}
            loading={selectedConversationQuery.isLoading}
          />

          <MessageArea
            messages={messages}
            loading={selectedConversationQuery.isLoading}
            currentUserId={currentUserId}
          />

          <MessageInput
            onSend={handleSendMessage}
            disabled={!selectedConversationId}
            loading={sendMessageMutation.isPending}
          />
        </div>
      </div>

      <CreateConversationModal
        visible={isModalVisible}
        onCancel={handleCancelModal}
        onSubmit={handleCreateConversation}
        isSubmitting={createConversationMutation.isPending}
      />
    </div>
  );
};

export default AdminConversations;
