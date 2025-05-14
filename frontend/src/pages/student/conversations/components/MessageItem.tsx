import React from "react";
import { List, Avatar, Typography } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { Message } from "@/common/types";
import {
  formatMessageDate,
  isCurrentUserMessage,
} from "../utils/conversationUtils";

const { Text, Paragraph } = Typography;

interface MessageItemProps {
  message: Message;
  currentUserId: string;
}

/**
 * Component for rendering a single message in the conversation
 */
const MessageItem: React.FC<MessageItemProps> = ({
  message,
  currentUserId,
}) => {
  const isCurrentUser = isCurrentUserMessage(message, currentUserId);

  return (
    <List.Item
      className={`border-0 ${isCurrentUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[80%] ${
          isCurrentUser ? "bg-blue-100" : "bg-gray-100"
        } rounded-lg p-3`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Avatar
            size="small"
            icon={<UserOutlined />}
            className={isCurrentUser ? "bg-blue-500" : "bg-gray-500"}
          />
          <Text strong>
            {isCurrentUser
              ? "You"
              : message.senderName || `${message.senderType} User`}
          </Text>
        </div>
        <Paragraph className="m-0">{message.content}</Paragraph>
        <Text type="secondary" className="text-xs block text-right mt-1">
          {formatMessageDate(message.createdAt)}
        </Text>
      </div>
    </List.Item>
  );
};

export default MessageItem;
