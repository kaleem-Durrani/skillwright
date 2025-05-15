import React from 'react';
import { Card, List, Typography, Tag, Skeleton, Button, Avatar } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined, UserOutlined } from '@ant-design/icons';
import { Teacher } from '@/common/types';
import { ROUTES } from '@/common/constants';

const { Title, Text } = Typography;

interface TeachersListProps {
  teachers: Teacher[];
  loading: boolean;
}

/**
 * Component to display recent teachers on the dashboard
 */
const TeachersList: React.FC<TeachersListProps> = ({ teachers, loading }) => {
  return (
    <Card 
      title={<Title level={5}>Recent Teachers</Title>}
      extra={
        <Link to={ROUTES.ADMIN.TEACHERS}>
          <Button type="link" size="small">
            View All <RightOutlined />
          </Button>
        </Link>
      }
      className="shadow-sm h-full"
    >
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        <List
          dataSource={teachers.slice(0, 5)}
          renderItem={(teacher) => (
            <List.Item>
              <List.Item.Meta
                avatar={<Avatar icon={<UserOutlined />} />}
                title={
                  <Link to={ROUTES.ADMIN.TEACHER_DETAILS(teacher.id)}>
                    {teacher.name}
                  </Link>
                }
                description={
                  <>
                    <Text type="secondary">{teacher.email}</Text>
                    <div className="mt-1">
                      <Tag color="blue">{teacher.qualification}</Tag>
                      {teacher.department?.name && (
                        <Tag color="purple">{teacher.department.name}</Tag>
                      )}
                      {teacher.isBanned && (
                        <Tag color="red">Banned</Tag>
                      )}
                    </div>
                  </>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: 'No teachers found' }}
        />
      </Skeleton>
    </Card>
  );
};

export default TeachersList;
