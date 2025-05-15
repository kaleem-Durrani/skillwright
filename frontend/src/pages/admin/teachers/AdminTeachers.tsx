import React, { useState, useEffect } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useAdminQuery } from "@/hooks";
import { Teacher, QueryParams } from "@/common/types";
import { TeacherTable, TeacherFilter, CreateTeacherModal } from "./components";

const { Title } = Typography;

const AdminTeachers: React.FC = () => {
  const { notification } = App.useApp();
  const {
    getTeachersQuery,
    createTeacherMutation,
    deleteTeacherMutation,
    toggleTeacherBanMutation,
  } = useAdminQuery();

  // State
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Fetch teachers with filters
  const teachersQuery = getTeachersQuery(filterParams);

  useEffect(() => {
    if (teachersQuery.data?.data?.data) {
      setTeachers(teachersQuery.data.data.data);
    }
  }, [teachersQuery.data]);

  useEffect(() => {
    if (teachersQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load teachers. Please try again later.",
      });
    }
  }, [teachersQuery.isError, notification]);

  // Handlers
  const handleFilter = (values: any) => {
    const params: QueryParams = {};

    if (values.search) {
      params.search = values.search;
    }

    if (values.departmentId) {
      params.departmentId = values.departmentId;
    }

    if (values.isBanned) {
      params.isBanned = values.isBanned;
    }

    setFilterParams(params);
  };

  const handleResetFilter = () => {
    setFilterParams({});
  };

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  const handleCreateTeacher = async (values: any) => {
    try {
      await createTeacherMutation.mutateAsync(values);
      notification.success({
        message: "Success",
        description: "Teacher created successfully.",
      });
      setIsModalVisible(false);
      // Refetch teachers
      teachersQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to create teacher. Please try again.",
      });
    }
  };

  const handleDeleteTeacher = async (id: string) => {
    try {
      await deleteTeacherMutation.mutateAsync(id);
      notification.success({
        message: "Success",
        description: "Teacher deleted successfully.",
      });
      // Refetch teachers
      teachersQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to delete teacher. Please try again.",
      });
    }
  };

  const handleToggleBan = async (id: string, isBanned: boolean) => {
    try {
      await toggleTeacherBanMutation.mutateAsync({ id, isBanned });
      notification.success({
        message: "Success",
        description: `Teacher ${
          isBanned ? "banned" : "unbanned"
        } successfully.`,
      });
      // Refetch teachers
      teachersQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: `Failed to ${
          isBanned ? "ban" : "unban"
        } teacher. Please try again.`,
      });
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>Teachers</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Add Teacher
        </Button>
      </div>

      <TeacherFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <TeacherTable
        teachers={teachers}
        loading={teachersQuery.isLoading}
        onDelete={handleDeleteTeacher}
        onToggleBan={handleToggleBan}
      />

      <CreateTeacherModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleCreateTeacher}
        isSubmitting={createTeacherMutation?.isPending}
      />
    </div>
  );
};

export default AdminTeachers;
