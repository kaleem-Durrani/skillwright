import React from 'react';
import { Card, List, Typography, Tag, Skeleton, Button } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined } from '@ant-design/icons';
import { Course } from '@/common/types';
import { ROUTES } from '@/common/constants';

const { Title, Text } = Typography;

interface RecentCoursesProps {
  courses: Course[];
  loading: boolean;
}

/**
 * Component to display recent courses on the dashboard
 */
const RecentCourses: React.FC<RecentCoursesProps> = ({ courses, loading }) => {
  return (
    <Card 
      title={<Title level={5}>Recent Courses</Title>}
      extra={
        <Link to={ROUTES.TEACHER.COURSES}>
          <Button type="link" size="small">
            View All <RightOutlined />
          </Button>
        </Link>
      }
      className="shadow-sm h-full"
    >
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        <List
          dataSource={courses.slice(0, 5)}
          renderItem={(course) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Link to={ROUTES.TEACHER.COURSE_DETAILS(course.id)}>
                    {course.name}
                  </Link>
                }
                description={
                  <>
                    <Text type="secondary">Code: {course.code}</Text>
                    <div className="mt-1">
                      <Tag color="blue">{course._count?.enrollments || 0} Students</Tag>
                      <Tag color="green">{course._count?.resources || 0} Resources</Tag>
                    </div>
                  </>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: 'No courses found' }}
        />
      </Skeleton>
    </Card>
  );
};

export default RecentCourses;
