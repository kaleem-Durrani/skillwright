import React from "react";
import { Typography, Avatar } from "antd";
import { ConversationMessage } from "../../../../services/conversationService";
import { formatDistanceToNow, format } from "date-fns";
import "./MessageBubble.scss";

const { Text } = Typography;

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

  const formatMessageTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

      if (diffInHours < 24) {
        return format(date, 'HH:mm');
      } else if (diffInHours < 168) { // 7 days
        return format(date, 'EEE HH:mm');
      } else {
        return format(date, 'MMM dd, HH:mm');
      }
    } catch {
      return '';
    }
  };

  const getReadStatus = () => {
    if (isFromCurrentUser) {
      // Message sent by teacher
      if (message.studentReadAt) {
        return 'read';
      } else {
        return 'delivered';
      }
    }
    return null;
  };

  const readStatus = getReadStatus();

  return (
    <div className={`message-bubble-container ${isFromCurrentUser ? 'own-message' : 'other-message'}`}>
      {!isFromCurrentUser && showAvatar && (
        <div className="message-avatar">
          <Avatar size={32} style={{ backgroundColor: '#25d366', fontSize: '12px' }}>
            {getInitials(participantName)}
          </Avatar>
        </div>
      )}
      
      <div className={`message-bubble ${isFromCurrentUser ? 'own' : 'other'}`}>
        <div className="message-content">
          <Text className="message-text">{message.content}</Text>
        </div>
        
        <div className="message-footer">
          <Text className="message-time">
            {formatMessageTime(message.createdAt)}
          </Text>
          
          {isFromCurrentUser && (
            <div className="message-status">
              {readStatus === 'read' && (
                <div className="read-indicator double-check blue">✓✓</div>
              )}
              {readStatus === 'delivered' && (
                <div className="delivered-indicator double-check">✓✓</div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {isFromCurrentUser && showAvatar && (
        <div className="message-avatar">
          <Avatar size={32} style={{ backgroundColor: '#0084ff', fontSize: '12px' }}>
            You
          </Avatar>
        </div>
      )}
    </div>
  );
};
