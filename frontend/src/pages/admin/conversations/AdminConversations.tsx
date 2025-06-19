import React from "react";
import { Typography, Card, Alert } from "antd";
import { MessageOutlined } from "@ant-design/icons";

const { Title, Paragraph } = Typography;

const AdminConversations: React.FC = () => {
  return (
    <div className="p-6">
      <div className="flex items-center mb-6">
        <MessageOutlined className="text-2xl mr-3 text-blue-500" />
        <Title level={2} className="mb-0">
          Conversations
        </Title>
      </div>

      <Card className="max-w-2xl">
        <Alert
          message="Feature Under Development"
          description={
            <div>
              <Paragraph className="mb-2">
                The conversations feature is currently being redesigned and is
                temporarily unavailable.
              </Paragraph>
              <Paragraph className="mb-0">
                This feature will be available soon with improved functionality
                and better user experience.
              </Paragraph>
            </div>
          }
          type="info"
          showIcon
        />
      </Card>
    </div>
  );
};

export default AdminConversations;
