import React, { useState } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { NewsEvent, QueryParams } from "@/common/types";
import {
  NewsEventTable,
  NewsEventFilter,
  CreateNewsEventModal,
} from "./components";
import dayjs from "dayjs";
import { newsApi } from "@/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const { Title } = Typography;

const AdminNewsEvents: React.FC = () => {
  const { notification } = App.useApp();
  const queryClient = useQueryClient();

  // State
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingNewsEvent, setEditingNewsEvent] = useState<NewsEvent | null>(
    null
  );

  // Queries
  const newsEventsQuery = useQuery({
    queryKey: ["admin", "newsEvents", filterParams],
    queryFn: () => newsApi.adminGetAllNewsEvents(filterParams),
  });

  // Mutations
  const createNewsEventMutation = useMutation({
    mutationFn: (data: any) => newsApi.adminCreateNewsEvent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "newsEvents"] });
      notification.success({
        message: "Success",
        description: "Item created successfully.",
      });
      setIsModalVisible(false);
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to create item. Please try again.",
      });
    },
  });

  const updateNewsEventMutation = useMutation({
    mutationFn: (data: any) => newsApi.adminUpdateNewsEvent(data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "newsEvents"] });
      notification.success({
        message: "Success",
        description: "Item updated successfully.",
      });
      setIsModalVisible(false);
      setEditingNewsEvent(null);
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to update item. Please try again.",
      });
    },
  });

  const deleteNewsEventMutation = useMutation({
    mutationFn: (id: string) => newsApi.adminDeleteNewsEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "newsEvents"] });
      notification.success({
        message: "Success",
        description: "Item deleted successfully.",
      });
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to delete item. Please try again.",
      });
    },
  });

  const toggleNewsEventPublishMutation = useMutation({
    mutationFn: ({ id }: { id: string; isPublished: boolean }) =>
      newsApi.adminToggleNewsEventPublish(id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "newsEvents"] });
      notification.success({
        message: "Success",
        description: `Item ${
          variables.isPublished ? "published" : "unpublished"
        } successfully.`,
      });
    },
    onError: (_, variables) => {
      notification.error({
        message: "Error",
        description: `Failed to ${
          variables.isPublished ? "publish" : "unpublish"
        } item. Please try again.`,
      });
    },
  });

  // Handlers
  const handleFilter = (values: any) => {
    const params: QueryParams = {};

    if (values.search) {
      params.search = values.search;
    }

    if (values.type) {
      params.type = values.type;
    }

    if (values.dateRange && values.dateRange.length === 2) {
      params.startDate = values.dateRange[0].startOf("day").toISOString();
      params.endDate = values.dateRange[1].endOf("day").toISOString();
    }

    if (values.isPublished !== undefined) {
      params.isPublished = values.isPublished;
    }

    setFilterParams(params);
  };

  const handleResetFilter = () => {
    setFilterParams({});
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

  const handleSubmit = (values: any) => {
    if (editingNewsEvent) {
      updateNewsEventMutation.mutate({ ...values, id: editingNewsEvent.id });
    } else {
      createNewsEventMutation.mutate(values);
    }
  };

  const handleDelete = (id: string) => {
    deleteNewsEventMutation.mutate(id);
  };

  const handleTogglePublish = (id: string, isPublished: boolean) => {
    toggleNewsEventPublishMutation.mutate({ id, isPublished });
  };

  // Get data from query
  const newsEvents = newsEventsQuery.data?.data?.data || [];
  const isLoading = newsEventsQuery.isLoading;
  const isSubmitting =
    createNewsEventMutation.isPending || updateNewsEventMutation.isPending;

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
