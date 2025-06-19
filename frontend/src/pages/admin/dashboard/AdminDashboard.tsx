import React from "react";
import { Row, Col, Typography } from "antd";
import {
  TeamOutlined,
  SolutionOutlined,
  BankOutlined,
  NotificationOutlined,
} from "@ant-design/icons";
import { useApi } from "@/hooks";
import { adminService, departmentService } from "@/services";
import {
  StatisticsCard,
  TeachersList,
  StudentsList,
  DepartmentsList,
  RecentNewsEvents,
} from "./components";

const { Title } = Typography;

const AdminDashboard: React.FC = () => {
  // API calls for dashboard data
  const teachersQuery = useApi(
    () => adminService.getTeachers({ page: 1, limit: 5 }),
    { immediate: true }
  );

  const studentsQuery = useApi(
    () => adminService.getStudents({ page: 1, limit: 5 }),
    { immediate: true }
  );

  const departmentsQuery = useApi(
    () => departmentService.getDepartments({ page: 1, limit: 5 }),
    { immediate: true }
  );

  const newsEventsQuery = useApi(
    () => adminService.getNewsEvents({ page: 1, limit: 5 }),
    { immediate: true }
  );

  // Get the data for display
  const teachers = teachersQuery.data?.data?.items || [];
  const students = studentsQuery.data?.data?.items || [];
  const departments = departmentsQuery.data?.data?.items || [];
  const newsEvents = newsEventsQuery.data?.data?.items || [];

  // Calculate totals
  const totalTeachers = teachersQuery.data?.data?.total || 0;
  const totalStudents = studentsQuery.data?.data?.total || 0;
  const totalDepartments = departmentsQuery.data?.data?.total || 0;
  const totalNewsEvents = newsEventsQuery.data?.data?.total || 0;

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
            value={totalTeachers}
            prefix={<SolutionOutlined className="mr-2 text-blue-500" />}
            loading={teachersQuery.loading}
            valueStyle={{ color: "#1890ff" }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="Total Students"
            value={totalStudents}
            prefix={<TeamOutlined className="mr-2 text-green-500" />}
            loading={studentsQuery.loading}
            valueStyle={{ color: "#52c41a" }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="Departments"
            value={totalDepartments}
            prefix={<BankOutlined className="mr-2 text-purple-500" />}
            loading={departmentsQuery.loading}
            valueStyle={{ color: "#722ed1" }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticsCard
            title="News & Events"
            value={totalNewsEvents}
            prefix={<NotificationOutlined className="mr-2 text-orange-500" />}
            loading={newsEventsQuery.loading}
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
                teachers={teachers as any}
                loading={teachersQuery.loading}
              />
            </Col>
            <Col xs={24} className="mt-4">
              <StudentsList
                students={students as any}
                loading={studentsQuery.loading}
              />
            </Col>
          </Row>
        </Col>
        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            <Col xs={24}>
              <DepartmentsList
                departments={departments as any}
                loading={departmentsQuery.loading}
              />
            </Col>
            <Col xs={24} className="mt-4">
              <RecentNewsEvents
                newsEvents={newsEvents as any}
                loading={newsEventsQuery.loading}
              />
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};

export default AdminDashboard;
