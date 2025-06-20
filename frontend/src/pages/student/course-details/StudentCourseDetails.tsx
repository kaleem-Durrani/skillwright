import React, { useState } from "react";
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Space,
  Button,
  Tabs,
  List,
  Spin,
  Empty,
  Descriptions,
  Avatar,
  App,
} from "antd";
import {
  BookOutlined,
  UserOutlined,
  CalendarOutlined,
  FileTextOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  ArrowLeftOutlined,
  LogoutOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";
import { useApi, useMutation } from "@/hooks";
import { studentService } from "@/services";
import { ROUTES } from "@/common/constants";
import dayjs from "dayjs";

const { Title, Text, Paragraph } = Typography;

const StudentCourseDetails: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { notification, modal } = App.useApp();
  const [activeTab, setActiveTab] = useState("overview");

  // API queries
  const courseQuery = useApi(
    () =>
      courseId
        ? studentService.getCourseDetails(courseId)
        : Promise.reject("No course ID"),
    {
      immediate: !!courseId,
      dependencies: [courseId],
    }
  );

  const resourcesQuery = useApi(
    () =>
      courseId
        ? studentService.getCourseResources(courseId, { limit: 50 })
        : Promise.reject("No course ID"),
    {
      immediate: !!courseId && activeTab === "resources",
      dependencies: [courseId, activeTab],
    }
  );

  // Mutations
  const enrollMutation = useMutation(studentService.requestEnrollment, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Enrollment request submitted successfully.",
      });
      courseQuery.refetch();
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

  const withdrawMutation = useMutation(studentService.withdrawFromCourse, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Successfully withdrawn from course.",
      });
      courseQuery.refetch();
    },
    onError: (error: any) => {
      notification.error({
        message: "Error",
        description:
          error.response?.data?.message || "Failed to withdraw from course.",
      });
    },
  });

  const course = courseQuery.data?.data;

  const handleBack = () => {
    navigate(ROUTES.STUDENT.COURSES);
  };

  const handleEnroll = () => {
    if (!courseId) return;
    modal.confirm({
      title: "Confirm Enrollment",
      content: "Are you sure you want to request enrollment in this course?",
      onOk: () => enrollMutation.mutateAsync(courseId),
    });
  };

  const handleWithdraw = () => {
    if (!courseId) return;
    modal.confirm({
      title: "Withdraw from Course",
      content:
        "Are you sure you want to withdraw from this course? This action cannot be undone.",
      onOk: () => withdrawMutation.mutateAsync(courseId),
    });
  };

  const handleViewResource = (resourceUrl: string) => {
    window.open(resourceUrl, "_blank");
  };

  const handleResourceComments = (resourceId: string) => {
    navigate(ROUTES.STUDENT.RESOURCE_COMMENTS(resourceId));
  };

  if (courseQuery.loading) {
    return (
      <div className="flex justify-center items-center min-h-96">
        <Spin size="large" />
      </div>
    );
  }

  if (courseQuery.error || !course) {
    return (
      <div className="p-6">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
          className="mb-4"
        >
          Back to Courses
        </Button>
        <Empty description="Course not found or you don't have access to this course" />
      </div>
    );
  }

  const getResourceTypeColor = (type: string) => {
    switch (type) {
      case "VIDEO":
        return "red";
      case "DOCUMENT":
        return "blue";
      case "LINK":
        return "green";
      default:
        return "default";
    }
  };

  const tabItems = [
    {
      key: "overview",
      label: "Overview",
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Card title="Course Description">
              <Paragraph>
                {course.description ||
                  "No description available for this course."}
              </Paragraph>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="Course Statistics">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Enrolled Students">
                  {course._count?.enrollments || 0}
                </Descriptions.Item>
                <Descriptions.Item label="Resources">
                  {course._count?.resources || 0}
                </Descriptions.Item>
                <Descriptions.Item label="Duration">
                  {course.duration}
                </Descriptions.Item>
                {course.capacity && (
                  <Descriptions.Item label="Capacity">
                    {course.capacity} students
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: "resources",
      label: "Resources",
      children: (
        <Card>
          {resourcesQuery.loading ? (
            <div className="flex justify-center py-8">
              <Spin size="large" />
            </div>
          ) : (
            <List
              dataSource={resourcesQuery.data?.data?.items || []}
              renderItem={(resource: any) => (
                <List.Item
                  actions={[
                    <Button
                      key="view"
                      type="link"
                      onClick={() => handleViewResource(resource.url)}
                    >
                      View
                    </Button>,
                    <Button
                      key="comments"
                      type="link"
                      onClick={() => handleResourceComments(resource.id)}
                    >
                      Comments ({resource._count?.comments || 0})
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<FileTextOutlined className="text-blue-500" />}
                    title={
                      <Space>
                        <span>{resource.title}</span>
                        <Tag color={getResourceTypeColor(resource.type)}>
                          {resource.type}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size="small">
                        {resource.description && (
                          <Text type="secondary">{resource.description}</Text>
                        )}
                        <Text type="secondary">
                          By {resource.teacher?.name} •{" "}
                          {dayjs(resource.createdAt).format("MMM D, YYYY")}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      ),
    },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-4">
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            Back to Courses
          </Button>
          <div>
            <Title level={2} className="mb-0">
              {course.name}
            </Title>
            <Text type="secondary">{course.code}</Text>
          </div>
        </div>

        {/* Action Buttons */}
        <Space>
          {course.enrollmentStatus === "APPROVED" ? (
            <Button
              danger
              icon={<LogoutOutlined />}
              loading={withdrawMutation.loading}
              onClick={handleWithdraw}
            >
              Withdraw
            </Button>
          ) : course.enrollmentStatus === "PENDING" ? (
            <Button disabled>
              <ClockCircleOutlined /> Pending Approval
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={enrollMutation.loading}
              onClick={handleEnroll}
            >
              Request Enrollment
            </Button>
          )}
        </Space>
      </div>

      {/* Course Info Cards */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={8}>
          <Card>
            <Space>
              <Avatar icon={<UserOutlined />} />
              <div>
                <Text strong>Instructor</Text>
                <br />
                <Text type="secondary">{course.teacher?.name || "N/A"}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Space>
              <Avatar icon={<BookOutlined />} />
              <div>
                <Text strong>Department</Text>
                <br />
                <Text type="secondary">{course.department?.name || "N/A"}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Space>
              <Avatar icon={<TeamOutlined />} />
              <div>
                <Text strong>Students</Text>
                <br />
                <Text type="secondary">
                  {course._count?.enrollments || 0} enrolled
                </Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="large"
      />
    </div>
  );
};

export default StudentCourseDetails;
