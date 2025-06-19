import React, { useState } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useApi, useMutation } from "@/hooks";
import { teacherService, courseService } from "@/services";
import { Course, QueryParams, CourseUpdateData } from "@/common/types";
import {
  CourseTable,
  CourseFilter,
  CreateCourseModal,
  ViewCourseModal,
  EditCourseModal,
} from "./components";

const { Title } = Typography;

const TeacherCourses: React.FC = () => {
  const { notification } = App.useApp();

  // State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isViewModalVisible, setIsViewModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  // API calls
  const coursesQuery = useApi(
    () =>
      teacherService.getMyCourses({
        page: currentPage,
        limit: pageSize,
        ...filterParams,
      }),
    {
      immediate: true,
      dependencies: [currentPage, pageSize, filterParams],
    }
  );

  // Get single course for view modal
  const [viewCourseData, setViewCourseData] = useState<Course | null>(null);
  const [isLoadingViewCourse, setIsLoadingViewCourse] = useState(false);

  const createCourseMutation = useMutation(courseService.createCourse, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Course created successfully.",
      });
      setIsCreateModalVisible(false);
      coursesQuery.refetch();
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to create course. Please try again.",
      });
    },
  });

  const updateCourseMutation = useMutation(
    ({ id, data }: { id: string; data: CourseUpdateData }) =>
      courseService.updateCourse(id, data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Course updated successfully.",
        });
        setIsEditModalVisible(false);
        setSelectedCourse(null);
        coursesQuery.refetch();
      },
      onError: () => {
        notification.error({
          message: "Error",
          description: "Failed to update course. Please try again.",
        });
      },
    }
  );

  // Extract data
  const responseData = coursesQuery.data?.data as any;
  const courses = responseData?.items || [];
  const pagination = responseData?.pagination || {
    total: 0,
    page: 1,
    limit: 10,
    hasMore: false,
  };

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

  const showCreateModal = () => {
    setIsCreateModalVisible(true);
  };

  const handleCreateCancel = () => {
    setIsCreateModalVisible(false);
  };

  const handleCreateCourse = async (values: any) => {
    try {
      await createCourseMutation.mutateAsync(values);
    } catch (error) {
      console.error("Create course error:", error);
    }
  };

  const handleViewCourse = async (course: Course) => {
    setSelectedCourse(course);
    setIsViewModalVisible(true);
    setIsLoadingViewCourse(true);

    try {
      const response = await courseService.getCourse(course.id);
      setViewCourseData(response.data);
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to load course details",
      });
    } finally {
      setIsLoadingViewCourse(false);
    }
  };

  const handleViewCancel = () => {
    setIsViewModalVisible(false);
    setSelectedCourse(null);
    setViewCourseData(null);
  };

  const handleEditCourse = (course: Course) => {
    setSelectedCourse(course);
    setIsEditModalVisible(true);
  };

  const handleEditCancel = () => {
    setIsEditModalVisible(false);
    setSelectedCourse(null);
  };

  const handleUpdateCourse = async (values: CourseUpdateData) => {
    if (!selectedCourse) return;

    try {
      await updateCourseMutation.mutateAsync({
        id: selectedCourse.id,
        data: values,
      });
    } catch (error) {
      console.error("Update course error:", error);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>My Courses</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={showCreateModal}
        >
          Create Course
        </Button>
      </div>

      <CourseFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <CourseTable
        courses={courses}
        loading={coursesQuery.loading}
        pagination={{
          current: currentPage,
          pageSize: pageSize,
          total: pagination?.total || 0,
          onChange: handlePageChange,
        }}
        onView={handleViewCourse}
        onEdit={handleEditCourse}
      />

      <CreateCourseModal
        visible={isCreateModalVisible}
        onCancel={handleCreateCancel}
        onSubmit={handleCreateCourse}
        isSubmitting={createCourseMutation.loading}
      />

      <ViewCourseModal
        visible={isViewModalVisible}
        course={viewCourseData || selectedCourse}
        loading={isLoadingViewCourse}
        onCancel={handleViewCancel}
      />

      <EditCourseModal
        visible={isEditModalVisible}
        course={selectedCourse}
        onCancel={handleEditCancel}
        onSubmit={handleUpdateCourse}
        isSubmitting={updateCourseMutation.loading}
      />
    </div>
  );
};

export default TeacherCourses;
