import React, { useState } from "react";
import {
  Modal,
  Descriptions,
  Tag,
  Typography,
  Space,
  Tabs,
  Table,
  Button,
  Spin,
  App,
} from "antd";
import {
  BookOutlined,
  TeamOutlined,
  FileOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  UserOutlined,
  CheckOutlined,
  CloseOutlined,
  MailOutlined,
  PhoneOutlined,
} from "@ant-design/icons";
import { Course } from "@/common/types";
import { useApi, useMutation } from "@/hooks";
import { teacherService } from "@/services";
import dayjs from "dayjs";

const { Title, Text } = Typography;

interface ViewCourseModalProps {
  visible: boolean;
  course: Course | null;
  loading: boolean;
  onCancel: () => void;
}

/**
 * Modal component to view course details with tabs
 */
const ViewCourseModal: React.FC<ViewCourseModalProps> = ({
  visible,
  course,
  loading,
  onCancel,
}) => {
  const [activeTab, setActiveTab] = useState("details");
  const [studentsPage, setStudentsPage] = useState(1);
  const [requestsPage, setRequestsPage] = useState(1);
  const pageSize = 10;
  const { notification } = App.useApp();

  // API calls for students and enrollment requests
  const studentsQuery = useApi(
    () =>
      course?.id
        ? teacherService.getCourseStudents(course.id)
        : Promise.reject("No course"),
    {
      immediate:
        !!course?.id && (activeTab === "students" || activeTab === "requests"),
      dependencies: [course?.id, activeTab, studentsPage, requestsPage],
    }
  );

  const enrollmentMutation = useMutation(
    ({
      courseId,
      enrollmentId,
      status,
    }: {
      courseId: string;
      enrollmentId: string;
      status: string;
    }) =>
      teacherService.updateEnrollmentStatus(courseId, enrollmentId, { status }),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Enrollment status updated successfully",
        });
        studentsQuery.refetch();
      },
      onError: (error: any) => {
        notification.error({
          message: "Error",
          description:
            error.response?.data?.message ||
            "Failed to update enrollment status",
        });
      },
    }
  );

  if (!course) return null;

  const handleEnrollmentAction = (
    enrollmentId: string,
    status: "APPROVED" | "REJECTED"
  ) => {
    enrollmentMutation.mutateAsync({
      courseId: course.id,
      enrollmentId,
      status,
    });
  };

  return (
    <Modal
      title={
        <Space>
          <BookOutlined />
          <span>{course.name} - Course Management</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={1000}
      loading={loading}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "details",
            label: (
              <Space>
                <BookOutlined />
                Course Details
              </Space>
            ),
            children: (
              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <Title level={4} className="mb-4">
                    Basic Information
                  </Title>
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="Course Name" span={2}>
                      <Text strong>{course.name}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Course Code">
                      <Tag color="blue">{course.code}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Duration">
                      <Tag color="green">{course.duration}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Department" span={2}>
                      <Tag color="purple">{course.department?.name}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Capacity">
                      <Space>
                        <TeamOutlined />
                        <span>{course.capacity} students</span>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Current Enrollments">
                      <Space>
                        <UserOutlined />
                        <span>{course._count?.enrollments || 0} students</span>
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                </div>

                {/* Description */}
                {course.description && (
                  <div>
                    <Title level={4} className="mb-4">
                      Description
                    </Title>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <Text>{course.description}</Text>
                    </div>
                  </div>
                )}

                {/* Schedule Information */}
                <div>
                  <Title level={4} className="mb-4">
                    Schedule
                  </Title>
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="Start Date">
                      {course.startDate ? (
                        <Space>
                          <CalendarOutlined />
                          <span>
                            {dayjs(course.startDate).format("MMMM D, YYYY")}
                          </span>
                        </Space>
                      ) : (
                        <Text type="secondary">Not set</Text>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="End Date">
                      {course.endDate ? (
                        <Space>
                          <CalendarOutlined />
                          <span>
                            {dayjs(course.endDate).format("MMMM D, YYYY")}
                          </span>
                        </Space>
                      ) : (
                        <Text type="secondary">Not set</Text>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </div>

                {/* Statistics */}
                <div>
                  <Title level={4} className="mb-4">
                    Statistics
                  </Title>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <Space>
                        <TeamOutlined className="text-blue-500 text-xl" />
                        <div>
                          <div className="text-2xl font-bold text-blue-600">
                            {course._count?.enrollments || 0}
                          </div>
                          <div className="text-sm text-gray-600">
                            Enrolled Students
                          </div>
                        </div>
                      </Space>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg">
                      <Space>
                        <FileOutlined className="text-green-500 text-xl" />
                        <div>
                          <div className="text-2xl font-bold text-green-600">
                            {course._count?.resources || 0}
                          </div>
                          <div className="text-sm text-gray-600">Resources</div>
                        </div>
                      </Space>
                    </div>
                  </div>
                </div>

                {/* Timestamps */}
                <div>
                  <Title level={4} className="mb-4">
                    Timestamps
                  </Title>
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="Created At">
                      <Space>
                        <ClockCircleOutlined />
                        <span>
                          {dayjs(course.createdAt).format(
                            "MMMM D, YYYY [at] h:mm A"
                          )}
                        </span>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Updated At">
                      <Space>
                        <ClockCircleOutlined />
                        <span>
                          {dayjs(course.updatedAt).format(
                            "MMMM D, YYYY [at] h:mm A"
                          )}
                        </span>
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                </div>
              </div>
            ),
          },
          {
            key: "students",
            label: (
              <Space>
                <TeamOutlined />
                Enrolled Students
              </Space>
            ),
            children: (
              <div>
                {studentsQuery.loading ? (
                  <div className="flex justify-center py-8">
                    <Spin size="large" />
                  </div>
                ) : (
                  <Table
                    dataSource={
                      studentsQuery.data?.data?.filter(
                        (student: any) => student.status === "APPROVED"
                      ) || []
                    }
                    rowKey="id"
                    pagination={{
                      current: studentsPage,
                      pageSize,
                      total:
                        studentsQuery.data?.data?.filter(
                          (student: any) => student.status === "APPROVED"
                        )?.length || 0,
                      onChange: setStudentsPage,
                      showSizeChanger: false,
                    }}
                    columns={[
                      {
                        title: "Student Name",
                        dataIndex: ["student", "name"],
                        key: "name",
                        render: (name: string) => (
                          <Space>
                            <UserOutlined />
                            <Text strong>{name}</Text>
                          </Space>
                        ),
                      },
                      {
                        title: "Email",
                        dataIndex: ["student", "email"],
                        key: "email",
                        render: (email: string) => (
                          <Space>
                            <MailOutlined />
                            <Text>{email}</Text>
                          </Space>
                        ),
                      },
                      {
                        title: "Phone",
                        dataIndex: ["student", "phone"],
                        key: "phone",
                        render: (phone: string) =>
                          phone ? (
                            <Space>
                              <PhoneOutlined />
                              <Text>{phone}</Text>
                            </Space>
                          ) : (
                            <Text type="secondary">Not provided</Text>
                          ),
                      },
                      {
                        title: "Enrolled Date",
                        dataIndex: "createdAt",
                        key: "enrolledDate",
                        render: (date: string) =>
                          dayjs(date).format("MMM D, YYYY"),
                      },
                    ]}
                  />
                )}
              </div>
            ),
          },
          {
            key: "requests",
            label: (
              <Space>
                <ClockCircleOutlined />
                Enrollment Requests
              </Space>
            ),
            children: (
              <div>
                {studentsQuery.loading ? (
                  <div className="flex justify-center py-8">
                    <Spin size="large" />
                  </div>
                ) : (
                  <Table
                    dataSource={
                      studentsQuery.data?.data?.filter(
                        (student: any) => student.status === "PENDING"
                      ) || []
                    }
                    rowKey="id"
                    pagination={{
                      current: requestsPage,
                      pageSize,
                      total:
                        studentsQuery.data?.data?.filter(
                          (student: any) => student.status === "PENDING"
                        )?.length || 0,
                      onChange: setRequestsPage,
                      showSizeChanger: false,
                    }}
                    columns={[
                      {
                        title: "Student Name",
                        dataIndex: ["student", "name"],
                        key: "name",
                        render: (name: string) => (
                          <Space>
                            <UserOutlined />
                            <Text strong>{name}</Text>
                          </Space>
                        ),
                      },
                      {
                        title: "Email",
                        dataIndex: ["student", "email"],
                        key: "email",
                        render: (email: string) => (
                          <Space>
                            <MailOutlined />
                            <Text>{email}</Text>
                          </Space>
                        ),
                      },
                      {
                        title: "Request Date",
                        dataIndex: "createdAt",
                        key: "requestDate",
                        render: (date: string) =>
                          dayjs(date).format("MMM D, YYYY"),
                      },
                      {
                        title: "Actions",
                        key: "actions",
                        render: (_, record: any) => (
                          <Space>
                            <Button
                              type="primary"
                              size="small"
                              icon={<CheckOutlined />}
                              loading={enrollmentMutation.loading}
                              onClick={() =>
                                handleEnrollmentAction(record.id, "APPROVED")
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              danger
                              size="small"
                              icon={<CloseOutlined />}
                              loading={enrollmentMutation.loading}
                              onClick={() =>
                                handleEnrollmentAction(record.id, "REJECTED")
                              }
                            >
                              Reject
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default ViewCourseModal;
