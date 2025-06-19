import React, { useState } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useApi, useMutation } from "@/hooks";
import { Student } from "@/common/types";
import { adminService, AdminQueryParams } from "@/services";
import { StudentTable, StudentFilter, CreateStudentModal } from "./components";

const { Title } = Typography;

const AdminStudents: React.FC = () => {
  const { notification } = App.useApp();

  // State
  const [filterParams, setFilterParams] = useState<AdminQueryParams>({
    page: 1,
    limit: 10,
  });
  const [isModalVisible, setIsModalVisible] = useState(false);

  // API calls
  const studentsQuery = useApi(() => adminService.getStudents(filterParams), {
    dependencies: [filterParams],
    immediate: true,
  });

  const deleteStudentMutation = useMutation(
    (id: string) => adminService.deleteStudent(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Student deleted successfully.",
        });
        studentsQuery.refetch();
      },
    }
  );

  const toggleStudentBanMutation = useMutation(
    (id: string) => adminService.toggleStudentBan(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Student ban status updated successfully.",
        });
        studentsQuery.refetch();
      },
    }
  );

  // Extract data from API response
  const students = studentsQuery.data?.data?.items || [];

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

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  // Note: Student creation is not implemented in backend yet
  const handleCreateStudent = async (_values: any) => {
    notification.info({
      message: "Feature Not Available",
      description: "Student creation feature is not implemented yet.",
    });
    setIsModalVisible(false);
  };

  const handleDeleteStudent = async (id: string) => {
    try {
      await deleteStudentMutation.mutateAsync(id);
      notification.success({
        message: "Success",
        description: "Student deleted successfully.",
      });
      // Refetch students
      studentsQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to delete student. Please try again.",
      });
    }
  };

  const handleToggleBan = async (id: string, _isBanned: boolean) => {
    await toggleStudentBanMutation.mutateAsync(id);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>Students</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Add Student
        </Button>
      </div>

      <StudentFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <StudentTable
        students={students as any}
        loading={studentsQuery.loading}
        onDelete={handleDeleteStudent}
        onToggleBan={handleToggleBan}
      />

      <CreateStudentModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleCreateStudent}
        isSubmitting={false}
      />
    </div>
  );
};

export default AdminStudents;
