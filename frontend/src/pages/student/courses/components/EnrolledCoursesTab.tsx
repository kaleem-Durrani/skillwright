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
  EyeOutlined,
  LogoutOutlined,
  UserOutlined,
  CalendarOutlined,
  BookOutlined,
} from "@ant-design/icons";
import { Course } from "@/common/types";
import dayjs from "dayjs";

const { Text } = Typography;

interface EnrolledCoursesTabProps {
  query: any;
  onWithdraw: (courseId: string) => void;
  onView?: (courseId: string) => void;
  isWithdrawing: boolean;
}

const EnrolledCoursesTab: React.FC<EnrolledCoursesTabProps> = ({
  query,
  onWithdraw,
  onView,
  isWithdrawing,
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
      title: "Enrolled",
      key: "enrolled",
      render: (record: Course) => (
        <Space direction="vertical" size="small">
          <Text type="secondary">
            {dayjs(record.enrolledAt).format("MMM D, YYYY")}
          </Text>
        </Space>
      ),
    },
    {
      title: "Stats",
      key: "stats",
      render: (record: Course) => (
        <Space direction="vertical" size="small">
          <Text type="secondary">
            {record._count?.enrollments || 0} students
          </Text>
          <Text type="secondary">
            {record._count?.resources || 0} resources
          </Text>
        </Space>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (record: Course) => (
        <Space>
          <Tooltip title="View Course">
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => onView?.(record.id)}
            >
              View
            </Button>
          </Tooltip>
          <Tooltip title="Withdraw from Course">
            <Button
              type="text"
              danger
              icon={<LogoutOutlined />}
              size="small"
              loading={isWithdrawing}
              onClick={() => onWithdraw(record.id)}
            >
              Withdraw
            </Button>
          </Tooltip>
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
        description="You are not enrolled in any courses yet"
        className="py-8"
      >
        <Text type="secondary">
          Browse available courses to start your learning journey
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
        scroll={{ x: 800 }}
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

export default EnrolledCoursesTab;
