import React from 'react';
import { Table, Button, Tag, Space, Tooltip } from 'antd';
import { EyeOutlined, EditOutlined } from '@ant-design/icons';
import { Course } from '@/common/types';
import dayjs from 'dayjs';

interface CourseTableProps {
  courses: Course[];
  loading: boolean;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize?: number) => void;
  };
  onView: (course: Course) => void;
  onEdit: (course: Course) => void;
}

/**
 * Table component to display courses
 */
const CourseTable: React.FC<CourseTableProps> = ({ 
  courses, 
  loading, 
  pagination,
  onView,
  onEdit 
}) => {
  const columns = [
    {
      title: 'Course Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Course) => (
        <div>
          <div className="font-medium">{text}</div>
          <div className="text-sm text-gray-500">Code: {record.code}</div>
        </div>
      ),
    },
    {
      title: 'Department',
      dataIndex: ['department', 'name'],
      key: 'department',
      render: (text: string) => (
        <Tag color="purple">{text}</Tag>
      ),
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      render: (text: string) => (
        <Tag color="green">{text}</Tag>
      ),
    },
    {
      title: 'Capacity',
      dataIndex: 'capacity',
      key: 'capacity',
    },
    {
      title: 'Students',
      key: 'students',
      render: (record: Course) => (
        <span>{record._count?.enrollments || 0}</span>
      ),
    },
    {
      title: 'Resources',
      key: 'resources',
      render: (record: Course) => (
        <span>{record._count?.resources || 0}</span>
      ),
    },
    {
      title: 'Start Date',
      dataIndex: 'startDate',
      key: 'startDate',
      render: (date: string) => (
        date ? dayjs(date).format('MMM D, YYYY') : '-'
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (record: Course) => (
        <Space>
          <Tooltip title="View Details">
            <Button 
              type="text" 
              icon={<EyeOutlined />} 
              onClick={() => onView(record)}
            />
          </Tooltip>
          <Tooltip title="Edit Course">
            <Button 
              type="text" 
              icon={<EditOutlined />} 
              onClick={() => onEdit(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={courses}
      loading={loading}
      rowKey="id"
      pagination={{
        current: pagination.current,
        pageSize: pagination.pageSize,
        total: pagination.total,
        onChange: pagination.onChange,
        showSizeChanger: true,
        showQuickJumper: true,
        showTotal: (total, range) => 
          `${range[0]}-${range[1]} of ${total} courses`,
      }}
      scroll={{ x: 800 }}
    />
  );
};

export default CourseTable;
