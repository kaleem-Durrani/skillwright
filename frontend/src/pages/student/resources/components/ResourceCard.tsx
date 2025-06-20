import React from "react";
import { Card, Typography, Tag, Button, Avatar } from "antd";
import {
  FileOutlined,
  VideoCameraOutlined,
  LinkOutlined,
  CommentOutlined,
  EyeOutlined,
  UserOutlined,
  CalendarOutlined,
  BookOutlined,
} from "@ant-design/icons";
import { ResourceWithDetails, ResourceType } from "@/common/types";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const { Paragraph } = Typography;

interface ResourceCardProps {
  resource: ResourceWithDetails;
  onView: (resourceId: string) => void;
  onViewComments: (resourceId: string) => void;
}

/**
 * Resource card component for displaying resource information
 */
const ResourceCard: React.FC<ResourceCardProps> = ({
  resource,
  onView,
  onViewComments,
}) => {
  // Handle resource type icon
  const getResourceTypeIcon = (type: ResourceType) => {
    switch (type) {
      case "DOCUMENT":
        return <FileOutlined />;
      case "VIDEO":
        return <VideoCameraOutlined />;
      case "LINK":
        return <LinkOutlined />;
      default:
        return <FileOutlined />;
    }
  };

  // Handle resource type tag color
  const getResourceTypeColor = (type: ResourceType) => {
    switch (type) {
      case "DOCUMENT":
        return "blue";
      case "VIDEO":
        return "red";
      case "LINK":
        return "green";
      default:
        return "default";
    }
  };

  return (
    <Card
      hoverable
      className="h-full shadow-sm border-0"
      style={{
        borderRadius: "12px",
        overflow: "hidden",
        transition: "all 0.3s ease",
        background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
      }}
      bodyStyle={{ padding: 0 }}
    >
      {/* Header with Icon and Type */}
      <div
        style={{
          background: `linear-gradient(135deg, ${
            getResourceTypeColor(resource.type) === "blue"
              ? "#1890ff"
              : getResourceTypeColor(resource.type) === "red"
              ? "#ff4d4f"
              : "#52c41a"
          } 0%, ${
            getResourceTypeColor(resource.type) === "blue"
              ? "#40a9ff"
              : getResourceTypeColor(resource.type) === "red"
              ? "#ff7875"
              : "#73d13d"
          } 100%)`,
          padding: "16px 20px",
          color: "white",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                borderRadius: "8px",
                padding: "8px",
                fontSize: "20px",
              }}
            >
              {getResourceTypeIcon(resource.type)}
            </div>
            <div>
              <div
                style={{
                  fontSize: "12px",
                  opacity: 0.9,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {resource.type}
              </div>
              <div
                style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px" }}
              >
                {resource.title}
              </div>
            </div>
          </div>
          {resource.course && (
            <Tag
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                border: "none",
                color: "white",
                borderRadius: "6px",
              }}
            >
              <BookOutlined style={{ marginRight: "4px" }} />
              {resource.course.name}
            </Tag>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "20px" }}>
        {/* Description */}
        <Paragraph
          style={{
            color: "#666",
            fontSize: "14px",
            lineHeight: "1.6",
            marginBottom: "16px",
            minHeight: "42px",
          }}
          ellipsis={{ rows: 2 }}
        >
          {resource.description || "No description available"}
        </Paragraph>

        {/* Teacher and Date Info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
            padding: "12px",
            backgroundColor: "#f8fafc",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Avatar size={24} icon={<UserOutlined />} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: 500, color: "#333" }}>
                {resource.teacher?.name || "Unknown"}
              </div>
              <div style={{ fontSize: "11px", color: "#999" }}>Teacher</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "11px",
                color: "#999",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <CalendarOutlined />
              {dayjs(resource.createdAt).fromNow()}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            type="primary"
            icon={<EyeOutlined />}
            onClick={() => onView(resource.id)}
            style={{
              flex: 1,
              borderRadius: "8px",
              height: "36px",
              fontWeight: 500,
            }}
          >
            View
          </Button>
          <Button
            icon={<CommentOutlined />}
            onClick={() => onViewComments(resource.id)}
            style={{
              flex: 1,
              borderRadius: "8px",
              height: "36px",
              fontWeight: 500,
            }}
          >
            {resource._count?.comments || 0} Comments
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default ResourceCard;
