import React from "react";
import { List, Avatar, Badge, Typography, Space } from "antd";
import { TeamOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { Conversation } from "@/common/types";
import { formatConversationDate, getLastMessagePreview } from "../utils/conversationUtils";

const { Text } = Typography;

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  currentUserId: string;
  onSelect: (conversationId: string) => void;
}

/**
 * Component for rendering a single conversation item in the list
 */
const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  currentUserId,
  onSelect,
}) => {
  // Find other participants (not the current student)
  const otherParticipants = conversation.participants?.filter(
    (p) => p.userId !== currentUserId
  );
  
  const title =
    conversation.title ||
    otherParticipants
      ?.map((p) => p.name || "Unknown")
      .join(", ") ||
    "Conversation";

  return (
    <List.Item
      className={`cursor-pointer hover:bg-gray-50 rounded p-2 ${
        isSelected ? "bg-blue-50" : ""
      }`}
      onClick={() => onSelect(conversation.id)}
    >
      <List.Item.Meta
        avatar={
          <Badge count={0} dot>
            <Avatar icon={<TeamOutlined />} />
          </Badge>
        }
        title={title}
        description={
          <Space direction="vertical" size={0}>
            <Text type="secondary" ellipsis>
              {getLastMessagePreview(conversation)}
            </Text>
            <Text type="secondary" className="text-xs">
              <ClockCircleOutlined className="mr-1" />
              {conversation.updatedAt
                ? formatConversationDate(conversation.updatedAt)
                : "Unknown date"}
            </Text>
          </Space>
        }
      />
    </List.Item>
  );
};

export default ConversationItem;
