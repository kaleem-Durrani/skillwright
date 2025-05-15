import React from 'react';
import { Typography, Avatar, Space, Button } from 'antd';
import { UserOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Conversation } from '@/common/types';

const { Title, Text } = Typography;

interface ConversationHeaderProps {
  conversation: Conversation | null;
  loading: boolean;
}

/**
 * Header component for the conversation area
 */
const ConversationHeader: React.FC<ConversationHeaderProps> = ({ 
  conversation, 
  loading 
}) => {
  if (!conversation) {
    return (
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <Title level={4} className="m-0">
          {loading ? 'Loading...' : 'Select a conversation'}
        </Title>
      </div>
    );
  }

  // Get the other participant's name
  const getParticipantName = () => {
    if (!conversation.participants || conversation.participants.length === 0) {
      return 'Unknown';
    }

    // Filter out the current user (admin)
    const otherParticipants = conversation.participants.filter(
      p => p.userType !== 'admin'
    );

    if (otherParticipants.length === 0) {
      return conversation.title || 'Conversation';
    }

    return otherParticipants.map(p => p.name || 'Unknown').join(', ');
  };

  return (
    <div className="p-4 border-b border-gray-200 flex items-center justify-between">
      <Space>
        <Avatar icon={<UserOutlined />} />
        <div>
          <Title level={4} className="m-0">
            {conversation.title || getParticipantName()}
          </Title>
          <Text type="secondary">
            {conversation._count?.messages || 0} messages
          </Text>
        </div>
      </Space>
      <Button 
        type="text" 
        icon={<InfoCircleOutlined />} 
        title="View Details"
      />
    </div>
  );
};

export default ConversationHeader;
