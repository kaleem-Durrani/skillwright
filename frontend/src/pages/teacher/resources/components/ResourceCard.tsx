import React from "react";
import { Card, Typography, Tag, Space, Button, Tooltip, Badge } from "antd";
import {
  FileOutlined,
  VideoCameraOutlined,
  LinkOutlined,
  CommentOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  BookOutlined,
} from "@ant-design/icons";
import { Resource } from "@/common/types";
import dayjs from "dayjs";

const { Title, Text, Paragraph } = Typography;

interface ResourceCardProps {
  resource: Resource;
  onView: (resource: Resource) => void;
  onEdit: (resource: Resource) => void;
  onDelete: (id: string) => void;
  onCardClick?: (resource: Resource) => void;
}

/**
 * Card component to display resource information
 */
const ResourceCard: React.FC<ResourceCardProps> = ({
  resource,
  onView,
  onEdit,
  onDelete,
  onCardClick,
}) => {
  const getResourceIcon = () => {
    switch (resource.type) {
      case "DOCUMENT":
        return <FileOutlined className="text-blue-500" />;
      case "VIDEO":
        return <VideoCameraOutlined className="text-green-500" />;
      case "LINK":
        return <LinkOutlined className="text-purple-500" />;
      default:
        return <FileOutlined className="text-blue-500" />;
    }
  };

  const getResourceTypeText = () => {
    switch (resource.type) {
      case "DOCUMENT":
        return "Document";
      case "VIDEO":
        return "Video";
      case "LINK":
        return "Link";
      default:
        return "Resource";
    }
  };

  return (
    <Badge.Ribbon
      text={resource.isPublic ? "Public" : "Private"}
      color={resource.isPublic ? "green" : "blue"}
    >
      <Card
        hoverable
        className="h-full shadow-sm hover:shadow-md transition-shadow cursor-pointer"
        onClick={(e) => {
          // Prevent card click when clicking on action buttons
          if ((e.target as HTMLElement).closest(".ant-card-actions")) {
            return;
          }
          onCardClick?.(resource);
        }}
        actions={[
          <Tooltip title="View Resource">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => onView(resource)}
            >
              View
            </Button>
          </Tooltip>,
          <Tooltip title="Edit Resource">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => onEdit(resource)}
            >
              Edit
            </Button>
          </Tooltip>,
          <Tooltip title="Delete Resource">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(resource.id)}
            >
              Delete
            </Button>
          </Tooltip>,
        ]}
      >
        <div className="flex flex-col h-full">
          <div className="mb-2 flex items-center">
            {getResourceIcon()}
            <Title level={4} className="m-0 ml-2 flex-1 truncate">
              {resource.title}
            </Title>
          </div>

          <Paragraph type="secondary" ellipsis={{ rows: 2 }} className="mb-4">
            {resource.description || "No description provided."}
          </Paragraph>

          <div className="flex flex-wrap gap-2 mb-4">
            <Tag
              color={
                resource.type === "DOCUMENT"
                  ? "blue"
                  : resource.type === "VIDEO"
                  ? "green"
                  : "purple"
              }
            >
              {getResourceTypeText()}
            </Tag>

            {resource.course && (
              <Tag color="orange">
                <BookOutlined className="mr-1" />
                {resource.course.name}
              </Tag>
            )}
          </div>

          <Space direction="vertical" className="mt-auto">
            <div className="flex items-center">
              <CommentOutlined className="mr-2 text-gray-500" />
              <Text type="secondary">
                {resource._count?.comments || 0} Comments
              </Text>
            </div>

            <div className="flex items-center">
              <Text type="secondary">
                Created: {dayjs(resource.createdAt).format("MMM D, YYYY")}
              </Text>
            </div>
          </Space>
        </div>
      </Card>
    </Badge.Ribbon>
  );
};

export default ResourceCard;
