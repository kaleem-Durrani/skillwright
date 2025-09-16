import React, { useState, useCallback } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useApi, useMutation } from "@/hooks";
import { Teacher } from "@/common/types/models.types";
import { adminService, AdminQueryParams } from "@/services";
import { TeacherCreateData } from "@/common/types";
import { TeacherTable, TeacherFilter, CreateTeacherModal } from "./components";

const { Title } = Typography;

const AdminTeachers: React.FC = () => {
  const { notification } = App.useApp();

  // State
  const [filterParams, setFilterParams] = useState<AdminQueryParams>({
    page: 1,
    limit: 10,
  });
  const [isModalVisible, setIsModalVisible] = useState(false);

  // API calls
  const teachersQuery = useApi(() => adminService.getTeachers(filterParams), {
    dependencies: [filterParams],
    immediate: true,
  });

  const createTeacherMutation = useMutation(
    (data: TeacherCreateData) => adminService.createTeacher(data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Teacher created successfully.",
        });
        setIsModalVisible(false);
        teachersQuery.refetch();
      },
    }
  );

  const deleteTeacherMutation = useMutation(
    (id: string) => adminService.deleteTeacher(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Teacher deleted successfully.",
        });
        teachersQuery.refetch();
      },
    }
  );

  const toggleTeacherBanMutation = useMutation(
    (id: string) => adminService.toggleTeacherBan(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Teacher ban status updated successfully.",
        });
        teachersQuery.refetch();
      },
    }
  );

  // Extract data from API response
  const teachers = teachersQuery.data?.data?.items || [];
  const pagination = {
    current: teachersQuery.data?.data?.page || 1,
    total: teachersQuery.data?.data?.total || 0,
    pageSize: teachersQuery.data?.data?.limit || 10,
    hasMore: teachersQuery.data?.data?.hasMore || false,
  };

  // Handlers
  const handleFilter = (values: any) => {
    const params: AdminQueryParams = {
      page: 1, // Reset to first page when filtering
      limit: filterParams.limit || 10,
    };

    if (values.search) {
      params.search = values.search;
    }

    if (values.departmentId) {
      params.departmentId = values.departmentId;
    }

    if (values.isBanned !== undefined) {
      params.isBanned = values.isBanned;
    }

    setFilterParams(params);
  };

  const handleResetFilter = () => {
    setFilterParams({
      page: 1,
      limit: filterParams.limit || 10,
    });
  };

  const handlePageChange = (page: number, pageSize?: number) => {
    setFilterParams({
      ...filterParams,
      page,
      limit: pageSize || filterParams.limit || 10,
    });
  };

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  const handleCreateTeacher = async (values: TeacherCreateData) => {
    await createTeacherMutation.mutateAsync(values);
  };

  const handleDeleteTeacher = async (id: string) => {
    await deleteTeacherMutation.mutateAsync(id);
  };

  const handleToggleBan = async (id: string, isBanned: boolean) => {
    await toggleTeacherBanMutation.mutateAsync(id);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2} className="text-3xl md:text-4xl font-bold">
          Teachers
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Add Teacher
        </Button>
      </div>

      <TeacherFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <TeacherTable
        teachers={teachers as any}
        loading={teachersQuery.loading}
        onDelete={handleDeleteTeacher}
        onToggleBan={handleToggleBan}
        pagination={{
          current: pagination.current,
          total: pagination.total,
          pageSize: pagination.pageSize,
          showSizeChanger: true,
          showTotal: (total, range) =>
            `${range[0]}-${range[1]} of ${total} teachers`,
          onChange: handlePageChange,
          onShowSizeChange: handlePageChange,
        }}
      />

      <CreateTeacherModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleCreateTeacher}
        isSubmitting={createTeacherMutation.loading}
      />
    </div>
  );
};

export default AdminTeachers;
