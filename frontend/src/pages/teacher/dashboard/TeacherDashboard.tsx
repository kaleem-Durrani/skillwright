import React, { useEffect, useState } from "react";
import { Row, Col, Typography, Spin, App } from "antd";
import { BookOutlined, FileOutlined, TeamOutlined } from "@ant-design/icons";
import { useTeacherQuery } from "@/hooks";
import { Course } from "@/common/types";
import {
  StatisticsCard,
  RecentCourses,
  UpcomingEvents,
  ResourcesOverview,
} from "./components";
import {
  calculateResourceStats,
  generateUpcomingEvents,
} from "./utils/dashboardUtils";

const { Title } = Typography;

const TeacherDashboard: React.FC = () => {
  const { notification } = App.useApp();
  const { getProfileQuery, getMyCoursesQuery } = useTeacherQuery();
  const [courses, setCourses] = useState<Course[]>([]);

  // Fetch teacher's courses
  const coursesQuery = getMyCoursesQuery();

  useEffect(() => {
    if (coursesQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load courses. Please try again later.",
      });
    }

    if (coursesQuery.data?.data?.data) {
      setCourses(coursesQuery.data.data.data);
    }
  }, [coursesQuery.data, coursesQuery.isError, notification]);

  // Calculate resource statistics
  const resourceStats = calculateResourceStats(courses);

  // Generate upcoming events
  const upcomingEvents = generateUpcomingEvents(courses);

  return (
    <div className="p-6">
      <Title level={2} className="mb-6">
        Dashboard
      </Title>

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={8}>
          <StatisticsCard
            title="Total Courses"
            value={courses.length}
            prefix={<BookOutlined className="mr-2 text-blue-500" />}
            loading={coursesQuery.isLoading}
            valueStyle={{ color: "#1890ff" }}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatisticsCard
            title="Total Resources"
            value={resourceStats.total}
            prefix={<FileOutlined className="mr-2 text-green-500" />}
            loading={coursesQuery.isLoading}
            valueStyle={{ color: "#52c41a" }}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatisticsCard
            title="Total Students"
            value={courses.reduce(
              (acc, course) => acc + (course._count?.enrollments || 0),
              0
            )}
            prefix={<TeamOutlined className="mr-2 text-purple-500" />}
            loading={coursesQuery.isLoading}
            valueStyle={{ color: "#722ed1" }}
          />
        </Col>
      </Row>

      {/* Main Content */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <RecentCourses courses={courses} loading={coursesQuery.isLoading} />
        </Col>
        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            <Col xs={24}>
              <UpcomingEvents
                events={upcomingEvents}
                loading={coursesQuery.isLoading}
              />
            </Col>
            <Col xs={24} className="mt-4">
              <ResourcesOverview
                stats={resourceStats}
                loading={coursesQuery.isLoading}
              />
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};

export default TeacherDashboard;
