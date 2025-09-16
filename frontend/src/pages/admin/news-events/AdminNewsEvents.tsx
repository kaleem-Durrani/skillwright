import React, { useState } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  NewsEvent,
  NewsEventCreateData,
  NewsEventUpdateData,
} from "@/common/types";
import {
  NewsEventTable,
  NewsEventFilter,
  CreateNewsEventModal,
  ViewNewsEventModal,
} from "./components";
import { useApi, useMutation } from "@/hooks";
import { adminService, AdminQueryParams } from "@/services";

const { Title } = Typography;

const AdminNewsEvents: React.FC = () => {
  const { notification } = App.useApp();

  // State
  const [filterParams, setFilterParams] = useState<AdminQueryParams>({
    page: 1,
    limit: 10,
  });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isViewModalVisible, setIsViewModalVisible] = useState(false);
  const [editingNewsEvent, setEditingNewsEvent] = useState<NewsEvent | null>(
    null
  );
  const [viewingNewsEvent, setViewingNewsEvent] = useState<NewsEvent | null>(
    null
  );

  // API calls
  const newsEventsQuery = useApi(
    () => adminService.getNewsEvents(filterParams),
    {
      dependencies: [filterParams],
      immediate: true,
    }
  );

  // Mutations
  const createNewsEventMutation = useMutation(
    (data: NewsEventCreateData) => adminService.createNewsEvent(data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "News event created successfully.",
        });
        setIsModalVisible(false);
        newsEventsQuery.refetch();
      },
    }
  );

  const updateNewsEventMutation = useMutation(
    ({ id, data }: { id: string; data: NewsEventUpdateData }) =>
      adminService.updateNewsEvent(id, data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "News event updated successfully.",
        });
        setIsModalVisible(false);
        setEditingNewsEvent(null);
        newsEventsQuery.refetch();
      },
    }
  );

  const deleteNewsEventMutation = useMutation(
    (id: string) => adminService.deleteNewsEvent(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "News event deleted successfully.",
        });
        newsEventsQuery.refetch();
      },
      onError: (error: any) => {
        notification.error({
          message: "Error",
          description:
            error.response?.data?.message ||
            "Failed to delete news event. Please try again.",
        });
      },
    }
  );

  const toggleNewsEventPublishMutation = useMutation(
    (id: string) => adminService.toggleNewsEventPublish(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "News event publish status updated successfully.",
        });
        newsEventsQuery.refetch();
      },
      onError: (error: any) => {
        notification.error({
          message: "Error",
          description:
            error.response?.data?.message ||
            "Failed to update publish status. Please try again.",
        });
      },
    }
  );

  // Extract data from API response
  const newsEvents = newsEventsQuery.data?.data?.items || [];

  // Handlers
  const handleFilter = (values: any) => {
    const params: AdminQueryParams = {
      page: 1, // Reset to first page when filtering
      limit: filterParams.limit || 10,
    };

    if (values.search) {
      params.search = values.search;
    }

    if (values.type) {
      params.type = values.type;
    }

    if (values.isPublished !== undefined) {
      params.isPublished = values.isPublished;
    }

    setFilterParams(params);
  };

  const handleResetFilter = () => {
    setFilterParams({
      page: 1,
      limit: filterParams.limit || 10,
    });
  };

  const showModal = () => {
    setEditingNewsEvent(null);
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
    setEditingNewsEvent(null);
  };

  const handleEdit = (newsEvent: NewsEvent) => {
    setEditingNewsEvent(newsEvent);
    setIsModalVisible(true);
  };

  const handleView = (newsEvent: NewsEvent) => {
    setViewingNewsEvent(newsEvent);
    setIsViewModalVisible(true);
  };

  const handleViewCancel = () => {
    setIsViewModalVisible(false);
    setViewingNewsEvent(null);
  };

  const handleSubmit = async (
    values: NewsEventCreateData | NewsEventUpdateData
  ) => {
    if (editingNewsEvent) {
      await updateNewsEventMutation.mutateAsync({
        id: editingNewsEvent.id,
        data: values as NewsEventUpdateData,
      });
    } else {
      await createNewsEventMutation.mutateAsync(values as NewsEventCreateData);
    }
  };

  const handleDelete = async (id: string) => {
    console.log("handleDelete called with ID:", id);
    try {
      console.log("Calling deleteNewsEventMutation.mutateAsync...");
      await deleteNewsEventMutation.mutateAsync(id);
      console.log("Delete mutation completed successfully");
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const handleTogglePublish = async (id: string, _isPublished: boolean) => {
    console.log(
      "handleTogglePublish called with ID:",
      id,
      "isPublished:",
      _isPublished
    );
    try {
      console.log("Calling toggleNewsEventPublishMutation.mutateAsync...");
      await toggleNewsEventPublishMutation.mutateAsync(id);
      console.log("Toggle publish mutation completed successfully");
    } catch (error) {
      console.error("Toggle publish error:", error);
    }
  };

  const isLoading = newsEventsQuery.loading;
  const isSubmitting =
    createNewsEventMutation.loading || updateNewsEventMutation.loading;
  const isDeleting = deleteNewsEventMutation.loading;
  const isToggling = toggleNewsEventPublishMutation.loading;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>News & Events</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Add New
        </Button>
      </div>

      <NewsEventFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <NewsEventTable
        newsEvents={newsEvents}
        loading={isLoading}
        deleteLoading={isDeleting}
        toggleLoading={isToggling}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onView={handleView}
        onTogglePublish={handleTogglePublish}
      />

      <CreateNewsEventModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        editingNewsEvent={editingNewsEvent}
      />

      <ViewNewsEventModal
        visible={isViewModalVisible}
        newsEvent={viewingNewsEvent}
        onCancel={handleViewCancel}
      />
    </div>
  );
};

export default AdminNewsEvents;
