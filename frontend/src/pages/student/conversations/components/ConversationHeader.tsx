import React from "react";
import { Typography, Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

interface ConversationHeaderProps {
  onNewConversation: () => void;
}

/**
 * Header component for the conversations page
 */
const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  onNewConversation,
}) => {
  return (
    <div className="mb-6 flex justify-between items-center">
      <div>
        <Title level={2}>Messages</Title>
        <Text className="text-gray-600">
          Communicate with teachers and administrators
        </Text>
      </div>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={onNewConversation}
      >
        New Conversation
      </Button>
    </div>
  );
};

export default ConversationHeader;
