import React from 'react';
import { Card, List, Typography, Tag, Skeleton, Button } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined, TeamOutlined, BookOutlined } from '@ant-design/icons';
import { Department } from '@/common/types';
import { ROUTES } from '@/common/constants';

const { Title, Text } = Typography;

interface DepartmentsListProps {
  departments: Department[];
  loading: boolean;
}

/**
 * Component to display departments on the dashboard
 */
const DepartmentsList: React.FC<DepartmentsListProps> = ({ departments, loading }) => {
  return (
    <Card 
      title={<Title level={5}>Departments</Title>}
      extra={
        <Link to={ROUTES.ADMIN.DEPARTMENTS}>
          <Button type="link" size="small">
            View All <RightOutlined />
          </Button>
        </Link>
      }
      className="shadow-sm h-full"
    >
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        <List
          dataSource={departments.slice(0, 5)}
          renderItem={(department) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Link to={ROUTES.ADMIN.DEPARTMENT_DETAILS(department.id)}>
                    {department.name}
                  </Link>
                }
                description={
                  <>
                    <Text type="secondary">
                      {department.description || 'No description provided'}
                    </Text>
                    <div className="mt-1">
                      <Tag color="blue">
                        <TeamOutlined className="mr-1" />
                        {department._count?.teachers || 0} Teachers
                      </Tag>
                      <Tag color="green">
                        <TeamOutlined className="mr-1" />
                        {department._count?.students || 0} Students
                      </Tag>
                      <Tag color="purple">
                        <BookOutlined className="mr-1" />
                        {department._count?.courses || 0} Courses
                      </Tag>
                    </div>
                  </>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: 'No departments found' }}
        />
      </Skeleton>
    </Card>
  );
};

export default DepartmentsList;
