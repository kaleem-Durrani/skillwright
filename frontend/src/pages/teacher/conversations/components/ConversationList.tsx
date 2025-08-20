import React from "react";
import { List, Button, Spin, Empty, Badge } from "antd";
import { LoadingOutlined, MessageOutlined } from "@ant-design/icons";
import { ConversationListItem } from "../../../../services/conversationService";
import { formatDistanceToNow } from "date-fns";

interface ConversationListProps {
  conversations: ConversationListItem[];
  selectedConversation: ConversationListItem | null;
  onSelectConversation: (conversation: ConversationListItem) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedConversation,
  onSelectConversation,
  loading,
  hasMore,
  onLoadMore,
}) => {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

      if (diffInHours < 24) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (diffInHours < 168) { // 7 days
        return date.toLocaleDateString([], { weekday: 'short' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    } catch {
      return '';
    }
  };

  const truncateMessage = (message: string, maxLength = 40) => {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + "...";
  };

  if (loading && conversations.length === 0) {
    return (
      <div className="conversation-list">
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
          <div style={{ marginTop: 16, color: '#667781' }}>Loading conversations...</div>
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="conversation-list">
        <Empty
          image={<MessageOutlined style={{ fontSize: 48, color: '#ccc' }} />}
          description={
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                No conversations yet
              </div>
              <div style={{ fontSize: 14, color: '#667781' }}>
                Start a new conversation with your students
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="conversation-list">
      <List
        dataSource={conversations}
        renderItem={(conversation) => (
          <div
            key={conversation.id}
            className={`conversation-item ${
              selectedConversation?.id === conversation.id ? 'selected' : ''
            }`}
            onClick={() => onSelectConversation(conversation)}
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
                    ? formatTime(conversation.lastMessage.createdAt)
                    : formatTime(conversation.createdAt)
                  }
                </div>
              </div>
              
              <div className="conversation-preview">
                <div className="last-message">
                  {conversation.lastMessage ? (
                    <>
                      {conversation.lastMessage.isFromTeacher && "You: "}
                      {truncateMessage(conversation.lastMessage.content)}
                    </>
                  ) : (
                    <em>No messages yet</em>
                  )}
                </div>
                
                {conversation.unreadCount > 0 && (
                  <Badge 
                    count={conversation.unreadCount} 
                    className="unread-badge"
                    style={{ 
                      backgroundColor: '#25d366',
                      fontSize: '12px',
                      minWidth: '20px',
                      height: '20px',
                      lineHeight: '20px'
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      />
      
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '16px' }}>
          <Button
            type="text"
            loading={loading}
            onClick={onLoadMore}
            className="load-more-btn"
          >
            {loading ? 'Loading...' : 'Load more conversations'}
          </Button>
        </div>
      )}
    </div>
  );
};
