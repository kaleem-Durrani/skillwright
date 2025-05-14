import React, { useState } from 'react';
import { Input, Button } from 'antd';
import { SendOutlined, PaperClipOutlined, SmileOutlined } from '@ant-design/icons';

const { TextArea } = Input;

interface MessageInputProps {
  onSend: (content: string) => void;
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-200">
      <div className="flex">
        <TextArea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={disabled || loading}
          className="flex-1 mr-2"
        />
        <div className="flex flex-col justify-end">
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={!message.trim() || disabled || loading}
            loading={loading}
          />
        </div>
      </div>
      <div className="flex mt-2">
        <Button
          type="text"
          icon={<PaperClipOutlined />}
          disabled={disabled || loading}
          title="Attach file (coming soon)"
        />
        <Button
          type="text"
          icon={<SmileOutlined />}
          disabled={disabled || loading}
          title="Insert emoji (coming soon)"
        />
      </div>
    </div>
  );
};

export default MessageInput;
