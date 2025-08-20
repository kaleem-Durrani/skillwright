import { useState, useEffect } from "react";
import {
  Typography,
  Card,
  Row,
  Col,
  Input,
  Select,
  Pagination,
  Spin,
  Empty,
  Tag,
} from "antd";
import {
  SearchOutlined,
  CalendarOutlined,
  UserOutlined,
  TeamOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { courseService, PublicCoursesParams } from "@/services/courseService";
import { departmentService } from "@/services/departmentService";
import { useApi } from "@/hooks";
import styles from "./ExploreCourses.module.css";

const { Title, Text, Paragraph } = Typography;
const { Search } = Input;
const { Option } = Select;

interface PublicCourse {
  id: string;
  name: string;
  code: string;
  description?: string;
  duration: string | number;
  capacity?: number;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  department?: {
    id: string;
    name: string;
    description?: string;
  };
  teacher?: {
    id: string;
    name: string;
    email?: string;
    qualification?: string;
    specialization?: string;
  };
  _count?: {
    enrollments: number;
    resources: number;
  };
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalCourses: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
}

const ExploreCourses = () => {
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    currentPage: 1,
    totalPages: 1,
    totalCourses: 0,
    hasNextPage: false,
    hasPrevPage: false,
    limit: 9,
  });
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<PublicCoursesParams>({
    page: 1,
    limit: 9,
    search: "",
    departmentId: "",
  });

  // Fetch departments for filter
  const { data: departmentsData } = useApi(
    () => departmentService.getDepartmentsForSelect(),
    { immediate: true }
  );

  // Fetch courses
  const fetchCourses = async (params: PublicCoursesParams) => {
    setLoading(true);
    try {
      const response = await courseService.getPublicCourses(params);
      if (response.success && response.data) {
        setCourses(response.data);
        setPagination(response.pagination);
      }
    } catch (error) {
      console.error("Error fetching courses:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses(searchParams);
  }, [searchParams]);

  const handleSearch = (value: string) => {
    setSearchParams((prev) => ({
      ...prev,
      search: value,
      page: 1,
    }));
  };

  const handleDepartmentFilter = (departmentId: string) => {
    setSearchParams((prev) => ({
      ...prev,
      departmentId,
      page: 1,
    }));
  };

  const handlePageChange = (page: number) => {
    setSearchParams((prev) => ({
      ...prev,
      page,
    }));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/10 to-purple-50/10 py-8">
      <div className="container mx-auto px-4 backdrop-blur-sm bg-white/50 rounded-lg shadow-sm py-10">
        {/* Header */}
        <div className="text-center mb-12">
          <Title level={1} className="mb-4">
            Explore Our Courses
          </Title>
          <Paragraph className="text-lg text-gray-600 max-w-2xl mx-auto">
            Discover our comprehensive range of vocational training courses
            designed to equip you with practical skills for today's job market.
          </Paragraph>
        </div>

        {/* Filters */}
        <Card className="mb-8 shadow-sm">
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={12} md={8}>
              <Search
                placeholder="Search courses..."
                allowClear
                enterButton={<SearchOutlined />}
                size="large"
                onSearch={handleSearch}
                onChange={(e) => {
                  if (!e.target.value) {
                    handleSearch("");
                  }
                }}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Select
                placeholder="Filter by Department"
                allowClear
                size="large"
                style={{ width: "100%" }}
                onChange={handleDepartmentFilter}
                value={searchParams.departmentId || undefined}
              >
                {departmentsData?.data?.map((dept: any) => (
                  <Option key={dept.value} value={dept.value}>
                    {dept.label}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">
                Showing {courses.length} of {pagination.totalCourses} courses
              </Text>
            </Col>
          </Row>
        </Card>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <Spin size="large" />
          </div>
        )}

        {/* Empty State */}
        {!loading && courses.length === 0 && (
          <Empty
            description="No courses found"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}

        {/* Courses Grid */}
        {!loading && courses.length > 0 && (
          <>
            <Row gutter={[24, 24]} className="mb-8">
              {courses.map((course) => (
                <Col xs={24} sm={12} lg={8} key={course.id}>
                  <Card
                    hoverable
                    className={`h-full shadow-md hover:shadow-lg transition-shadow ${styles.courseCard}`}
                  >
                    <div className="h-full flex flex-col p-6">
                      <div className="flex-1">
                        {/* Header with tags */}
                        <div className="mb-4">
                          <div className="flex flex-wrap gap-2 mb-3">
                            <Tag color="blue" className="text-xs font-medium">
                              {course.code}
                            </Tag>
                            <Tag color="green" className="text-xs font-medium">
                              {course.department?.name || "N/A"}
                            </Tag>
                          </div>

                          <Title
                            level={3}
                            className="mb-2 text-gray-800 leading-tight"
                          >
                            {course.name}
                          </Title>

                          <Paragraph
                            className="text-gray-600 mb-4 text-sm leading-relaxed"
                            ellipsis={{ rows: 3 }}
                          >
                            {course.description}
                          </Paragraph>
                        </div>

                        {/* Teacher Info */}
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center mb-2">
                            <UserOutlined className="text-blue-500 mr-2" />
                            <Text strong className="text-gray-800">
                              {course.teacher?.name || "N/A"}
                            </Text>
                          </div>

                          {course.teacher?.qualification && (
                            <Text
                              type="secondary"
                              className="text-xs block mb-1"
                            >
                              📚 {course.teacher.qualification}
                            </Text>
                          )}

                          {course.teacher?.specialization && (
                            <Text type="secondary" className="text-xs block">
                              🎯 {course.teacher.specialization}
                            </Text>
                          )}
                        </div>

                        {/* Course Details */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="flex items-center">
                            <ClockCircleOutlined className="text-orange-500 mr-2" />
                            <div>
                              <Text className="text-xs text-gray-500 block">
                                Duration
                              </Text>
                              <Text strong className="text-sm">
                                {course.duration} months
                              </Text>
                            </div>
                          </div>

                          <div className="flex items-center">
                            <TeamOutlined className="text-green-500 mr-2" />
                            <div>
                              <Text className="text-xs text-gray-500 block">
                                Enrolled
                              </Text>
                              <Text strong className="text-sm">
                                {course._count?.enrollments || 0}/
                                {course.capacity || 0}
                              </Text>
                            </div>
                          </div>
                        </div>

                        {/* Dates */}
                        <div className="mb-4 p-2 bg-blue-50 rounded">
                          <div className="flex items-center">
                            <CalendarOutlined className="text-blue-500 mr-2" />
                            <div>
                              <Text className="text-xs text-gray-500 block">
                                Course Period
                              </Text>
                              <Text className="text-sm font-medium">
                                {course.startDate
                                  ? formatDate(course.startDate)
                                  : "TBD"}{" "}
                                -{" "}
                                {course.endDate
                                  ? formatDate(course.endDate)
                                  : "TBD"}
                              </Text>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Enroll Button */}
                      <div className="mt-auto pt-4">
                        <button
                          onClick={() => (window.location.href = "/register")}
                          className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-md hover:shadow-lg"
                        >
                          Enroll Now
                        </button>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>

            {/* Pagination */}
            <div className="text-center">
              <Pagination
                current={pagination.currentPage}
                total={pagination.totalCourses}
                pageSize={pagination.limit}
                onChange={handlePageChange}
                showSizeChanger={false}
                showQuickJumper
                showTotal={(total, range) =>
                  `${range[0]}-${range[1]} of ${total} courses`
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ExploreCourses;
