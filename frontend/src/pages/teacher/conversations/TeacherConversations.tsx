import React, { useState, useEffect, useRef } from "react";
import { Layout, Typography, Button, message } from "antd";
import { MessageOutlined, PlusOutlined } from "@ant-design/icons";
import { ConversationList } from "./components/ConversationList";
import { ChatArea } from "./components/ChatArea";
import { NewConversationModal } from "./components/NewConversationModal";
import { useWebSocket } from "../../../hooks/useWebSocket";
import {
  conversationService,
  ConversationListItem,
} from "../../../services/conversationService";
import "./conversations.scss";

const { Title } = Typography;
const { Sider, Content } = Layout;

const TeacherConversations: React.FC = () => {
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    []
  );
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewConversationModalOpen, setIsNewConversationModalOpen] =
    useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // State for current conversation messages (shared with ChatArea)
  const [currentConversationMessages, setCurrentConversationMessages] =
    useState<any[]>([]);
  const [currentConversationReadReceipts, setCurrentConversationReadReceipts] =
    useState<any>(null);

  // Ref to track the current selected conversation for WebSocket handlers
  const selectedConversationRef = useRef<ConversationListItem | null>(null);

  // WebSocket for real-time updates
  const { isConnected, connect, joinConversation, leaveConversation } =
    useWebSocket({
      onNewMessage: (newMessage) => {
        console.log("Teacher Conversations received new message:", newMessage);
        console.log("Selected conversation:", selectedConversation?.id);

        // Update conversations list with new message
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id === newMessage.conversationId) {
              return {
                ...conv,
                lastMessage: newMessage,
                unreadCount:
                  selectedConversation?.id === conv.id
                    ? conv.unreadCount // Don't change if conversation is selected
                    : newMessage.isFromTeacher
                    ? conv.unreadCount // Don't increment for teacher's own messages
                    : conv.unreadCount + 1, // Increment for student messages
                updatedAt: newMessage.createdAt,
              };
            }
            return conv;
          })
        );

        // Also update current conversation messages if message is for selected conversation
        if (selectedConversationRef.current?.id === newMessage.conversationId) {
          setCurrentConversationMessages((prev) => {
            // Check if message already exists to prevent duplicates
            const exists = prev.some((msg) => msg.id === newMessage.id);
            if (exists) return prev;
            return [...prev, newMessage];
          });
        }
      },
      onMessagesRead: (data) => {
        // Update unread count when messages are marked as read
        if (data.userType === "teacher") {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === data.conversationId
                ? { ...conv, unreadCount: 0 }
                : conv
            )
          );
        }

        // Also update read receipts for current conversation
        if (selectedConversation?.id === data.conversationId) {
          setCurrentConversationReadReceipts(data);
        }
      },
      onError: (error) => {
        message.error(`Connection error: ${error}`);
      },
    });

  // Load conversations on component mount
  useEffect(() => {
    loadConversations();
    connect();
  }, []);

  // Join conversation room when selected
  useEffect(() => {
    if (selectedConversation && isConnected) {
      joinConversation(selectedConversation.id);

      // Mark messages as read
      conversationService.teacher
        .markAsRead(selectedConversation.id)
        .then(() => {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === selectedConversation.id
                ? { ...conv, unreadCount: 0 }
                : conv
            )
          );
        })
        .catch((error) =>
          console.error("Failed to mark messages as read:", error)
        );
    }

    return () => {
      if (selectedConversation && isConnected) {
        leaveConversation(selectedConversation.id);
      }
    };
  }, [selectedConversation, isConnected]);

  // Update ref when selectedConversation changes
  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  const loadConversations = async (pageNum = 1) => {
    try {
      setLoading(true);
      const response = await conversationService.teacher.getConversations(
        pageNum,
        20
      );

      if (response.success && response.data) {
        if (pageNum === 1) {
          setConversations(response.data.conversations);
        } else {
          setConversations((prev) => [
            ...prev,
            ...response.data!.conversations,
          ]);
        }
        setHasMore(response.data.pagination.hasMore);
        setPage(pageNum);
      }
    } catch (error) {
      message.error("Failed to load conversations");
      console.error("Error loading conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewConversation = (conversation: ConversationListItem) => {
    setConversations((prev) => {
      // Check if conversation already exists
      const existingIndex = prev.findIndex((c) => c.id === conversation.id);
      if (existingIndex !== -1) {
        // If exists, just select it and don't add duplicate
        setSelectedConversation(prev[existingIndex]);
        return prev;
      }
      // If doesn't exist, add it to the top
      return [conversation, ...prev];
    });
    setSelectedConversation(conversation);
    setIsNewConversationModalOpen(false);
  };

  const loadMoreConversations = () => {
    if (hasMore && !loading) {
      loadConversations(page + 1);
    }
  };

  return (
    <div className="teacher-conversations">
      <Layout className="conversations-layout">
        {/* Left Sidebar - Conversations List */}
        <Sider width={350} className="conversations-sidebar">
          <div className="sidebar-header">
            <div className="header-content">
              <MessageOutlined className="header-icon" />
              <Title level={4} className="header-title">
                Messages
              </Title>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsNewConversationModalOpen(true)}
              className="new-conversation-btn"
            >
              New Chat
            </Button>
          </div>

          <ConversationList
            conversations={conversations}
            selectedConversation={selectedConversation}
            onSelectConversation={setSelectedConversation}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={loadMoreConversations}
          />
        </Sider>

        {/* Right Side - Chat Area */}
        <Content className="chat-content">
          <ChatArea
            conversation={selectedConversation}
            newMessage={
              currentConversationMessages[
                currentConversationMessages.length - 1
              ]
            }
            readReceipts={currentConversationReadReceipts}
            onMessageSent={(message) => {
              // Update last message in conversations list
              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id === selectedConversation?.id
                    ? {
                        ...conv,
                        lastMessage: message,
                        updatedAt: message.createdAt,
                      }
                    : conv
                )
              );
            }}
          />
        </Content>
      </Layout>

      {/* New Conversation Modal */}
      <NewConversationModal
        open={isNewConversationModalOpen}
        onClose={() => setIsNewConversationModalOpen(false)}
        onConversationCreated={handleNewConversation}
      />
    </div>
  );
};

export default TeacherConversations;
