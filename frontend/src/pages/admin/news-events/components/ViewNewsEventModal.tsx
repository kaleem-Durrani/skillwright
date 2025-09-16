import React from 'react';
import { Modal, Typography, Tag, Descriptions, Badge } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { NewsEvent } from '@/common/types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface ViewNewsEventModalProps {
  visible: boolean;
  newsEvent: NewsEvent | null;
  onCancel: () => void;
}

/**
 * Modal component for viewing news/event details
 */
const ViewNewsEventModal: React.FC<ViewNewsEventModalProps> = ({
  visible,
  newsEvent,
  onCancel,
}) => {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'NEWS':
        return 'blue';
      case 'EVENT':
        return 'green';
      case 'ANNOUNCEMENT':
        return 'orange';
      default:
        return 'default';
    }
  };

  if (!newsEvent) return null;

  return (
    <Modal
      title="News/Event Details"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={700}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="border-b pb-4">
          <Title level={3} className="mb-2">
            {newsEvent.title}
          </Title>
          <div className="flex items-center gap-4">
            <Tag color={getTypeColor(newsEvent.type)} className="text-sm">
              {newsEvent.type}
            </Tag>
            <Badge 
              status={newsEvent.isPublished ? 'success' : 'default'} 
              text={newsEvent.isPublished ? 'Published' : 'Draft'} 
            />
            <div className="flex items-center text-gray-500">
              <CalendarOutlined className="mr-1" />
              <Text type="secondary">
                {dayjs(newsEvent.date).format('MMMM D, YYYY [at] h:mm A')}
              </Text>
            </div>
          </div>
        </div>

        {/* Content */}
        <div>
          <Title level={5} className="mb-2">Content</Title>
          <div className="bg-gray-50 p-4 rounded-lg">
            <Text className="whitespace-pre-wrap">
              {newsEvent.content}
            </Text>
          </div>
        </div>

        {/* Additional Details */}
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Created">
            {dayjs(newsEvent.createdAt).format('MMMM D, YYYY [at] h:mm A')}
          </Descriptions.Item>
          <Descriptions.Item label="Last Updated">
            {dayjs(newsEvent.updatedAt).format('MMMM D, YYYY [at] h:mm A')}
          </Descriptions.Item>
          {newsEvent._count && (
            <Descriptions.Item label="Comments">
              {newsEvent._count.comments || 0}
            </Descriptions.Item>
          )}
        </Descriptions>
      </div>
    </Modal>
  );
};

export default ViewNewsEventModal;
