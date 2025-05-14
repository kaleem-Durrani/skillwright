import React from 'react';
import { Card, Typography, Tag, Space, Button, Tooltip } from 'antd';
import { 
  BookOutlined, 
  TeamOutlined, 
  FileOutlined, 
  CalendarOutlined,
  EyeOutlined,
  EditOutlined
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { Course } from '@/common/types';
import { ROUTES } from '@/common/constants';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

interface CourseCardProps {
  course: Course;
}

/**
 * Card component to display course information
 */
const CourseCard: React.FC<CourseCardProps> = ({ course }) => {
  return (
    <Card 
      hoverable
      className="h-full shadow-sm hover:shadow-md transition-shadow"
      actions={[
        <Tooltip title="View Course Details">
          <Link to={ROUTES.TEACHER.COURSE_DETAILS(course.id)}>
            <Button type="text" icon={<EyeOutlined />}>View</Button>
          </Link>
        </Tooltip>,
        <Tooltip title="Edit Course">
          <Link to={ROUTES.TEACHER.COURSE_DETAILS(course.id)}>
            <Button type="text" icon={<EditOutlined />}>Edit</Button>
          </Link>
        </Tooltip>,
      ]}
    >
      <div className="flex flex-col h-full">
        <div className="mb-2 flex items-center">
          <BookOutlined className="text-blue-500 mr-2 text-lg" />
          <Title level={4} className="m-0 flex-1 truncate">
            {course.name}
          </Title>
        </div>
        
        <Paragraph 
          type="secondary" 
          ellipsis={{ rows: 2 }}
          className="mb-4"
        >
          {course.description || 'No description provided.'}
        </Paragraph>
        
        <div className="flex flex-wrap gap-2 mb-4">
          <Tag color="blue">Code: {course.code}</Tag>
          <Tag color="green">Duration: {course.duration}</Tag>
          {course.department?.name && (
            <Tag color="purple">{course.department.name}</Tag>
          )}
        </div>
        
        <Space direction="vertical" className="mt-auto">
          <div className="flex items-center">
            <TeamOutlined className="mr-2 text-gray-500" />
            <Text type="secondary">
              {course._count?.enrollments || 0} Students
            </Text>
          </div>
          
          <div className="flex items-center">
            <FileOutlined className="mr-2 text-gray-500" />
            <Text type="secondary">
              {course._count?.resources || 0} Resources
            </Text>
          </div>
          
          {course.startDate && (
            <div className="flex items-center">
              <CalendarOutlined className="mr-2 text-gray-500" />
              <Text type="secondary">
                Starts: {dayjs(course.startDate).format('MMM D, YYYY')}
              </Text>
            </div>
          )}
        </Space>
      </div>
    </Card>
  );
};

export default CourseCard;
