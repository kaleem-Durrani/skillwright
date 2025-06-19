import React from "react";
import { Modal, Descriptions, Tag, Typography, Space, Button } from "antd";
import {
  FileOutlined,
  EyeOutlined,
  CalendarOutlined,
  TeamOutlined,
  BookOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { Resource } from "@/common/types";
import dayjs from "dayjs";

const { Title, Text } = Typography;

interface ViewResourceModalProps {
  visible: boolean;
  resource: Resource | null;
  loading: boolean;
  onCancel: () => void;
}

/**
 * Modal component to view resource details
 */
const ViewResourceModal: React.FC<ViewResourceModalProps> = ({
  visible,
  resource,
  loading,
  onCancel,
}) => {
  if (!resource) return null;

  const getResourceTypeColor = (type: string) => {
    switch (type) {
      case 'VIDEO':
        return 'red';
      case 'DOCUMENT':
        return 'blue';
      case 'LINK':
        return 'green';
      default:
        return 'default';
    }
  };

  const getResourceTypeIcon = (type: string) => {
    switch (type) {
      case 'VIDEO':
        return '🎥';
      case 'DOCUMENT':
        return '📄';
      case 'LINK':
        return '🔗';
      default:
        return '📁';
    }
  };

  return (
    <Modal
      title={
        <Space>
          <EyeOutlined />
          <span>Resource Details</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="download" type="primary" icon={<DownloadOutlined />}>
          <a href={resource.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
            Download/View
          </a>
        </Button>,
        <Button key="close" onClick={onCancel}>
          Close
        </Button>,
      ]}
      width={700}
      loading={loading}
    >
      <div className="space-y-6">
        {/* Basic Information */}
        <div>
          <Title level={4} className="mb-4">
            Basic Information
          </Title>
          <Descriptions bordered column={2}>
            <Descriptions.Item label="Resource Title" span={2}>
              <Text strong>{resource.title}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Type">
              <Tag color={getResourceTypeColor(resource.type)}>
                {getResourceTypeIcon(resource.type)} {resource.type}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Visibility">
              <Tag color={resource.isPublic ? 'green' : 'orange'}>
                {resource.isPublic ? '🌐 Public' : '🔒 Private'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Course" span={2}>
              <Space>
                <BookOutlined />
                <span>{resource.course?.name} ({resource.course?.code})</span>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* Description */}
        {resource.description && (
          <div>
            <Title level={4} className="mb-4">
              Description
            </Title>
            <div className="p-4 bg-gray-50 rounded-lg">
              <Text>{resource.description}</Text>
            </div>
          </div>
        )}

        {/* Statistics */}
        <div>
          <Title level={4} className="mb-4">
            Statistics
          </Title>
          <div className="grid grid-cols-1 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <Space>
                <TeamOutlined className="text-blue-500 text-xl" />
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {resource._count?.comments || 0}
                  </div>
                  <div className="text-sm text-gray-600">Comments</div>
                </div>
              </Space>
            </div>
          </div>
        </div>

        {/* File Information */}
        <div>
          <Title level={4} className="mb-4">
            File Information
          </Title>
          <Descriptions bordered column={1}>
            <Descriptions.Item label="File URL">
              <a href={resource.url} target="_blank" rel="noopener noreferrer">
                {resource.url}
              </a>
            </Descriptions.Item>
            {resource.mimeType && (
              <Descriptions.Item label="MIME Type">
                <Tag>{resource.mimeType}</Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>

        {/* Timestamps */}
        <div>
          <Title level={4} className="mb-4">
            Timestamps
          </Title>
          <Descriptions bordered column={2}>
            <Descriptions.Item label="Created At">
              <Space>
                <CalendarOutlined />
                <span>
                  {dayjs(resource.createdAt).format("MMMM D, YYYY [at] h:mm A")}
                </span>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Updated At">
              <Space>
                <CalendarOutlined />
                <span>
                  {dayjs(resource.updatedAt).format("MMMM D, YYYY [at] h:mm A")}
                </span>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>
      </div>
    </Modal>
  );
};

export default ViewResourceModal;
