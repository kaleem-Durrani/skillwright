import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Typography, Card, Tabs, Space, Input } from "antd";
import {
  BookOutlined,
  GlobalOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useApi } from "@/hooks";
import { studentService } from "@/services";
import {
  ResourceWithDetails,
  CourseWithEnrollment,
  ApiResponse,
  PaginatedResponse,
  Resource,
} from "@/common/types";
import { ResourceList, ResourceFilter } from "./components";
import { ROUTES } from "@/common";

const { Title, Text } = Typography;
const { Search } = Input;

const StudentResources = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("enrolled");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [resourceType, setResourceType] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const pageSize = 10;

  // API calls for enrolled courses
  const enrolledCoursesQuery = useApi(
    () => studentService.getEnrolledCourses({ limit: 100 }),
    { immediate: true }
  );

  // Get resources for the selected course (enrolled tab)
  const resourcesQuery = useApi(
    () =>
      selectedCourseId && activeTab === "enrolled"
        ? studentService.getCourseResources(selectedCourseId, {
            page: currentPage,
            limit: pageSize,
            search: searchText,
            type: resourceType || undefined,
          })
        : Promise.resolve({
            success: true,
            message: "No course selected",
            data: {
              items: [],
              pagination: {
                total: 0,
                page: 1,
                limit: pageSize,
                totalPages: 0,
                hasMore: false,
              },
            },
          } as any),
    {
      immediate: !!selectedCourseId && activeTab === "enrolled",
      dependencies: [
        selectedCourseId,
        currentPage,
        pageSize,
        searchText,
        resourceType,
        activeTab,
      ],
    }
  );

  // Get all public resources (public tab)
  const publicResourcesQuery = useApi(
    () =>
      activeTab === "public"
        ? studentService.getAllPublicResources({
            page: currentPage,
            limit: pageSize,
            search: searchText,
            type: resourceType || undefined,
          })
        : Promise.resolve({
            success: true,
            message: "No public resources",
            data: {
              items: [],
              pagination: {
                total: 0,
                page: 1,
                limit: pageSize,
                totalPages: 0,
                hasMore: false,
              },
            },
          } as any),
    {
      immediate: activeTab === "public",
      dependencies: [
        currentPage,
        pageSize,
        searchText,
        resourceType,
        activeTab,
      ],
    }
  );

  // Extract courses from the API response
  const enrolledCoursesResponse = enrolledCoursesQuery.data?.data as any;
  const enrolledCourses = enrolledCoursesResponse?.items || [];

  // Extract resources from the API response
  const resourcesResponse = resourcesQuery.data?.data as any;
  const publicResourcesResponse = publicResourcesQuery.data?.data as any;

  const currentQuery =
    activeTab === "enrolled" ? resourcesQuery : publicResourcesQuery;
  const currentResponse =
    activeTab === "enrolled" ? resourcesResponse : publicResourcesResponse;
  const resources = currentResponse?.items || [];

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, resourceType, selectedCourseId, activeTab]);

  // Handle view resource
  const handleViewResource = (resourceId: string) => {
    // Find the resource to get its URL
    const resource = resources.find(
      (r: ResourceWithDetails) => r.id === resourceId
    );
    if (resource && resource.url) {
      window.open(resource.url, "_blank");
    }
  };

  // Handle view comments
  const handleViewComments = (resourceId: string) => {
    // Navigate to resource comments page
    navigate(ROUTES.STUDENT.RESOURCE_COMMENTS(resourceId));
  };

  // Handle course selection
  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId);
  };

  // Handle search
  const handleSearch = (value: string) => {
    setSearchText(value);
  };

  // Handle resource type filter
  const handleTypeFilter = (value: string) => {
    setResourceType(value);
  };

  // Handle pagination
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const tabItems = [
    {
      key: "enrolled",
      label: (
        <Space>
          <BookOutlined />
          <span>My Course Resources</span>
        </Space>
      ),
      children: (
        <div>
          {/* Filters for enrolled courses */}
          <ResourceFilter
            searchText={searchText}
            onSearchChange={handleSearch}
            resourceType={resourceType}
            onResourceTypeChange={handleTypeFilter}
            selectedCourseId={selectedCourseId}
            onCourseChange={handleCourseChange}
            courses={enrolledCourses}
            isLoadingCourses={enrolledCoursesQuery.loading}
          />

          {/* Resources List */}
          <Card>
            {!selectedCourseId ? (
              <div className="text-center py-8">
                <Text>Please select a course to view resources</Text>
              </div>
            ) : (
              <ResourceList
                resources={resources}
                isLoading={currentQuery.loading}
                currentPage={currentPage}
                pageSize={pageSize}
                total={currentResponse?.pagination?.total || 0}
                onPageChange={handlePageChange}
                onView={handleViewResource}
                onViewComments={handleViewComments}
                emptyText="No resources found for this course"
              />
            )}
          </Card>
        </div>
      ),
    },
    {
      key: "public",
      label: (
        <Space>
          <GlobalOutlined />
          <span>Public Resources</span>
        </Space>
      ),
      children: (
        <div>
          {/* Search and filters for public resources */}
          <div className="mb-4 flex gap-4">
            <Search
              placeholder="Search public resources..."
              allowClear
              enterButton={<SearchOutlined />}
              size="large"
              style={{ flex: 1 }}
              onSearch={handleSearch}
              onChange={(e) => !e.target.value && setSearchText("")}
            />
            <select
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Types</option>
              <option value="DOCUMENT">Documents</option>
              <option value="VIDEO">Videos</option>
              <option value="LINK">Links</option>
            </select>
          </div>

          {/* Public Resources List */}
          <Card>
            <ResourceList
              resources={resources}
              isLoading={currentQuery.loading}
              currentPage={currentPage}
              pageSize={pageSize}
              total={currentResponse?.pagination?.total || 0}
              onPageChange={handlePageChange}
              onView={handleViewResource}
              onViewComments={handleViewComments}
              emptyText="No public resources found"
            />
          </Card>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Title level={2}>Learning Resources</Title>
          <Text className="text-gray-600">
            Access course materials and learning resources
          </Text>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="large"
      />
    </div>
  );
};

export default StudentResources;
