import React, { useState } from "react";
import { Typography, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useApi, useMutation } from "@/hooks";
import {
  Department,
  DepartmentCreateData,
  DepartmentUpdateData,
} from "@/common/types";
import { departmentService, DepartmentQueryParams } from "@/services";
import {
  DepartmentTable,
  DepartmentFilter,
  CreateDepartmentModal,
} from "./components";

const { Title } = Typography;

const AdminDepartments: React.FC = () => {
  const { notification } = App.useApp();

  // State
  const [filterParams, setFilterParams] = useState<DepartmentQueryParams>({
    page: 1,
    limit: 10,
  });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null
  );

  // API calls
  const departmentsQuery = useApi(
    () => departmentService.getDepartments(filterParams),
    {
      dependencies: [filterParams],
      immediate: true,
    }
  );

  const createDepartmentMutation = useMutation(
    (data: DepartmentCreateData) => departmentService.createDepartment(data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Department created successfully.",
        });
        setIsModalVisible(false);
        setEditingDepartment(null);
        departmentsQuery.refetch();
      },
    }
  );

  const updateDepartmentMutation = useMutation(
    ({ id, data }: { id: string; data: DepartmentUpdateData }) =>
      departmentService.updateDepartment(id, data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Department updated successfully.",
        });
        setIsModalVisible(false);
        setEditingDepartment(null);
        departmentsQuery.refetch();
      },
    }
  );

  const deleteDepartmentMutation = useMutation(
    (id: string) => departmentService.deleteDepartment(id),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Department deleted successfully.",
        });
        departmentsQuery.refetch();
      },
    }
  );

  // Extract data from API response
  const departments = departmentsQuery.data?.data?.items || [];

  // Handlers
  const handleFilter = (values: any) => {
    const params: DepartmentQueryParams = {
      page: 1, // Reset to first page when filtering
      limit: filterParams.limit || 10,
    };

    if (values.search) {
      params.search = values.search;
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

  const handleSubmit = async (
    values: DepartmentCreateData | DepartmentUpdateData
  ) => {
    if (editingDepartment) {
      await updateDepartmentMutation.mutateAsync({
        id: editingDepartment.id,
        data: values as DepartmentUpdateData,
      });
    } else {
      await createDepartmentMutation.mutateAsync(
        values as DepartmentCreateData
      );
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDepartmentMutation.mutateAsync(id);
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
        departments={departments as any}
        loading={departmentsQuery.loading}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />

      <CreateDepartmentModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
        isSubmitting={
          createDepartmentMutation.loading || updateDepartmentMutation.loading
        }
        editingDepartment={editingDepartment}
      />
    </div>
  );
};

export default AdminDepartments;
