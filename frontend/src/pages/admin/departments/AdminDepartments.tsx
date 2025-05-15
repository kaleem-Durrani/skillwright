import React, { useState, useEffect } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useDepartmentQuery } from "@/hooks";
import { Department, QueryParams } from "@/common/types";
import {
  DepartmentTable,
  DepartmentFilter,
  CreateDepartmentModal,
} from "./components";

const { Title } = Typography;

const AdminDepartments: React.FC = () => {
  const { notification } = App.useApp();
  const {
    getAllDepartmentsQuery,
    createDepartmentMutation,
    updateDepartmentMutation,
    deleteDepartmentMutation,
  } = useDepartmentQuery();

  // State
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filterParams, setFilterParams] = useState<QueryParams>({});
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null
  );

  // Fetch departments with filters
  const departmentsQuery = getAllDepartmentsQuery(filterParams);

  useEffect(() => {
    if (departmentsQuery.data?.data?.data) {
      setDepartments(departmentsQuery.data.data.data);
    }
  }, [departmentsQuery.data]);

  useEffect(() => {
    if (departmentsQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load departments. Please try again later.",
      });
    }
  }, [departmentsQuery.isError, notification]);

  // Handlers
  const handleFilter = (values: any) => {
    const params: QueryParams = {};

    if (values.search) {
      params.search = values.search;
    }

    setFilterParams(params);
  };

  const handleResetFilter = () => {
    setFilterParams({});
  };

  const showModal = () => {
    setEditingDepartment(null);
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
    setEditingDepartment(null);
  };

  const handleEdit = (department: Department) => {
    setEditingDepartment(department);
    setIsModalVisible(true);
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingDepartment) {
        // Update existing department
        await updateDepartmentMutation.mutateAsync(values);
        notification.success({
          message: "Success",
          description: "Department updated successfully.",
        });
      } else {
        // Create new department
        await createDepartmentMutation.mutateAsync(values);
        notification.success({
          message: "Success",
          description: "Department created successfully.",
        });
      }
      setIsModalVisible(false);
      setEditingDepartment(null);
      // Refetch departments
      departmentsQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: `Failed to ${
          editingDepartment ? "update" : "create"
        } department. Please try again.`,
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDepartmentMutation.mutateAsync(id);
      notification.success({
        message: "Success",
        description: "Department deleted successfully.",
      });
      // Refetch departments
      departmentsQuery.refetch();
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to delete department. Please try again.",
      });
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2}>Departments</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
          Add Department
        </Button>
      </div>

      <DepartmentFilter onSearch={handleFilter} onReset={handleResetFilter} />

      <DepartmentTable
        departments={departments}
        loading={departmentsQuery.isLoading}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />

      <CreateDepartmentModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
        isSubmitting={
          createDepartmentMutation.isPending ||
          updateDepartmentMutation.isPending
        }
        editingDepartment={editingDepartment}
      />
    </div>
  );
};

export default AdminDepartments;
