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
  const [editingNewsEvent, setEditingNewsEvent] = useState<NewsEvent | null>(
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
    await deleteNewsEventMutation.mutateAsync(id);
  };

  const handleTogglePublish = async (id: string, _isPublished: boolean) => {
    await toggleNewsEventPublishMutation.mutateAsync(id);
  };

  const isLoading = newsEventsQuery.loading;
  const isSubmitting =
    createNewsEventMutation.loading || updateNewsEventMutation.loading;

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
        onDelete={handleDelete}
        onEdit={handleEdit}
        onTogglePublish={handleTogglePublish}
      />

      <CreateNewsEventModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        editingNewsEvent={editingNewsEvent}
      />
    </div>
  );
};

export default AdminNewsEvents;
