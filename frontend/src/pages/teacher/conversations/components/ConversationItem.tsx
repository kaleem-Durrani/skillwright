import React from 'react';
import { List, Avatar, Typography, Badge } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { Conversation } from '@/common/types';
import dayjs from 'dayjs';

const { Text } = Typography;

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Component for displaying a single conversation in the sidebar
 */
const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  onClick,
}) => {
  // Get the last message content
  const getLastMessage = () => {
    if (!conversation.messages || conversation.messages.length === 0) {
      return 'No messages yet';
    }
    
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    return lastMessage.content;
  };
  
  // Get the last message time
  const getLastMessageTime = () => {
    if (!conversation.messages || conversation.messages.length === 0) {
      return dayjs(conversation.createdAt).format('MMM D');
    }
    
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    return dayjs(lastMessage.createdAt).format('MMM D');
  };
  
  // Get the other participant's name
  const getParticipantName = () => {
    if (!conversation.participants || conversation.participants.length === 0) {
      return 'Unknown';
    }
    
    // Filter out the current user (teacher)
    const otherParticipants = conversation.participants.filter(
      p => p.userType !== 'teacher'
    );
    
    if (otherParticipants.length === 0) {
      return conversation.title || 'Conversation';
    }
    
    return otherParticipants.map(p => p.name || 'Unknown').join(', ');
  };
  
  return (
    <List.Item
      onClick={onClick}
      className={`cursor-pointer hover:bg-gray-100 transition-colors ${
        isSelected ? 'bg-blue-50' : ''
      }`}
    >
      <List.Item.Meta
        avatar={<Avatar icon={<UserOutlined />} />}
        title={
          <div className="flex justify-between">
            <Text strong>{conversation.title || getParticipantName()}</Text>
            <Text type="secondary" className="text-xs">
              {getLastMessageTime()}
            </Text>
          </div>
        }
        description={
          <Text
            type="secondary"
            ellipsis={{ rows: 1 }}
            className="block max-w-[200px]"
          >
            {getLastMessage()}
          </Text>
        }
      />
    </List.Item>
  );
};

export default ConversationItem;
