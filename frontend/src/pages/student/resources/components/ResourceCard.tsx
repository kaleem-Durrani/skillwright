import React from 'react';
import { Card, Typography, Tag, Space, Button, Tooltip } from 'antd';
import { 
  FileOutlined, 
  VideoCameraOutlined, 
  LinkOutlined, 
  DownloadOutlined,
  CommentOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { ResourceWithDetails, ResourceType } from '@/common/types';

const { Title, Text, Paragraph } = Typography;

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
      case 'DOCUMENT':
        return <FileOutlined />;
      case 'VIDEO':
        return <VideoCameraOutlined />;
      case 'LINK':
        return <LinkOutlined />;
      default:
        return <FileOutlined />;
    }
  };

  // Handle resource type tag color
  const getResourceTypeColor = (type: ResourceType) => {
    switch (type) {
      case 'DOCUMENT':
        return 'blue';
      case 'VIDEO':
        return 'red';
      case 'LINK':
        return 'green';
      default:
        return 'default';
    }
  };

  return (
    <Card
      hoverable
      className="h-full"
      actions={[
        <Tooltip title="View Resource">
          <Button 
            type="text" 
            icon={<EyeOutlined />} 
            onClick={() => onView(resource.id)}
          >
            View
          </Button>
        </Tooltip>,
        <Tooltip title="Comments">
          <Button 
            type="text" 
            icon={<CommentOutlined />} 
            onClick={() => onViewComments(resource.id)}
          >
            {resource._count?.comments || 0} Comments
          </Button>
        </Tooltip>,
      ]}
      extra={
        <Space direction="vertical" align="end">
          <Tag color={getResourceTypeColor(resource.type)}>
            {resource.type}
          </Tag>
          {resource.course && (
            <Tag color="purple">{resource.course.name}</Tag>
          )}
        </Space>
      }
    >
      <div className="flex flex-col h-full">
        <div className="mb-2">
          <Title level={4} className="mb-1">{resource.title}</Title>
        </div>
        
        <Space direction="vertical" className="mb-2">
          <Text type="secondary">
            {resource.teacher?.name && `By: ${resource.teacher.name}`}
          </Text>
          <Text type="secondary">
            Added: {new Date(resource.createdAt).toLocaleDateString()}
          </Text>
        </Space>
        
        <Paragraph className="text-gray-600 mb-auto" ellipsis={{ rows: 2 }}>
          {resource.description || 'No description available'}
        </Paragraph>
      </div>
    </Card>
  );
};

export default ResourceCard;
