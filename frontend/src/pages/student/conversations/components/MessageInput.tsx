import React, { useState } from "react";
import { Button, Input, Typography } from "antd";
import { SendOutlined } from "@ant-design/icons";

const { TextArea } = Input;
const { Text } = Typography;

interface MessageInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

/**
 * Component for the message input area
 */
const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  disabled = false,
}) => {
  const [messageText, setMessageText] = useState("");

  const handleSendMessage = () => {
    if (!messageText.trim() || disabled) return;
    
    onSendMessage(messageText);
    setMessageText("");
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="mt-auto">
      <div className="flex gap-2">
        <TextArea
          placeholder="Type your message..."
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          autoSize={{ minRows: 1, maxRows: 4 }}
          onKeyDown={handleKeyPress}
          disabled={disabled}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendMessage}
          disabled={!messageText.trim() || disabled}
        />
      </div>
      <Text type="secondary" className="text-xs mt-1">
        Press Enter to send, Shift+Enter for new line
      </Text>
    </div>
  );
};

export default MessageInput;
