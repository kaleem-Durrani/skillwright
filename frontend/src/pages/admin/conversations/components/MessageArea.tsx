import React, { useRef, useEffect } from "react";
import { Empty, Spin } from "antd";
import { Message } from "@/common/types";
import MessageItem from "./MessageItem";

interface MessageAreaProps {
  messages: Message[];
  loading: boolean;
  currentUserId: string;
}

/**
 * Component for displaying the message area
 */
const MessageArea: React.FC<MessageAreaProps> = ({
  messages,
  loading,
  currentUserId,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      // Find the scrollable container
      const scrollContainer = messagesEndRef.current.closest(
        '[style*="overflow"]'
      ) as HTMLElement;
      if (scrollContainer) {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: "smooth",
        });
      }
    }
  }, [messages]);

  if (loading) {
    return (
      <div className="flex-1 flex justify-center items-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex justify-center items-center">
        <Empty description="No messages yet" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          isOwn={message.senderId === currentUserId}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageArea;
