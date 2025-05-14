import React from 'react';
import { Card, Typography, Skeleton, Divider, Progress, Space } from 'antd';
import { FileTextOutlined, VideoCameraOutlined, LinkOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface ResourceStats {
  total: number;
  documents: number;
  videos: number;
  links: number;
}

interface ResourcesOverviewProps {
  stats: ResourceStats;
  loading: boolean;
}

/**
 * Component to display resources overview on the dashboard
 */
const ResourcesOverview: React.FC<ResourcesOverviewProps> = ({ stats, loading }) => {
  const calculatePercentage = (value: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  };

  return (
    <Card title={<Title level={5}>Resources Overview</Title>} className="shadow-sm h-full">
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        <div className="flex flex-col gap-4">
          <div>
            <Space>
              <FileTextOutlined className="text-blue-500" />
              <Text strong>Documents</Text>
            </Space>
            <Progress 
              percent={calculatePercentage(stats.documents, stats.total)} 
              strokeColor="#1890ff"
              size="small"
            />
          </div>
          
          <div>
            <Space>
              <VideoCameraOutlined className="text-green-500" />
              <Text strong>Videos</Text>
            </Space>
            <Progress 
              percent={calculatePercentage(stats.videos, stats.total)} 
              strokeColor="#52c41a"
              size="small"
            />
          </div>
          
          <div>
            <Space>
              <LinkOutlined className="text-purple-500" />
              <Text strong>Links</Text>
            </Space>
            <Progress 
              percent={calculatePercentage(stats.links, stats.total)} 
              strokeColor="#722ed1"
              size="small"
            />
          </div>
          
          <Divider />
          
          <div className="text-center">
            <Title level={4}>{stats.total}</Title>
            <Text type="secondary">Total Resources</Text>
          </div>
        </div>
      </Skeleton>
    </Card>
  );
};

export default ResourcesOverview;
