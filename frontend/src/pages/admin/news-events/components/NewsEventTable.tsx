import React from 'react';
import { Table, Tag, Button, Space, Tooltip, Modal, Badge } from 'antd';
import { 
  EditOutlined, 
  DeleteOutlined, 
  EyeOutlined, 
  CheckCircleOutlined,
  StopOutlined,
  ExclamationCircleOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { NewsEvent } from '@/common/types';
import { ROUTES } from '@/common/constants';
import dayjs from 'dayjs';

const { confirm } = Modal;

interface NewsEventTableProps {
  newsEvents: NewsEvent[];
  loading: boolean;
  onDelete: (id: string) => void;
  onEdit: (newsEvent: NewsEvent) => void;
  onTogglePublish: (id: string, isPublished: boolean) => void;
}

/**
 * Table component for displaying news and events
 */
const NewsEventTable: React.FC<NewsEventTableProps> = ({ 
  newsEvents, 
  loading, 
  onDelete,
  onEdit,
  onTogglePublish
}) => {
  const showDeleteConfirm = (id: string, title: string) => {
    confirm({
      title: `Are you sure you want to delete "${title}"?`,
      icon: <ExclamationCircleOutlined />,
      content: 'This action cannot be undone.',
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk() {
        onDelete(id);
      },
    });
  };

  const showPublishConfirm = (id: string, title: string, isPublished: boolean) => {
    confirm({
      title: `Are you sure you want to ${isPublished ? 'unpublish' : 'publish'} "${title}"?`,
      icon: <ExclamationCircleOutlined />,
      content: isPublished 
        ? 'This will hide the item from public view.' 
        : 'This will make the item visible to the public.',
      okText: isPublished ? 'Yes, Unpublish' : 'Yes, Publish',
      okType: isPublished ? 'danger' : 'primary',
      cancelText: 'Cancel',
      onOk() {
        onTogglePublish(id, !isPublished);
      },
    });
  };

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

  const columns = [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, record: NewsEvent) => (
        <Link to={ROUTES.ADMIN.NEWS_EVENT_DETAILS(record.id)}>
          {text}
        </Link>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag color={getTypeColor(type)}>{type}</Tag>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => (
        <span>
          <CalendarOutlined className="mr-1" />
          {dayjs(date).format('MMM D, YYYY')}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: NewsEvent) => (
        <Badge 
          status={record.isPublished ? 'success' : 'default'} 
          text={record.isPublished ? 'Published' : 'Draft'} 
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: NewsEvent) => (
        <Space size="small">
          <Tooltip title="View Details">
            <Link to={ROUTES.ADMIN.NEWS_EVENT_DETAILS(record.id)}>
              <Button type="text" icon={<EyeOutlined />} />
            </Link>
          </Tooltip>
          <Tooltip title="Edit">
            <Button 
              type="text" 
              icon={<EditOutlined />} 
              onClick={() => onEdit(record)}
            />
          </Tooltip>
          <Tooltip title={record.isPublished ? 'Unpublish' : 'Publish'}>
            <Button 
              type="text" 
              icon={record.isPublished ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={() => showPublishConfirm(record.id, record.title, record.isPublished)}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button 
              type="text" 
              danger 
              icon={<DeleteOutlined />}
              onClick={() => showDeleteConfirm(record.id, record.title)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Table 
      columns={columns} 
      dataSource={newsEvents} 
      rowKey="id" 
      loading={loading}
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showTotal: (total) => `Total ${total} items`,
      }}
      className="shadow-sm"
    />
  );
};

export default NewsEventTable;
