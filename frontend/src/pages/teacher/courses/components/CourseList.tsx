import React from 'react';
import { Row, Col, Empty, Spin } from 'antd';
import { Course } from '@/common/types';
import CourseCard from './CourseCard';

interface CourseListProps {
  courses: Course[];
  loading: boolean;
}

/**
 * Component to display a grid of course cards
 */
const CourseList: React.FC<CourseListProps> = ({ courses, loading }) => {
  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spin size="large" />
      </div>
    );
  }

  if (!courses || courses.length === 0) {
    return (
      <Empty 
        description="No courses found" 
        className="py-12"
      />
    );
  }

  return (
    <Row gutter={[16, 16]}>
      {courses.map((course) => (
        <Col xs={24} sm={12} lg={8} xl={6} key={course.id}>
          <CourseCard course={course} />
        </Col>
      ))}
    </Row>
  );
};

export default CourseList;
