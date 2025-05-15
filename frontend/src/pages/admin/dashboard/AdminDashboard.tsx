import React, { useEffect } from "react";
import { Row, Col, Typography, App } from "antd";
import {
  TeamOutlined,
  SolutionOutlined,
  BankOutlined,
  NotificationOutlined,
} from "@ant-design/icons";
import { useAdminQuery, useDepartmentQuery } from "@/hooks";
import { NewsEvent } from "@/common/types";
import {
  StatisticsCard,
  TeachersList,
  StudentsList,
  DepartmentsList,
  RecentNewsEvents,
} from "./components";

const { Title } = Typography;

const AdminDashboard: React.FC = () => {
  const { notification } = App.useApp();
  const { getTeachersQuery, getStudentsQuery } = useAdminQuery();
  const { getAllDepartmentsQuery } = useDepartmentQuery();

  // Fetch data
  const teachersQuery = getTeachersQuery();
  const studentsQuery = getStudentsQuery();
  const departmentsQuery = getAllDepartmentsQuery();

  // Handle errors
  useEffect(() => {
    if (
      teachersQuery.isError ||
      studentsQuery.isError ||
      departmentsQuery.isError
    ) {
      notification.error({
        message: "Error",
        description: "Failed to load dashboard data. Please try again later.",
      });
    }
  }, [
    teachersQuery.isError,
    studentsQuery.isError,
    departmentsQuery.isError,
    notification,
  ]);

  // Get the data for display
  const teachers = teachersQuery.data?.data?.data || [];
  const students = studentsQuery.data?.data?.data || [];
  const departments = departmentsQuery.data?.data?.data || [];
  const newsEvents: NewsEvent[] = [];

  return (
    <div className="p-6">
      <Title level={2} className="mb-6">
        Dashboard
      </Title>

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="Total Teachers"
            value={Array.isArray(teachers) ? teachers.length : 0}
            prefix={<SolutionOutlined className="mr-2 text-blue-500" />}
            loading={teachersQuery.isLoading}
            valueStyle={{ color: "#1890ff" }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="Total Students"
            value={Array.isArray(students) ? students.length : 0}
            prefix={<TeamOutlined className="mr-2 text-green-500" />}
            loading={studentsQuery.isLoading}
            valueStyle={{ color: "#52c41a" }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="Departments"
            value={Array.isArray(departments) ? departments.length : 0}
            prefix={<BankOutlined className="mr-2 text-purple-500" />}
            loading={departmentsQuery.isLoading}
            valueStyle={{ color: "#722ed1" }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="News & Events"
            value={newsEvents.length}
            prefix={<NotificationOutlined className="mr-2 text-orange-500" />}
            loading={false}
            valueStyle={{ color: "#fa8c16" }}
          />
        </Col>
      </Row>

      {/* Main Content */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            <Col xs={24}>
              <TeachersList
                teachers={teachers}
                loading={teachersQuery.isLoading}
              />
            </Col>
            <Col xs={24} className="mt-4">
              <StudentsList
                students={students}
                loading={studentsQuery.isLoading}
              />
            </Col>
          </Row>
        </Col>
        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            <Col xs={24}>
              <DepartmentsList
                departments={departments}
                loading={departmentsQuery.isLoading}
              />
            </Col>
            <Col xs={24} className="mt-4">
              <RecentNewsEvents newsEvents={newsEvents} loading={false} />
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};

export default AdminDashboard;
