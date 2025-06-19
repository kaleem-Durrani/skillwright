import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Typography, Button, Tabs, Modal, message } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useApi, useMutation } from "@/hooks";
import { studentService, courseService } from "@/services";
import { ROUTES } from "@/common/constants";
import { CourseWithEnrollment } from "@/common/types";
import { CourseList, CourseSearch } from "./components";
import {
  filterCoursesByStatus,
  getCourseIds,
  filterAvailableCourses,
} from "./utils";

const { Title, Text } = Typography;
const { TabPane } = Tabs;
const { confirm } = Modal;

const StudentCourses = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("enrolled");
  const [searchText, setSearchText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  // API calls for courses
  const enrolledCoursesQuery = useApi(
    () =>
      studentService.getEnrolledCourses({
        page: currentPage,
        limit: pageSize,
        search: searchText,
      }),
    {
      immediate: true,
      dependencies: [currentPage, pageSize, searchText],
    }
  );

  const allCoursesQuery = useApi(
    () =>
      courseService.getCourses({
        page: currentPage,
        limit: pageSize,
        search: searchText,
      }),
    {
      immediate: true,
      dependencies: [currentPage, pageSize, searchText],
    }
  );

  // Mutation hooks
  const withdrawFromCourseMutation = useMutation(
    studentService.withdrawFromCourse,
    {
      onSuccess: () => {
        message.success("Successfully withdrawn from course");
        enrolledCoursesQuery.refetch();
        allCoursesQuery.refetch();
      },
    }
  );

  const requestEnrollmentMutation = useMutation(studentService.enrollInCourse, {
    onSuccess: () => {
      message.success("Enrollment request sent successfully");
      enrolledCoursesQuery.refetch();
      allCoursesQuery.refetch();
    },
  });

  // Extract courses from the API response
  const enrolledCoursesResponse = enrolledCoursesQuery.data?.data;
  const enrolledCourses = enrolledCoursesResponse?.items || [];
  const pendingCourses = filterCoursesByStatus(enrolledCourses, "PENDING");
  const approvedCourses = filterCoursesByStatus(enrolledCourses, "APPROVED");

  // All available courses (excluding already enrolled ones)
  const enrolledCourseIds = getCourseIds(enrolledCourses);
  const allCoursesResponse = allCoursesQuery.data?.data;
  const availableCourses = filterAvailableCourses(
    allCoursesResponse?.items || [],
    enrolledCourseIds
  );

  // Handle course enrollment
  const handleEnroll = (courseId: string) => {
    confirm({
      title: "Are you sure you want to enroll in this course?",
      icon: <ExclamationCircleOutlined />,
      content:
        "Your enrollment request will be sent to the teacher for approval.",
      async onOk() {
        try {
          await requestEnrollmentMutation.mutateAsync(courseId);
        } catch (error: any) {
          message.error(
            error.response?.data?.message || "Failed to enroll in course"
          );
        }
      },
    });
  };

  // Handle course withdrawal
  const handleWithdraw = (courseId: string) => {
    confirm({
      title: "Are you sure you want to withdraw from this course?",
      icon: <ExclamationCircleOutlined />,
      content:
        "You will need to re-enroll if you want to access this course again.",
      async onOk() {
        try {
          await withdrawFromCourseMutation.mutateAsync(courseId);
        } catch (error: any) {
          message.error(
            error.response?.data?.message || "Failed to withdraw from course"
          );
        }
      },
    });
  };

  // Handle view course details
  const handleViewCourse = (courseId: string) => {
    navigate(ROUTES.STUDENT.COURSE_DETAILS(courseId));
  };

  // Handle view course resources
  const handleViewResources = (courseId: string) => {
    navigate(ROUTES.STUDENT.COURSE_DETAILS(courseId) + "/resources");
  };

  // Handle search
  const handleSearch = (value: string) => {
    setSearchText(value);
    setCurrentPage(1);
  };

  // Handle pagination
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <Title level={2}>My Courses</Title>
        <Text className="text-gray-600">
          View your enrolled courses and discover new ones
        </Text>
      </div>

      <div className="mb-4">
        <CourseSearch value={searchText} onChange={handleSearch} />
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="course-tabs"
      >
        <TabPane tab="Enrolled Courses" key="enrolled">
          <CourseList
            courses={approvedCourses}
            isLoading={enrolledCoursesQuery.loading}
            isEnrolled={true}
            currentPage={currentPage}
            pageSize={pageSize}
            total={enrolledCoursesResponse?.total || 0}
            onPageChange={handlePageChange}
            onEnroll={handleEnroll}
            onWithdraw={handleWithdraw}
            onViewDetails={handleViewCourse}
            onViewResources={handleViewResources}
            emptyText="You are not enrolled in any courses yet"
            emptyAction={
              <Button type="primary" onClick={() => setActiveTab("available")}>
                Browse Available Courses
              </Button>
            }
          />
        </TabPane>

        <TabPane tab="Pending Requests" key="pending">
          <CourseList
            courses={pendingCourses}
            isLoading={enrolledCoursesQuery.loading}
            isEnrolled={true}
            currentPage={currentPage}
            pageSize={pageSize}
            total={pendingCourses.length}
            onPageChange={handlePageChange}
            onEnroll={handleEnroll}
            onWithdraw={handleWithdraw}
            onViewDetails={handleViewCourse}
            onViewResources={handleViewResources}
            emptyText="You don't have any pending enrollment requests"
          />
        </TabPane>

        <TabPane tab="Available Courses" key="available">
          <CourseList
            courses={availableCourses}
            isLoading={allCoursesQuery.loading}
            isEnrolled={false}
            currentPage={currentPage}
            pageSize={pageSize}
            total={allCoursesResponse?.total || 0}
            onPageChange={handlePageChange}
            onEnroll={handleEnroll}
            onWithdraw={handleWithdraw}
            onViewDetails={handleViewCourse}
            onViewResources={handleViewResources}
            emptyText="No available courses found"
          />
        </TabPane>
      </Tabs>
    </div>
  );
};

export default StudentCourses;
