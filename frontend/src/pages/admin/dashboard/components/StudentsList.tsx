import React from 'react';
import { Card, List, Typography, Tag, Skeleton, Button, Avatar } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined, UserOutlined } from '@ant-design/icons';
import { Student } from '@/common/types';
import { ROUTES } from '@/common/constants';

const { Title, Text } = Typography;

interface StudentsListProps {
  students: Student[];
  loading: boolean;
}

/**
 * Component to display recent students on the dashboard
 */
const StudentsList: React.FC<StudentsListProps> = ({ students, loading }) => {
  return (
    <Card 
      title={<Title level={5}>Recent Students</Title>}
      extra={
        <Link to={ROUTES.ADMIN.STUDENTS}>
          <Button type="link" size="small">
            View All <RightOutlined />
          </Button>
        </Link>
      }
      className="shadow-sm h-full"
    >
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        <List
          dataSource={students.slice(0, 5)}
          renderItem={(student) => (
            <List.Item>
              <List.Item.Meta
                avatar={<Avatar icon={<UserOutlined />} />}
                title={
                  <Link to={ROUTES.ADMIN.STUDENT_DETAILS(student.id)}>
                    {student.name}
                  </Link>
                }
                description={
                  <>
                    <Text type="secondary">{student.email}</Text>
                    <div className="mt-1">
                      <Tag color="blue">Enrollment: {student.enrollmentNo}</Tag>
                      {student.department?.name && (
                        <Tag color="purple">{student.department.name}</Tag>
                      )}
                      {student.isBanned && (
                        <Tag color="red">Banned</Tag>
                      )}
                    </div>
                  </>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: 'No students found' }}
        />
      </Skeleton>
    </Card>
  );
};

export default StudentsList;
