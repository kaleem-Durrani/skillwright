import React from 'react';
import { Row, Col, Empty, Spin, Pagination } from 'antd';
import { CourseWithEnrollment } from '@/common/types';
import CourseCard from './CourseCard';

interface CourseListProps {
  courses: CourseWithEnrollment[];
  isLoading: boolean;
  isEnrolled?: boolean;
  currentPage: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onEnroll: (courseId: string) => void;
  onWithdraw: (courseId: string) => void;
  onViewDetails: (courseId: string) => void;
  onViewResources: (courseId: string) => void;
  emptyText?: string;
  emptyAction?: React.ReactNode;
}

/**
 * Course list component for displaying a grid of course cards
 */
const CourseList: React.FC<CourseListProps> = ({
  courses,
  isLoading,
  isEnrolled = false,
  currentPage,
  pageSize,
  total,
  onPageChange,
  onEnroll,
  onWithdraw,
  onViewDetails,
  onViewResources,
  emptyText = 'No courses found',
  emptyAction,
}) => {
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
      >
        {emptyAction}
      </Empty>
    );
  }

  return (
    <>
      <Row gutter={[16, 16]}>
        {courses.map((course) => (
          <Col xs={24} sm={12} lg={8} key={course.id} className="mb-4">
            <CourseCard
              course={course}
              isEnrolled={isEnrolled}
              onEnroll={onEnroll}
              onWithdraw={onWithdraw}
              onViewDetails={onViewDetails}
              onViewResources={onViewResources}
            />
          </Col>
        ))}
      </Row>
      
      {courses.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={total}
            onChange={onPageChange}
            showSizeChanger={false}
          />
        </div>
      )}
    </>
  );
};

export default CourseList;
