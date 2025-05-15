import React, { useState } from 'react';
import { Input, Button } from 'antd';
import { SendOutlined } from '@ant-design/icons';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  loading: boolean;
}

/**
 * Component for the message input area
 */
const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  disabled,
  loading,
}) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim() && !disabled && !loading) {
      onSend(message);
      setMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-200">
      <div className="flex">
        <Input.TextArea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={disabled}
          onKeyDown={handleKeyPress}
          className="flex-1 mr-2"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default MessageInput;
