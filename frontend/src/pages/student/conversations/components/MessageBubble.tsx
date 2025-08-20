import React from "react";
import { Avatar } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { ConversationMessage } from "@/services/conversationService";
import dayjs from "dayjs";
import "./MessageBubble.scss";

interface MessageBubbleProps {
  message: ConversationMessage;
  isFromCurrentUser: boolean;
  showAvatar: boolean;
  participantName: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isFromCurrentUser,
  showAvatar,
  participantName,
}) => {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={`message-bubble ${isFromCurrentUser ? "own" : "other"}`}>
      {!isFromCurrentUser && showAvatar && (
        <div className="message-avatar">
          <Avatar size={32} style={{ backgroundColor: "#25d366" }}>
            {getInitials(participantName)}
          </Avatar>
        </div>
      )}
      
      <div className="message-content">
        <div className="message-text">
          {message.content}
        </div>
        <div className="message-time">
          {dayjs(message.createdAt).format("HH:mm")}
        </div>
      </div>
      
      {isFromCurrentUser && showAvatar && (
        <div className="message-avatar">
          <Avatar size={32} icon={<UserOutlined />} />
        </div>
      )}
    </div>
  );
};
