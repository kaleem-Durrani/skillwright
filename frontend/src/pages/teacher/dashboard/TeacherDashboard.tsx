import React, { useEffect, useState } from "react";
import { Row, Col, Typography, Spin, App } from "antd";
import { BookOutlined, FileOutlined, TeamOutlined } from "@ant-design/icons";
import { useApi } from "@/hooks";
import { teacherService } from "@/services";
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
  // API calls
  const coursesQuery = useApi(
    () => teacherService.getMyCourses({ limit: 50 }),
    { immediate: true }
  );

  // Extract data
  const courses = coursesQuery.data?.data?.items || [];

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
            loading={coursesQuery.loading}
            valueStyle={{ color: "#1890ff" }}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatisticsCard
            title="Total Resources"
            value={resourceStats.total}
            prefix={<FileOutlined className="mr-2 text-green-500" />}
            loading={coursesQuery.loading}
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
            loading={coursesQuery.loading}
            valueStyle={{ color: "#722ed1" }}
          />
        </Col>
      </Row>

      {/* Main Content */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <RecentCourses courses={courses} loading={coursesQuery.loading} />
        </Col>
        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            <Col xs={24}>
              <UpcomingEvents
                events={upcomingEvents}
                loading={coursesQuery.loading}
              />
            </Col>
            <Col xs={24} className="mt-4">
              <ResourcesOverview
                stats={resourceStats}
                loading={coursesQuery.loading}
              />
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};

export default TeacherDashboard;
