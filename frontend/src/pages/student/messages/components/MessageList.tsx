import React, { useEffect, useRef } from 'react';
import { List, Avatar, Typography, Spin, Empty } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { MessageWithDetails } from '@/common/types';

const { Text } = Typography;

interface MessageListProps {
  messages: MessageWithDetails[];
  isLoading: boolean;
  currentUserId: string;
}

/**
 * Message list component for displaying a list of messages in a conversation
 */
const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  currentUserId,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spin size="large" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <Empty 
        description="No messages yet" 
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  // Format message time
  const formatMessageTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Group messages by date
  const groupMessagesByDate = () => {
    const groups: { date: string; messages: MessageWithDetails[] }[] = [];
    let currentDate = '';
    let currentGroup: MessageWithDetails[] = [];

    messages.forEach((message) => {
      const messageDate = new Date(message.createdAt).toLocaleDateString();
      
      if (messageDate !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, messages: currentGroup });
        }
        currentDate = messageDate;
        currentGroup = [message];
      } else {
        currentGroup.push(message);
      }
    });

    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, messages: currentGroup });
    }

    return groups;
  };

  const messageGroups = groupMessagesByDate();

  return (
    <div className="message-list-container h-full overflow-y-auto p-4">
      {messageGroups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-4">
          <div className="text-center mb-4">
            <Text type="secondary" className="bg-gray-100 px-3 py-1 rounded-full text-xs">
              {group.date === new Date().toLocaleDateString()
                ? 'Today'
                : group.date === new Date(Date.now() - 86400000).toLocaleDateString()
                ? 'Yesterday'
                : group.date}
            </Text>
          </div>
          
          <List
            itemLayout="horizontal"
            dataSource={group.messages}
            renderItem={(message) => {
              const isCurrentUser = message.senderId === currentUserId;
              
              return (
                <List.Item
                  className={`border-0 p-0 mb-2 ${
                    isCurrentUser ? 'flex-row-reverse' : ''
                  }`}
                >
                  <div
                    className={`flex ${
                      isCurrentUser ? 'flex-row-reverse' : 'flex-row'
                    } max-w-[80%]`}
                  >
                    {!isCurrentUser && (
                      <Avatar
                        icon={<UserOutlined />}
                        className="mr-2 mt-1"
                        src={message.senderAvatar}
                      />
                    )}
                    
                    <div
                      className={`px-3 py-2 rounded-lg ${
                        isCurrentUser
                          ? 'bg-blue-500 text-white mr-2'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {!isCurrentUser && (
                        <Text strong className="block mb-1 text-xs">
                          {message.senderName || 'Unknown User'}
                        </Text>
                      )}
                      <Text
                        className={isCurrentUser ? 'text-white' : 'text-gray-800'}
                      >
                        {message.content}
                      </Text>
                      <Text
                        className={`block text-right text-xs mt-1 ${
                          isCurrentUser ? 'text-blue-100' : 'text-gray-500'
                        }`}
                      >
                        {formatMessageTime(message.createdAt)}
                      </Text>
                    </div>
                  </div>
                </List.Item>
              );
            }}
          />
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;
