import React, { useState, useEffect } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useAdminQuery } from "@/hooks";
import { Student, QueryParams } from "@/common/types";
import { StudentTable, StudentFilter, CreateStudentModal } from "./components";

const { Title } = Typography;

const AdminStudents: React.FC = () => {
  const { notification } = App.useApp();
  const {
    getStudentsQuery,
    createStudentMutation,
    deleteStudentMutation,
    toggleStudentBanMutation,
  } = useAdminQuery();

  // State
  const [students, setStudents] = useState<Student[]>([]);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Fetch students with filters
  const studentsQuery = getStudentsQuery(filterParams);

  useEffect(() => {
    if (studentsQuery.data?.data?.data) {
      setStudents(studentsQuery.data.data.data);
    }
  }, [studentsQuery.data]);

  useEffect(() => {
    if (studentsQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load students. Please try again later.",
      });
    }
  }, [studentsQuery.isError, notification]);

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

  const handleCreateStudent = async (values: any) => {
    try {
      await createStudentMutation.mutateAsync(values);
      notification.success({
        message: "Success",
        description: "Student created successfully.",
      });
      setIsModalVisible(false);
      // Refetch students
      studentsQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to create student. Please try again.",
      });
    }
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

  const handleToggleBan = async (id: string, isBanned: boolean) => {
    try {
      await toggleStudentBanMutation.mutateAsync({ id, isBanned });
      notification.success({
        message: "Success",
        description: `Student ${
          isBanned ? "banned" : "unbanned"
        } successfully.`,
      });
      // Refetch students
      studentsQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: `Failed to ${
          isBanned ? "ban" : "unban"
        } student. Please try again.`,
      });
    }
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
        students={students}
        loading={studentsQuery.isLoading}
        onDelete={handleDeleteStudent}
        onToggleBan={handleToggleBan}
      />

      <CreateStudentModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleCreateStudent}
        isSubmitting={createStudentMutation.isPending}
      />
    </div>
  );
};

export default AdminStudents;
