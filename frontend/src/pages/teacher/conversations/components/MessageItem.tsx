import React from 'react';
import { Avatar, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { Message } from '@/common/types';
import dayjs from 'dayjs';

const { Text } = Typography;

interface MessageItemProps {
  message: Message;
  isOwn: boolean;
}

/**
 * Component for displaying a single message
 */
const MessageItem: React.FC<MessageItemProps> = ({ message, isOwn }) => {
  return (
    <div
      className={`flex mb-4 ${
        isOwn ? 'justify-end' : 'justify-start'
      }`}
    >
      {!isOwn && (
        <Avatar
          icon={<UserOutlined />}
          className="mr-2 mt-1"
        />
      )}
      
      <div
        className={`max-w-[70%] ${
          isOwn
            ? 'bg-blue-500 text-white rounded-tl-lg rounded-tr-lg rounded-bl-lg'
            : 'bg-gray-200 text-gray-800 rounded-tl-lg rounded-tr-lg rounded-br-lg'
        } p-3 shadow-sm`}
      >
        <Text
          className={`block ${isOwn ? 'text-white' : 'text-gray-800'}`}
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {message.content}
        </Text>
        <Text
          className={`block text-xs mt-1 ${
            isOwn ? 'text-blue-100' : 'text-gray-500'
          }`}
        >
          {dayjs(message.createdAt).format('MMM D, YYYY h:mm A')}
        </Text>
      </div>
      
      {isOwn && (
        <Avatar
          icon={<UserOutlined />}
          className="ml-2 mt-1"
        />
      )}
    </div>
  );
};

export default MessageItem;
