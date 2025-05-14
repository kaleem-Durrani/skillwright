import React, { useState, useEffect } from "react";
import { Typography, Button, App, Pagination } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTeacherQuery } from "@/hooks";
import { Course, QueryParams } from "@/common/types";
import { CourseList, CourseFilter, CreateCourseModal } from "./components";

const { Title } = Typography;

const TeacherCourses: React.FC = () => {
  const { notification } = App.useApp();
  const { getMyCoursesQuery, createCourseMutation } = useTeacherQuery();

  // State
  const [courses, setCourses] = useState<Course[]>([]);
  const [totalCourses, setTotalCourses] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Fetch courses with pagination and filters
  const coursesQuery = getMyCoursesQuery({
    page: currentPage,
    limit: pageSize,
    ...filterParams,
  });

  useEffect(() => {
    if (coursesQuery.data?.data?.data) {
      setCourses(coursesQuery.data.data.data);
      setTotalCourses(coursesQuery.data.data.meta?.total || 0);
    }
  }, [coursesQuery.data]);

  useEffect(() => {
    if (coursesQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load courses. Please try again later.",
      });
    }
  }, [coursesQuery.isError, notification]);

  // Handlers
  const handlePageChange = (page: number, pageSize?: number) => {
    setCurrentPage(page);
    if (pageSize) setPageSize(pageSize);
  };

  const handleFilter = (values: any) => {
    const params: QueryParams = {};

    if (values.search) {
      params.search = values.search;
    }

    if (values.departmentId) {
      params.departmentId = values.departmentId;
    }

    setFilterParams(params);
    setCurrentPage(1); // Reset to first page when filtering
  };

  const handleResetFilter = () => {
    setFilterParams({});
    setCurrentPage(1);
  };

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  const handleCreateCourse = async (values: any) => {
    try {
      await createCourseMutation.mutateAsync(values);
      notification.success({
        message: "Success",
        description: "Course created successfully.",
      });
      setIsModalVisible(false);
      // Refetch courses
      coursesQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to create course. Please try again.",
      });
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>My Courses</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Create Course
        </Button>
      </div>

      <CourseFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <CourseList courses={courses} loading={coursesQuery.isLoading} />

      {totalCourses > 0 && (
        <div className="flex justify-center mt-6">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={totalCourses}
            onChange={handlePageChange}
            showSizeChanger
            showQuickJumper
            showTotal={(total) => `Total ${total} courses`}
          />
        </div>
      )}

      <CreateCourseModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleCreateCourse}
        isSubmitting={createCourseMutation.isPending}
      />
    </div>
  );
};

export default TeacherCourses;
