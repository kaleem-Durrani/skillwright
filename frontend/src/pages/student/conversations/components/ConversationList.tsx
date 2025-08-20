import React from "react";
import { Button, Empty } from "antd";
import { ConversationListItem } from "@/services/conversationService";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

interface ConversationListProps {
  conversations: ConversationListItem[];
  selectedConversation: ConversationListItem | null;
  onConversationSelect: (conversation: ConversationListItem) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedConversation,
  onConversationSelect,
  onLoadMore,
  hasMore,
  loading,
}) => {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatLastMessage = (message: any) => {
    if (!message) return "No messages yet";

    const prefix = message.isFromTeacher ? "" : "You: ";
    const content =
      message.content.length > 50
        ? `${message.content.substring(0, 50)}...`
        : message.content;

    return `${prefix}${content}`;
  };

  if (conversations.length === 0 && !loading) {
    return (
      <div className="p-4">
        <Empty
          description="No conversations yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          className={`conversation-item ${
            selectedConversation?.id === conversation.id ? "selected" : ""
          }`}
          onClick={() => onConversationSelect(conversation)}
        >
          <div className="conversation-avatar">
            {getInitials(conversation.participant.name)}
          </div>

          <div className="conversation-content">
            <div className="conversation-header">
              <div className="participant-name">
                {conversation.participant.name}
              </div>
              <div className="conversation-time">
                {conversation.lastMessage
                  ? dayjs(conversation.lastMessage.createdAt).fromNow()
                  : dayjs(conversation.createdAt).fromNow()}
              </div>
            </div>

            <div className="conversation-preview">
              <div className="last-message">
                {formatLastMessage(conversation.lastMessage)}
              </div>
              {conversation.unreadCount > 0 && (
                <div className="unread-badge">{conversation.unreadCount}</div>
              )}
            </div>
          </div>
        </div>
      ))}

      {hasMore && (
        <div className="p-4">
          <Button
            type="text"
            onClick={onLoadMore}
            loading={loading}
            className="load-more-btn"
            block
          >
            {loading ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
};
