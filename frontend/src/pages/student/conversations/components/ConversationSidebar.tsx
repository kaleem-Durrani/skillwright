import React, { useState } from "react";
import { Card, Input, List, Empty, Spin } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import { Conversation } from "@/common/types";
import ConversationItem from "./ConversationItem";

interface ConversationSidebarProps {
  conversations: Conversation[];
  isLoading: boolean;
  selectedConversationId: string | undefined;
  currentUserId: string;
  onSelectConversation: (conversationId: string) => void;
}

/**
 * Sidebar component for displaying the list of conversations
 */
const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  isLoading,
  selectedConversationId,
  currentUserId,
  onSelectConversation,
}) => {
  const [searchText, setSearchText] = useState("");

  // Filter conversations by search text
  const filteredConversations = conversations.filter((conversation) => {
    // Find other participants (not the current student)
    const otherParticipants = conversation.participants?.filter(
      (p) => p.userId !== currentUserId
    );
    
    const participantNames = otherParticipants
      ?.map((p) => p.name || "")
      .join(" ")
      .toLowerCase();
    
    const title = (conversation.title || "").toLowerCase();
    
    return (
      title.includes(searchText.toLowerCase()) ||
      participantNames.includes(searchText.toLowerCase())
    );
  });

  return (
    <Card className="w-full md:w-1/3">
      <div className="mb-4">
        <Input
          placeholder="Search conversations..."
          prefix={<MessageOutlined />}
          allowClear
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spin size="large" />
        </div>
      ) : filteredConversations.length > 0 ? (
        <List
          itemLayout="horizontal"
          dataSource={filteredConversations}
          renderItem={(conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={selectedConversationId === conversation.id}
              currentUserId={currentUserId}
              onSelect={onSelectConversation}
            />
          )}
        />
      ) : (
        <Empty
          description="No conversations found"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </Card>
  );
};

export default ConversationSidebar;
