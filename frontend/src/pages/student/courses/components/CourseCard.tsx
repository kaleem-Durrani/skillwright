import React from 'react';
import { Card, Typography, Button, Tag, Tooltip } from 'antd';
import { 
  BookOutlined, 
  CalendarOutlined, 
  TeamOutlined, 
  FileOutlined,
  ExclamationCircleOutlined 
} from '@ant-design/icons';
import { CourseWithEnrollment, EnrollmentStatus } from '@/common/types';

const { Title, Text, Paragraph } = Typography;

interface CourseCardProps {
  course: CourseWithEnrollment;
  isEnrolled?: boolean;
  onEnroll: (courseId: string) => void;
  onWithdraw: (courseId: string) => void;
  onViewDetails: (courseId: string) => void;
  onViewResources: (courseId: string) => void;
}

/**
 * Course card component for displaying course information
 */
const CourseCard: React.FC<CourseCardProps> = ({
  course,
  isEnrolled = false,
  onEnroll,
  onWithdraw,
  onViewDetails,
  onViewResources,
}) => {
  const enrollmentStatus = course.enrollments && course.enrollments[0]?.status;
  const isApproved = enrollmentStatus === 'APPROVED';

  // Get status tag for enrollment
  const getStatusTag = (status: EnrollmentStatus) => {
    switch (status) {
      case 'PENDING':
        return <Tag color="blue">Pending Approval</Tag>;
      case 'APPROVED':
        return <Tag color="green">Enrolled</Tag>;
      case 'REJECTED':
        return <Tag color="red">Rejected</Tag>;
      case 'WITHDRAWN':
        return <Tag color="orange">Withdrawn</Tag>;
      default:
        return null;
    }
  };

  return (
    <Card 
      hoverable 
      className="h-full"
      actions={[
        isEnrolled ? (
          <Tooltip title="Withdraw from course">
            <Button 
              type="text" 
              danger 
              icon={<ExclamationCircleOutlined />} 
              onClick={() => onWithdraw(course.id)}
              disabled={enrollmentStatus === 'WITHDRAWN'}
            >
              Withdraw
            </Button>
          </Tooltip>
        ) : (
          <Tooltip title="Enroll in course">
            <Button 
              type="text" 
              icon={<TeamOutlined />} 
              onClick={() => onEnroll(course.id)}
            >
              Enroll
            </Button>
          </Tooltip>
        ),
        <Tooltip title="View course details">
          <Button 
            type="text" 
            icon={<BookOutlined />} 
            onClick={() => onViewDetails(course.id)}
          >
            Details
          </Button>
        </Tooltip>,
        isApproved && (
          <Tooltip title="View course resources">
            <Button 
              type="text" 
              icon={<FileOutlined />} 
              onClick={() => onViewResources(course.id)}
            >
              Resources
            </Button>
          </Tooltip>
        )
      ].filter(Boolean)}
    >
      <div className="flex flex-col h-full">
        <div className="mb-2 flex justify-between items-start">
          <Title level={4} className="mb-1">{course.name}</Title>
          {isEnrolled && enrollmentStatus && getStatusTag(enrollmentStatus)}
        </div>
        
        <Paragraph className="text-gray-500 mb-2">
          <strong>Code:</strong> {course.code}
        </Paragraph>
        
        <Paragraph className="text-gray-600 mb-auto" ellipsis={{ rows: 2 }}>
          {course.description || 'No description available'}
        </Paragraph>
        
        <div className="mt-3 text-gray-500">
          <div className="flex items-center mb-1">
            <CalendarOutlined className="mr-2" />
            <Text>Duration: {course.duration}</Text>
          </div>
          {course._count && (
            <div className="flex items-center">
              <FileOutlined className="mr-2" />
              <Text>{course._count.resources || 0} Resources</Text>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default CourseCard;
