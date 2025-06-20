import React from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Typography,
  List,
  Tag,
  Space,
  Button,
  Spin,
  Empty,
} from "antd";
import {
  BookOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  UserOutlined,
  CalendarOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { useApi } from "@/hooks";
import { studentService } from "@/services";
import { Link } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import dayjs from "dayjs";

const { Title, Text } = Typography;

const StudentDashboard: React.FC = () => {
  const dashboardQuery = useApi(() => studentService.getDashboardStats(), {
    immediate: true,
  });

  const data = dashboardQuery.data?.data;

  if (dashboardQuery.loading) {
    return (
      <div className="flex justify-center items-center min-h-96">
        <Spin size="large" />
      </div>
    );
  }

  if (dashboardQuery.error || !data) {
    return (
      <div className="flex justify-center items-center min-h-96">
        <Empty description="Failed to load dashboard data" />
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

  const getNewsTypeColor = (type: string) => {
    switch (type) {
      case "NEWS":
        return "blue";
      case "EVENT":
        return "green";
      case "ANNOUNCEMENT":
        return "orange";
      default:
        return "default";
    }
  };

  return (
    <div className="p-6">
      <Title level={2} className="mb-6">
        Dashboard
      </Title>

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Enrolled Courses"
              value={data.stats.enrolledCourses}
              prefix={<BookOutlined />}
              valueStyle={{ color: "#3f8600" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Pending Requests"
              value={data.stats.pendingRequests}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: "#cf1322" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Available Resources"
              value={data.stats.totalResources}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* Recent News & Events */}
        <Col xs={24}>
          <Card
            title={
              <Space>
                <CalendarOutlined />
                <span>Recent News & Events</span>
              </Space>
            }
          >
            {data.recentNews.length > 0 ? (
              <List
                dataSource={data.recentNews}
                renderItem={(news: any) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <span>{news.title}</span>
                          <Tag color={getNewsTypeColor(news.type)}>
                            {news.type}
                          </Tag>
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size="small">
                          <Text>{news.content.substring(0, 100)}...</Text>
                          <Text type="secondary">
                            {dayjs(news.date).format("MMMM D, YYYY")}
                          </Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No recent news or events" />
            )}
          </Card>
        </Col>

        {/* Recent Resources */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <FileTextOutlined />
                <span>Recent Resources</span>
              </Space>
            }
            extra={
              <Link to={ROUTES.STUDENT.RESOURCES}>
                <Button type="link" size="small">
                  View All
                </Button>
              </Link>
            }
          >
            {data.recentResources.length > 0 ? (
              <List
                dataSource={data.recentResources}
                renderItem={(resource: any) => (
                  <List.Item
                    actions={[
                      <Button
                        key="view"
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        href={resource.url}
                        target="_blank"
                      >
                        View
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
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
                          <Text type="secondary">{resource.course?.name}</Text>
                          <Text type="secondary">
                            {dayjs(resource.createdAt).format("MMM D, YYYY")}
                          </Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No recent resources" />
            )}
          </Card>
        </Col>

        {/* Recent Courses */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <BookOutlined />
                <span>Recent Courses</span>
              </Space>
            }
            extra={
              <Link to={ROUTES.STUDENT.COURSES}>
                <Button type="link" size="small">
                  View All
                </Button>
              </Link>
            }
          >
            {data.recentCourses.length > 0 ? (
              <List
                dataSource={data.recentCourses}
                renderItem={(course: any) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<BookOutlined className="text-blue-500" />}
                      title={
                        <Link to={`${ROUTES.STUDENT.COURSES}/${course.id}`}>
                          {course.name}
                        </Link>
                      }
                      description={
                        <Space direction="vertical" size="small">
                          <Text type="secondary">{course.code}</Text>
                          <Space>
                            <UserOutlined />
                            <Text type="secondary">{course.teacher?.name}</Text>
                          </Space>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No enrolled courses" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default StudentDashboard;
