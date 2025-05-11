import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Typography, Card } from "antd";
import { useStudentQuery } from "@/hooks";
import { ResourceWithDetails, CourseWithEnrollment } from "@/common/types";
import { ResourceList, ResourceFilter } from "./components";

const { Title, Text } = Typography;

const StudentResources = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [resourceType, setResourceType] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const pageSize = 10;

  // Get student's enrolled courses
  const { getEnrolledCoursesQuery, getCourseResourcesQuery } =
    useStudentQuery();

  const { data: enrolledCoursesData, isLoading: isLoadingCourses } =
    getEnrolledCoursesQuery();

  // Get resources for the selected course
  const { data: resourcesData, isLoading: isLoadingResources } =
    getCourseResourcesQuery(selectedCourseId, {
      page: currentPage,
      limit: pageSize,
      search: searchText,
      type: resourceType || undefined,
    });

  // Extract courses from the API response
  const enrolledCoursesResponse = enrolledCoursesData?.data?.data as any;
  const enrolledCourses = enrolledCoursesResponse?.items || [];

  // Filter enrolled courses to get only approved ones
  const approvedCourses = enrolledCourses.filter(
    (course: CourseWithEnrollment) =>
      course.enrollments && course.enrollments[0]?.status === "APPROVED"
  );

  // Extract resources from the API response
  const resourcesResponse = resourcesData?.data?.data as any;
  const resources = resourcesResponse?.items || [];

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, resourceType, selectedCourseId]);

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
    navigate(`/student/resources/${resourceId}/comments`);
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

  return (
    <div className="p-6">
      <div className="mb-6">
        <Title level={2}>Learning Resources</Title>
        <Text className="text-gray-600">
          Access course materials and learning resources
        </Text>
      </div>

      {/* Filters */}
      <ResourceFilter
        searchText={searchText}
        onSearchChange={handleSearch}
        resourceType={resourceType}
        onResourceTypeChange={handleTypeFilter}
        selectedCourseId={selectedCourseId}
        onCourseChange={handleCourseChange}
        courses={approvedCourses}
        isLoadingCourses={isLoadingCourses}
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
            isLoading={isLoadingResources}
            currentPage={currentPage}
            pageSize={pageSize}
            total={resourcesResponse?.total || 0}
            onPageChange={handlePageChange}
            onView={handleViewResource}
            onViewComments={handleViewComments}
            emptyText="No resources found for this course"
          />
        )}
      </Card>
    </div>
  );
};

export default StudentResources;
