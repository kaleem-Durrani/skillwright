import React, { useState } from "react";
import { Tabs, Typography, Input, Space, App } from "antd";
import {
  BookOutlined,
  ClockCircleOutlined,
  SearchOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useApi, useMutation } from "@/hooks";
import { studentService } from "@/services";
import { QueryParams } from "@/common/types";
import { ROUTES } from "@/common/constants";
import { useNavigate } from "react-router-dom";
import {
  EnrolledCoursesTab,
  PendingRequestsTab,
  AvailableCoursesTab,
} from "./components";

const { Title } = Typography;
const { Search } = Input;

const StudentCourses: React.FC = () => {
  const { notification, modal } = App.useApp();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("enrolled");
  const [searchTerm, setSearchTerm] = useState("");

  // Mutations
  const enrollMutation = useMutation(studentService.requestEnrollment, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Enrollment request submitted successfully.",
      });
      // Refresh all tabs
      enrolledQuery.refetch();
      pendingQuery.refetch();
      availableQuery.refetch();
    },
    onError: (error: any) => {
      notification.error({
        message: "Error",
        description:
          error.response?.data?.message ||
          "Failed to submit enrollment request.",
      });
    },
  });

  const cancelMutation = useMutation(studentService.cancelEnrollmentRequest, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Enrollment request cancelled successfully.",
      });
      pendingQuery.refetch();
      availableQuery.refetch();
    },
    onError: (error: any) => {
      notification.error({
        message: "Error",
        description:
          error.response?.data?.message ||
          "Failed to cancel enrollment request.",
      });
    },
  });

  const withdrawMutation = useMutation(studentService.withdrawFromCourse, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Successfully withdrawn from course.",
      });
      enrolledQuery.refetch();
      availableQuery.refetch();
    },
    onError: (error: any) => {
      notification.error({
        message: "Error",
        description:
          error.response?.data?.message || "Failed to withdraw from course.",
      });
    },
  });

  // Query parameters
  const getQueryParams = (): QueryParams => ({
    search: searchTerm || undefined,
    page: 1,
    limit: 10,
  });

  // API queries
  const enrolledQuery = useApi(
    () => studentService.getEnrolledCourses(getQueryParams()),
    {
      immediate: true,
      dependencies: [searchTerm],
    }
  );

  const pendingQuery = useApi(
    () => studentService.getPendingRequests(getQueryParams()),
    {
      immediate: activeTab === "pending",
      dependencies: [searchTerm, activeTab],
    }
  );

  const availableQuery = useApi(
    () => studentService.getAvailableCourses(getQueryParams()),
    {
      immediate: activeTab === "available",
      dependencies: [searchTerm, activeTab],
    }
  );

  // Handlers
  const handleSearch = (value: string) => {
    setSearchTerm(value);
  };

  const handleEnroll = (courseId: string) => {
    modal.confirm({
      title: "Confirm Enrollment",
      content: "Are you sure you want to request enrollment in this course?",
      onOk: () => enrollMutation.mutateAsync(courseId),
    });
  };

  const handleCancel = (enrollmentId: string) => {
    modal.confirm({
      title: "Cancel Request",
      content: "Are you sure you want to cancel this enrollment request?",
      onOk: () => cancelMutation.mutateAsync(enrollmentId),
    });
  };

  const handleWithdraw = (courseId: string) => {
    modal.confirm({
      title: "Withdraw from Course",
      content:
        "Are you sure you want to withdraw from this course? This action cannot be undone.",
      onOk: () => withdrawMutation.mutateAsync(courseId),
    });
  };

  const handleView = (courseId: string) => {
    navigate(ROUTES.STUDENT.COURSE_DETAILS(courseId));
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    // Trigger queries for the active tab
    if (key === "pending" && !pendingQuery.data) {
      pendingQuery.refetch();
    } else if (key === "available" && !availableQuery.data) {
      availableQuery.refetch();
    }
  };

  const tabItems = [
    {
      key: "enrolled",
      label: (
        <Space>
          <BookOutlined />
          <span>Enrolled Courses</span>
        </Space>
      ),
      children: (
        <EnrolledCoursesTab
          query={enrolledQuery}
          onWithdraw={handleWithdraw}
          onView={handleView}
          isWithdrawing={withdrawMutation.loading}
        />
      ),
    },
    {
      key: "pending",
      label: (
        <Space>
          <ClockCircleOutlined />
          <span>Pending Requests</span>
        </Space>
      ),
      children: (
        <PendingRequestsTab
          query={pendingQuery}
          onCancel={handleCancel}
          isCancelling={cancelMutation.loading}
        />
      ),
    },
    {
      key: "available",
      label: (
        <Space>
          <PlusOutlined />
          <span>Available Courses</span>
        </Space>
      ),
      children: (
        <AvailableCoursesTab
          query={availableQuery}
          onEnroll={handleEnroll}
          isEnrolling={enrollMutation.loading}
        />
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2} className="text-3xl md:text-4xl font-bold">
          My Courses
        </Title>
        <Search
          placeholder="Search courses..."
          allowClear
          enterButton={<SearchOutlined />}
          size="large"
          style={{ width: 300 }}
          onSearch={handleSearch}
          onChange={(e) => !e.target.value && setSearchTerm("")}
        />
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={tabItems}
        size="large"
      />
    </div>
  );
};

export default StudentCourses;
