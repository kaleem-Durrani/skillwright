import React, { useEffect, useRef } from "react";
import { Button, Typography, List, Empty, Spin } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Conversation, Message } from "@/common/types";
import { getConversationTitle, formatDateHeader, groupMessagesByDate } from "../utils/conversationUtils";
import MessageItem from "./MessageItem";
import MessageInput from "./MessageInput";

const { Title, Text } = Typography;

interface MessageAreaProps {
  conversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  currentUserId: string;
  onSendMessage: (message: string) => void;
  onLeaveConversation: () => void;
  onBackClick: () => void;
}

/**
 * Component for displaying messages and message input
 */
const MessageArea: React.FC<MessageAreaProps> = ({
  conversation,
  messages,
  isLoading,
  currentUserId,
  onSendMessage,
  onLeaveConversation,
  onBackClick,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of messages when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Group messages by date
  const messageGroups = groupMessagesByDate(messages);

  return (
    <>
      {/* Conversation Header */}
      <div className="flex justify-between items-center mb-4 pb-4 border-b">
        <div className="flex items-center gap-2">
          <Button
            icon={<ArrowLeftOutlined />}
            type="text"
            onClick={onBackClick}
            className="md:hidden"
          />
          <Title level={4} className="m-0">
            {conversation ? getConversationTitle(conversation, currentUserId) : "Conversation"}
          </Title>
        </div>
        <Button danger onClick={onLeaveConversation}>
          Leave Conversation
        </Button>
      </div>

      {/* Messages List */}
      <div
        className="flex-1 overflow-y-auto mb-4"
        style={{ minHeight: "400px" }}
      >
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <Spin size="large" />
          </div>
        ) : messages.length > 0 ? (
          <>
            {messageGroups.map((group, groupIndex) => (
              <div key={groupIndex} className="mb-4">
                <div className="text-center mb-4">
                  <Text type="secondary" className="bg-gray-100 px-3 py-1 rounded-full text-xs">
                    {formatDateHeader(group.date)}
                  </Text>
                </div>
                
                <List
                  itemLayout="horizontal"
                  dataSource={group.messages}
                  renderItem={(message) => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      currentUserId={currentUserId}
                    />
                  )}
                />
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <Empty
            description="No messages yet. Start the conversation!"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </div>

      {/* Message Input */}
      <MessageInput onSendMessage={onSendMessage} />
    </>
  );
};

export default MessageArea;
