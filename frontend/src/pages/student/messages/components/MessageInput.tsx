import React, { useState } from 'react';
import { Input, Button } from 'antd';
import { SendOutlined } from '@ant-design/icons';

interface MessageInputProps {
  onSendMessage: (content: string) => void;
  isLoading: boolean;
  disabled?: boolean;
}

/**
 * Message input component for sending messages
 */
const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  isLoading,
  disabled = false,
}) => {
  const [message, setMessage] = useState('');

  const handleSendMessage = () => {
    if (message.trim() && !isLoading && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="message-input-container p-3 border-t">
      <div className="flex">
        <Input.TextArea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Type a message..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={isLoading || disabled}
          className="flex-1 mr-2"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendMessage}
          loading={isLoading}
          disabled={!message.trim() || disabled}
        />
      </div>
    </div>
  );
};

export default MessageInput;
