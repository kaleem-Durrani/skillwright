import React, { useState } from "react";
import { Typography, Button, App, Pagination } from "antd";
import { PlusOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useApi, useMutation } from "@/hooks";
import { teacherService, resourceService } from "@/services";
import { Resource, QueryParams } from "@/common/types";
import { ROUTES } from "@/common/constants";
import {
  ResourceList,
  ResourceFilter,
  CreateResourceModal,
  ViewResourceModal,
  EditResourceModal,
} from "./components";

const { Title } = Typography;

const TeacherResources: React.FC = () => {
  const { notification, modal } = App.useApp();
  const navigate = useNavigate();
  // State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isViewModalVisible, setIsViewModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null
  );

  // API calls
  const resourcesQuery = useApi(
    () =>
      teacherService.getMyResources({
        page: currentPage,
        limit: pageSize,
        ...filterParams,
      }),
    {
      immediate: true,
      dependencies: [currentPage, pageSize, filterParams],
    }
  );

  const createResourceMutation = useMutation(resourceService.createResource, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Resource created successfully.",
      });
      setIsCreateModalVisible(false);
      resourcesQuery.refetch();
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to create resource. Please try again.",
      });
    },
  });

  const updateResourceMutation = useMutation(
    ({ id, formData }: { id: string; formData: FormData }) =>
      resourceService.updateResource(id, formData),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Resource updated successfully.",
        });
        setIsEditModalVisible(false);
        setSelectedResource(null);
        resourcesQuery.refetch();
      },
      onError: () => {
        notification.error({
          message: "Error",
          description: "Failed to update resource. Please try again.",
        });
      },
    }
  );

  const deleteResourceMutation = useMutation(resourceService.deleteResource, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Resource deleted successfully.",
      });
      resourcesQuery.refetch();
    },
    onError: (error: any) => {
      console.error("Delete mutation error:", error);
      notification.error({
        message: "Error",
        description: "Failed to delete resource. Please try again.",
      });
    },
  });

  // Extract data
  const responseData = resourcesQuery.data?.data as any;
  const resources = responseData?.items || [];
  const pagination = responseData?.pagination || {
    total: 0,
    page: 1,
    limit: 12,
    hasMore: false,
  };

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

  const showCreateModal = () => {
    setIsCreateModalVisible(true);
  };

  const handleCreateCancel = () => {
    setIsCreateModalVisible(false);
  };

  const handleViewCancel = () => {
    setIsViewModalVisible(false);
    setSelectedResource(null);
  };

  const handleEditCancel = () => {
    setIsEditModalVisible(false);
    setSelectedResource(null);
  };

  const handleCreateResource = async (formData: FormData) => {
    try {
      await createResourceMutation.mutateAsync(formData);
    } catch (error) {
      console.error("Create resource error:", error);
    }
  };

  const handleViewResource = (resource: Resource) => {
    setSelectedResource(resource);
    setIsViewModalVisible(true);
  };

  const handleEditResource = (resource: Resource) => {
    setSelectedResource(resource);
    setIsEditModalVisible(true);
  };

  const handleUpdateResource = async (id: string, formData: FormData) => {
    try {
      await updateResourceMutation.mutateAsync({ id, formData });
    } catch (error) {
      console.error("Update resource error:", error);
    }
  };

  const handleDeleteResource = (id: string) => {
    console.log("Delete resource called with ID:", id);
    modal.confirm({
      title: "Are you sure you want to delete this resource?",
      icon: <ExclamationCircleOutlined />,
      content: "This action cannot be undone.",
      okText: "Yes, Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        console.log("Delete confirmed for ID:", id);
        try {
          await deleteResourceMutation.mutateAsync(id);
          console.log("Delete successful for ID:", id);
        } catch (error) {
          console.error("Delete resource error:", error);
        }
      },
    });
  };

  const handleResourceCardClick = (resource: Resource) => {
    navigate(ROUTES.TEACHER.RESOURCE_COMMENTS(resource.id));
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>My Resources</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={showCreateModal}
        >
          Create Resource
        </Button>
      </div>

      <ResourceFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <ResourceList
        resources={resources}
        loading={resourcesQuery.loading}
        onView={handleViewResource}
        onEdit={handleEditResource}
        onDelete={handleDeleteResource}
        onCardClick={handleResourceCardClick}
      />

      {pagination.total > 0 && (
        <div className="flex justify-center mt-6">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={pagination.total}
            onChange={handlePageChange}
            showSizeChanger
            showQuickJumper
            showTotal={(total) => `Total ${total} resources`}
          />
        </div>
      )}

      <CreateResourceModal
        visible={isCreateModalVisible}
        onCancel={handleCreateCancel}
        onSubmit={handleCreateResource}
        isSubmitting={createResourceMutation.loading}
      />

      <ViewResourceModal
        visible={isViewModalVisible}
        resource={selectedResource}
        loading={false}
        onCancel={handleViewCancel}
      />

      <EditResourceModal
        visible={isEditModalVisible}
        resource={selectedResource}
        onCancel={handleEditCancel}
        onSubmit={handleUpdateResource}
        isSubmitting={updateResourceMutation.loading}
      />
    </div>
  );
};

export default TeacherResources;
