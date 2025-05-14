import React from 'react';
import { Card, Row, Col, Statistic } from 'antd';
import { BookOutlined, FileOutlined } from '@ant-design/icons';
import { Teacher } from '@/common/types';

interface ProfileStatsProps {
  teacher: Teacher;
  loading: boolean;
}

/**
 * Component to display teacher profile statistics
 */
const ProfileStats: React.FC<ProfileStatsProps> = ({ teacher, loading }) => {
  if (!teacher) return null;

  return (
    <Card loading={loading} className="shadow-sm">
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Statistic
            title="Total Courses"
            value={teacher._count?.courses || 0}
            prefix={<BookOutlined className="mr-2 text-blue-500" />}
            valueStyle={{ color: '#1890ff' }}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Statistic
            title="Total Resources"
            value={teacher._count?.resources || 0}
            prefix={<FileOutlined className="mr-2 text-green-500" />}
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
      </Row>
    </Card>
  );
};

export default ProfileStats;
