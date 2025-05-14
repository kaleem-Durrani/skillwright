import React, { useState, useEffect } from "react";
import { Typography, Button, App, Pagination, Modal } from "antd";
import { PlusOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { useTeacherQuery } from "@/hooks";
import { Resource, QueryParams, ResourceCreateData } from "@/common/types";
import {
  ResourceList,
  ResourceFilter,
  CreateResourceModal,
} from "./components";

const { Title } = Typography;
const { confirm } = Modal;

const TeacherResources: React.FC = () => {
  const { notification } = App.useApp();
  const {
    getMyCoursesQuery,
    getCourseResourcesQuery,
    createResourceMutation,
    deleteResourceMutation,
  } = useTeacherQuery();

  // State
  const [resources, setResources] = useState<Resource[]>([]);
  const [totalResources, setTotalResources] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  // Get all courses to extract resources
  const coursesQuery = getMyCoursesQuery();

  // Fetch resources from all courses
  useEffect(() => {
    if (coursesQuery.data?.data?.data) {
      const courses = coursesQuery.data.data.data;
      let allResources: Resource[] = [];

      // Extract resources from all courses
      courses.forEach((course) => {
        if (course.resources) {
          allResources = [...allResources, ...course.resources];
        }
      });

      // Apply filters
      if (filterParams.search) {
        allResources = allResources.filter((resource) =>
          resource.title
            .toLowerCase()
            .includes(filterParams.search!.toLowerCase())
        );
      }

      if (filterParams.courseId) {
        allResources = allResources.filter(
          (resource) => resource.courseId === filterParams.courseId
        );
      }

      if (filterParams.type) {
        allResources = allResources.filter(
          (resource) => resource.type === filterParams.type
        );
      }

      if (filterParams.isPublic) {
        allResources = allResources.filter(
          (resource) => resource.isPublic === true
        );
      }

      // Sort by creation date (newest first)
      allResources.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setTotalResources(allResources.length);

      // Apply pagination
      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;
      setResources(allResources.slice(start, end));
    }
  }, [coursesQuery.data, filterParams, currentPage, pageSize]);

  useEffect(() => {
    if (coursesQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load resources. Please try again later.",
      });
    }
  }, [coursesQuery.isError, notification]);

  // Handlers
  const handlePageChange = (page: number, pageSize?: number) => {
    setCurrentPage(page);
    if (pageSize) setPageSize(pageSize);
  };

  const handleFilter = (values: any) => {
    const params: QueryParams = {};

    if (values.search) {
      params.search = values.search;
    }

    if (values.courseId) {
      params.courseId = values.courseId;
    }

    if (values.type) {
      params.type = values.type;
    }

    if (values.isPublic) {
      params.isPublic = values.isPublic;
    }

    setFilterParams(params);
    setCurrentPage(1); // Reset to first page when filtering
  };

  const handleResetFilter = () => {
    setFilterParams({});
    setCurrentPage(1);
  };

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  const handleCreateResource = async (values: ResourceCreateData) => {
    try {
      await createResourceMutation.mutateAsync(values);
      notification.success({
        message: "Success",
        description: "Resource created successfully.",
      });
      setIsModalVisible(false);
      // Refetch courses to get updated resources
      coursesQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to create resource. Please try again.",
      });
    }
  };

  const handleDeleteResource = (id: string) => {
    confirm({
      title: "Are you sure you want to delete this resource?",
      icon: <ExclamationCircleOutlined />,
      content: "This action cannot be undone.",
      okText: "Yes, Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await deleteResourceMutation.mutateAsync(id);
          notification.success({
            message: "Success",
            description: "Resource deleted successfully.",
          });
          // Refetch courses to get updated resources
          coursesQuery.refetch();
        } catch (error) {
          notification.error({
            message: "Error",
            description: "Failed to delete resource. Please try again.",
          });
        }
      },
    });
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>My Resources</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Create Resource
        </Button>
      </div>

      <ResourceFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <ResourceList
        resources={resources}
        loading={coursesQuery.isLoading}
        onDelete={handleDeleteResource}
      />

      {totalResources > 0 && (
        <div className="flex justify-center mt-6">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={totalResources}
            onChange={handlePageChange}
            showSizeChanger
            showQuickJumper
            showTotal={(total) => `Total ${total} resources`}
          />
        </div>
      )}

      <CreateResourceModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleCreateResource}
        isSubmitting={createResourceMutation.isPending}
      />
    </div>
  );
};

export default TeacherResources;
