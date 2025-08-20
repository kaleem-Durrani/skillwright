import React, { useState, useEffect, useRef } from "react";
import { Typography, Empty } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import {
  ConversationListItem,
  ConversationMessage,
  conversationService,
} from "../../../../services/conversationService";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";

const { Title, Text } = Typography;

interface ChatAreaProps {
  conversation: ConversationListItem | null;
  onMessageSent: (message: any) => void;
  newMessage?: any;
  readReceipts?: any;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  onMessageSent,
  newMessage,
  readReceipts,
}) => {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Handle new messages from parent component
  useEffect(() => {
    if (
      newMessage &&
      conversation &&
      newMessage.conversationId === conversation.id
    ) {
      console.log("ChatArea: Received new message from parent:", newMessage);

      const messageToAdd: ConversationMessage = {
        id: newMessage.id,
        content: newMessage.content,
        isFromTeacher: newMessage.isFromTeacher,
        createdAt: newMessage.createdAt,
        teacherReadAt: newMessage.teacherReadAt,
        studentReadAt: newMessage.studentReadAt,
      };

      setMessages((prev) => {
        // Check if message already exists to prevent duplicates
        const exists = prev.some((msg) => msg.id === messageToAdd.id);
        if (exists) return prev;
        return [...prev, messageToAdd];
      });

      // Auto-mark incoming student messages as read since chat is open
      if (!newMessage.isFromTeacher && !newMessage.teacherReadAt) {
        conversationService.teacher
          .markAsRead(conversation.id)
          .catch((error) =>
            console.error("Failed to mark incoming message as read:", error)
          );
      }
    }
  }, [newMessage, conversation]);

  // Handle read receipts from parent component
  useEffect(() => {
    if (readReceipts && conversation && readReceipts.userType === "student") {
      console.log(
        "ChatArea: Received read receipts from parent:",
        readReceipts
      );

      setMessages((prev) =>
        prev.map((msg) =>
          readReceipts.messageIds.includes(msg.id)
            ? { ...msg, studentReadAt: readReceipts.readAt }
            : msg
        )
      );
    }
  }, [readReceipts, conversation]);

  // Load messages when conversation changes
  useEffect(() => {
    if (conversation) {
      loadMessages(true);
    } else {
      setMessages([]);
      setCursor(null);
      setHasMore(true);
    }
  }, [conversation]);

  // Mark messages as read when opening conversation
  useEffect(() => {
    if (conversation) {
      conversationService.teacher
        .markAsRead(conversation.id)
        .catch((error) =>
          console.error("Failed to mark messages as read:", error)
        );
    }
  }, [conversation]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async (isInitial = false) => {
    if (!conversation || loading) return;

    try {
      setLoading(true);
      const response = await conversationService.teacher.getMessages(
        conversation.id,
        isInitial ? undefined : cursor || undefined,
        20
      );

      if (response.success && response.data) {
        const newMessages = response.data.messages;

        if (isInitial) {
          setMessages(newMessages);
        } else {
          setMessages((prev) => [...newMessages, ...prev]);
        }

        setCursor(response.data.nextCursor);
        setHasMore(response.data.hasMore);
      }
    } catch (error) {
      console.error("Failed to load messages:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!conversation) return;

    try {
      const response = await conversationService.teacher.sendMessage(
        conversation.id,
        { content }
      );

      if (response.success && response.data) {
        const newMessage: ConversationMessage = {
          id: response.data.id,
          content: response.data.content,
          isFromTeacher: response.data.isFromTeacher,
          createdAt: response.data.createdAt,
          teacherReadAt: new Date().toISOString(),
          studentReadAt: null,
        };

        setMessages((prev) => [...prev, newMessage]);
        onMessageSent(newMessage);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current || !hasMore || loading) return;

    const { scrollTop } = messagesContainerRef.current;

    // Load more messages when scrolled to top
    if (scrollTop === 0) {
      loadMessages(false);
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

  if (!conversation) {
    return (
      <div className="chat-area">
        <div className="empty-chat">
          <MessageOutlined className="empty-icon" />
          <Title level={4} className="empty-title">
            Welcome to Messages
          </Title>
          <Text className="empty-description">
            Select a conversation from the sidebar to start messaging with your
            students. You can also start a new conversation by clicking the "New
            Chat" button.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-area">
      {/* Chat Header */}
      <div className="chat-header">
        <div className="participant-avatar">
          {getInitials(conversation.participant.name)}
        </div>
        <div className="participant-info">
          <Title level={5} className="participant-name">
            {conversation.participant.name}
          </Title>
          <Text className="participant-status">
            {conversation.participant.email}
          </Text>
        </div>
      </div>

      {/* Messages Container */}
      <div
        className="messages-container"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {loading && messages.length === 0 && (
          <div
            style={{ textAlign: "center", padding: "20px", color: "#667781" }}
          >
            Loading messages...
          </div>
        )}

        {hasMore && messages.length > 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "10px",
              color: "#667781",
              fontSize: "12px",
            }}
          >
            {loading
              ? "Loading more messages..."
              : "Scroll up to load more messages"}
          </div>
        )}

        {messages.length === 0 && !loading && (
          <div
            style={{ textAlign: "center", padding: "40px", color: "#667781" }}
          >
            <MessageOutlined
              style={{ fontSize: 32, marginBottom: 16, opacity: 0.5 }}
            />
            <div>No messages yet. Start the conversation!</div>
          </div>
        )}

        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isFromCurrentUser={message.isFromTeacher}
            showAvatar={
              index === 0 ||
              messages[index - 1].isFromTeacher !== message.isFromTeacher
            }
            participantName={conversation.participant.name}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="message-input-container">
        <MessageInput
          onSendMessage={handleSendMessage}
          placeholder={`Message ${conversation.participant.name}...`}
        />
      </div>
    </div>
  );
};
