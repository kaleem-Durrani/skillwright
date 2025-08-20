import React, { useState, useRef, useEffect } from "react";
import { Input, Button, message } from "antd";
import { SendOutlined, SmileOutlined } from "@ant-design/icons";
import "./MessageInput.scss";

const { TextArea } = Input;

interface MessageInputProps {
  onSendMessage: (content: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  placeholder = "Type a message...",
  disabled = false,
}) => {
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const textAreaRef = useRef<any>(null);

  // Auto-focus on mount
  useEffect(() => {
    if (textAreaRef.current && !disabled) {
      textAreaRef.current.focus();
    }
  }, [disabled]);

  const handleSend = async () => {
    const trimmedMessage = messageText.trim();
    
    if (!trimmedMessage || sending) {
      return;
    }

    try {
      setSending(true);
      await onSendMessage(trimmedMessage);
      setMessageText("");
      
      // Refocus the input after sending
      setTimeout(() => {
        if (textAreaRef.current) {
          textAreaRef.current.focus();
        }
      }, 100);
    } catch (error) {
      message.error("Failed to send message");
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
  };

  return (
    <div className="message-input">
      <div className="input-container">
        {/* Emoji Button (placeholder for future emoji picker) */}
        <Button
          type="text"
          icon={<SmileOutlined />}
          className="emoji-btn"
          disabled={disabled}
          title="Emoji (coming soon)"
        />

        {/* Text Input */}
        <TextArea
          ref={textAreaRef}
          value={messageText}
          onChange={handleTextChange}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          disabled={disabled || sending}
          autoSize={{ minRows: 1, maxRows: 4 }}
          className="message-textarea"
        />

        {/* Send Button */}
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={disabled || !messageText.trim()}
          className="send-btn"
          title="Send message (Enter)"
        />
      </div>
      
      <div className="input-footer">
        <span className="input-hint">
          Press Enter to send, Shift+Enter for new line
        </span>
      </div>
    </div>
  );
};
