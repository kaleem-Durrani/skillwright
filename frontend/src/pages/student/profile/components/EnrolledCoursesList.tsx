import React from 'react';
import { List, Avatar, Button, Space, Tag, Typography, Spin, Empty } from 'antd';
import { BookOutlined } from '@ant-design/icons';
import { CourseWithEnrollment, EnrollmentStatus } from '@/common/types';

const { Text } = Typography;

interface EnrolledCoursesListProps {
  courses: CourseWithEnrollment[];
  isLoading: boolean;
  onViewCourse: (courseId: string) => void;
  emptyText?: string;
}

/**
 * Enrolled courses list component for displaying student's enrolled courses
 */
const EnrolledCoursesList: React.FC<EnrolledCoursesListProps> = ({
  courses,
  isLoading,
  onViewCourse,
  emptyText = 'No courses found',
}) => {
  // Get enrollment status tag
  const getEnrollmentStatusTag = (status: EnrollmentStatus) => {
    switch (status) {
      case 'PENDING':
        return <Tag color="blue">Pending</Tag>;
      case 'APPROVED':
        return <Tag color="green">Approved</Tag>;
      case 'REJECTED':
        return <Tag color="red">Rejected</Tag>;
      case 'WITHDRAWN':
        return <Tag color="orange">Withdrawn</Tag>;
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spin size="large" />
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <Empty 
        description={emptyText} 
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <List
      itemLayout="horizontal"
      dataSource={courses}
      renderItem={(course) => (
        <List.Item
          actions={[
            <Button 
              type="link" 
              icon={<BookOutlined />}
              onClick={() => onViewCourse(course.id)}
            >
              View Details
            </Button>
          ]}
        >
          <List.Item.Meta
            avatar={<Avatar icon={<BookOutlined />} className="bg-blue-500" />}
            title={course.name}
            description={
              <Space direction="vertical">
                <Text type="secondary">Code: {course.code}</Text>
                <Text type="secondary">Duration: {course.duration}</Text>
                {course.enrollments && course.enrollments[0] && 
                  getEnrollmentStatusTag(course.enrollments[0].status)
                }
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
};

export default EnrolledCoursesList;
