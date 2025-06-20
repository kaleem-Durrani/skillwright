import React, { useState } from "react";
import {
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Tooltip,
  Pagination,
  Empty,
  Spin,
} from "antd";
import {
  PlusOutlined,
  UserOutlined,
  CalendarOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { Course } from "@/common/types";

const { Text } = Typography;

interface AvailableCoursesTabProps {
  query: any;
  onEnroll: (courseId: string) => void;
  isEnrolling: boolean;
}

const AvailableCoursesTab: React.FC<AvailableCoursesTabProps> = ({
  query,
  onEnroll,
  isEnrolling,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const responseData = query.data?.data as any;
  const courses = responseData?.items || [];
  const pagination = responseData?.pagination || {
    total: 0,
    page: 1,
    limit: 10,
    hasMore: false,
  };

  const getEnrollmentStatusTag = (course: Course) => {
    if (course.enrollmentStatus === "APPROVED") {
      return (
        <Tag color="green" icon={<CheckCircleOutlined />}>
          ENROLLED
        </Tag>
      );
    } else if (course.enrollmentStatus === "PENDING") {
      return (
        <Tag color="orange" icon={<ClockCircleOutlined />}>
          PENDING
        </Tag>
      );
    }
    return null;
  };

  const columns = [
    {
      title: "Course",
      key: "course",
      render: (record: Course) => (
        <Space direction="vertical" size="small">
          <Text strong>{record.name}</Text>
          <Text type="secondary">{record.code}</Text>
          {record.description && (
            <Text type="secondary" className="text-sm">
              {record.description.length > 100
                ? `${record.description.substring(0, 100)}...`
                : record.description}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: "Teacher",
      key: "teacher",
      render: (record: Course) => (
        <Space>
          <UserOutlined />
          <Text>{record.teacher?.name || "N/A"}</Text>
        </Space>
      ),
    },
    {
      title: "Department",
      key: "department",
      render: (record: Course) => (
        <Text>{record.department?.name || "N/A"}</Text>
      ),
    },
    {
      title: "Duration",
      key: "duration",
      render: (record: Course) => (
        <Space>
          <CalendarOutlined />
          <Text>{record.duration}</Text>
        </Space>
      ),
    },
    {
      title: "Capacity",
      key: "capacity",
      render: (record: Course) => (
        <Space direction="vertical" size="small">
          <Text type="secondary">
            {record._count?.enrollments || 0} enrolled
          </Text>
          {record.capacity && (
            <Text type="secondary">/ {record.capacity} max</Text>
          )}
        </Space>
      ),
    },
    {
      title: "Status",
      key: "status",
      render: (record: Course) => getEnrollmentStatusTag(record),
    },
    {
      title: "Resources",
      key: "resources",
      render: (record: Course) => (
        <Text type="secondary">{record._count?.resources || 0} resources</Text>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (record: Course) => (
        <Space>
          {record.canEnroll ? (
            <Tooltip title="Request Enrollment">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                size="small"
                loading={isEnrolling}
                onClick={() => onEnroll(record.id)}
              >
                Enroll
              </Button>
            </Tooltip>
          ) : (
            <Tooltip
              title={
                record.enrollmentStatus === "APPROVED"
                  ? "Already enrolled"
                  : "Request pending"
              }
            >
              <Button type="default" size="small" disabled>
                {record.enrollmentStatus === "APPROVED"
                  ? "Enrolled"
                  : "Pending"}
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const handlePageChange = (page: number, size?: number) => {
    setCurrentPage(page);
    if (size) setPageSize(size);
  };

  if (query.loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <Spin size="large" />
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <Empty
        image={<BookOutlined style={{ fontSize: 64, color: "#d9d9d9" }} />}
        description="No available courses found"
        className="py-8"
      >
        <Text type="secondary">
          Check back later for new courses or adjust your search criteria
        </Text>
      </Empty>
    );
  }

  return (
    <div>
      <Table
        columns={columns}
        dataSource={courses}
        rowKey="id"
        pagination={false}
        loading={query.loading}
        scroll={{ x: 1000 }}
      />

      {pagination.total > 0 && (
        <div className="flex justify-center mt-4">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={pagination.total}
            onChange={handlePageChange}
            showSizeChanger
            showQuickJumper
            showTotal={(total) => `Total ${total} courses`}
          />
        </div>
      )}
    </div>
  );
};

export default AvailableCoursesTab;
