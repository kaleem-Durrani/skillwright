import React, { useState, useEffect, useRef } from "react";
import { Layout, Typography, Button, message, Spin } from "antd";
import { MessageOutlined, PlusOutlined } from "@ant-design/icons";
import { ConversationListItem } from "@/services/conversationService";
import { conversationService } from "@/services/conversationService";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ConversationList, ChatArea, NewConversationModal } from "./components";
import "./conversations.scss";

const { Title } = Typography;
const { Sider, Content } = Layout;

const StudentConversations: React.FC = () => {
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
        console.log("Student Conversations received new message:", newMessage);
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
                    : !newMessage.isFromTeacher
                    ? conv.unreadCount // Don't increment for student's own messages
                    : conv.unreadCount + 1, // Increment for teacher messages
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
        if (data.userType === "student") {
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
      conversationService.student
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
  }, [selectedConversation, isConnected]);

  // Update ref when selectedConversation changes
  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  const loadConversations = async (pageNum = 1) => {
    try {
      setLoading(true);
      const response = await conversationService.student.getConversations(
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

  const handleConversationSelect = (conversation: ConversationListItem) => {
    // Leave previous conversation room
    if (selectedConversation) {
      leaveConversation(selectedConversation.id);
    }
    setSelectedConversation(conversation);
  };

  const handleNewConversation = () => {
    setIsNewConversationModalOpen(true);
  };

  const handleConversationCreated = (newConversation: ConversationListItem) => {
    setConversations((prev) => {
      // Check if conversation already exists
      const existingIndex = prev.findIndex((c) => c.id === newConversation.id);
      if (existingIndex !== -1) {
        // If exists, just select it and don't add duplicate
        setSelectedConversation(prev[existingIndex]);
        return prev;
      }
      // If doesn't exist, add it to the top
      return [newConversation, ...prev];
    });
    setSelectedConversation(newConversation);
    setIsNewConversationModalOpen(false);
  };

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      loadConversations(page + 1);
    }
  };

  return (
    <div className="student-conversations">
      <Layout className="conversations-layout">
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
              onClick={handleNewConversation}
              className="new-conversation-btn"
            >
              New
            </Button>
          </div>

          {loading && conversations.length === 0 ? (
            <div className="flex justify-center items-center p-8">
              <Spin size="large" />
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedConversation={selectedConversation}
              onConversationSelect={handleConversationSelect}
              onLoadMore={handleLoadMore}
              hasMore={hasMore}
              loading={loading}
            />
          )}
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

      <NewConversationModal
        open={isNewConversationModalOpen}
        onCancel={() => setIsNewConversationModalOpen(false)}
        onConversationCreated={handleConversationCreated}
      />
    </div>
  );
};

export default StudentConversations;
