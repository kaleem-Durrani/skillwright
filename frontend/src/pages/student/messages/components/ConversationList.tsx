import React from 'react';
import { List, Avatar, Badge, Typography, Spin, Empty } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { ConversationWithDetails } from '@/common/types';

const { Text } = Typography;

interface ConversationListProps {
  conversations: ConversationWithDetails[];
  selectedConversationId: string | null;
  isLoading: boolean;
  onSelectConversation: (conversationId: string) => void;
}

/**
 * Conversation list component for displaying a list of conversations
 */
const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedConversationId,
  isLoading,
  onSelectConversation,
}) => {
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spin size="large" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <Empty 
        description="No conversations found" 
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  // Get the other participant's name from the conversation
  const getParticipantName = (conversation: ConversationWithDetails) => {
    const otherParticipant = conversation.participants.find(
      (participant) => !participant.isCurrentUser
    );
    return otherParticipant?.name || 'Unknown User';
  };

  // Get the last message preview
  const getLastMessagePreview = (conversation: ConversationWithDetails) => {
    if (!conversation.lastMessage) {
      return 'No messages yet';
    }
    return conversation.lastMessage.content.length > 30
      ? `${conversation.lastMessage.content.substring(0, 30)}...`
      : conversation.lastMessage.content;
  };

  // Format the last message time
  const formatLastMessageTime = (conversation: ConversationWithDetails) => {
    if (!conversation.lastMessage) {
      return '';
    }
    
    const date = new Date(conversation.lastMessage.createdAt);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 0) {
      // Today, show time
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInDays === 1) {
      // Yesterday
      return 'Yesterday';
    } else if (diffInDays < 7) {
      // Within a week, show day name
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      // More than a week, show date
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <List
      className="conversation-list"
      dataSource={conversations}
      renderItem={(conversation) => (
        <List.Item
          key={conversation.id}
          onClick={() => onSelectConversation(conversation.id)}
          className={`cursor-pointer hover:bg-gray-100 ${
            selectedConversationId === conversation.id ? 'bg-blue-50' : ''
          }`}
        >
          <List.Item.Meta
            avatar={
              <Badge 
                dot={conversation.unreadCount > 0} 
                color="blue"
                offset={[-5, 5]}
              >
                <Avatar icon={<UserOutlined />} />
              </Badge>
            }
            title={
              <div className="flex justify-between">
                <Text strong>{getParticipantName(conversation)}</Text>
                <Text type="secondary" className="text-xs">
                  {formatLastMessageTime(conversation)}
                </Text>
              </div>
            }
            description={
              <div className="flex justify-between">
                <Text
                  type={conversation.unreadCount > 0 ? 'default' : 'secondary'}
                  strong={conversation.unreadCount > 0}
                  className="text-sm"
                >
                  {getLastMessagePreview(conversation)}
                </Text>
                {conversation.unreadCount > 0 && (
                  <Badge 
                    count={conversation.unreadCount} 
                    size="small" 
                    className="ml-2"
                  />
                )}
              </div>
            }
          />
        </List.Item>
      )}
    />
  );
};

export default ConversationList;
