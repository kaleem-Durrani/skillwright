import React from "react";
import { Table, Tag, Button, Space, Tooltip, Modal } from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  TeamOutlined,
  BookOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Department } from "@/common/types";
import { ROUTES } from "@/common/constants";

const { confirm } = Modal;

interface DepartmentTableProps {
  departments: Department[];
  loading: boolean;
  onDelete: (id: string) => void;
  onEdit: (department: Department) => void;
}

/**
 * Table component for displaying departments
 */
const DepartmentTable: React.FC<DepartmentTableProps> = ({
  departments,
  loading,
  onDelete,
  onEdit,
}) => {
  const showDeleteConfirm = (id: string, name: string) => {
    confirm({
      title: `Are you sure you want to delete ${name}?`,
      icon: <ExclamationCircleOutlined />,
      content:
        "This action cannot be undone. All associated teachers, students, and courses will be unlinked from this department.",
      okText: "Yes, Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk() {
        onDelete(id);
      },
    });
  };

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: Department) => (
        <Link to={ROUTES.ADMIN.DEPARTMENT_DETAILS(record.id)}>{text}</Link>
      ),
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: "Teachers",
      key: "teachers",
      render: (_: any, record: Department) => (
        <Tag color="blue">
          <TeamOutlined className="mr-1" />
          {record._count?.teachers || 0}
        </Tag>
      ),
    },
    {
      title: "Students",
      key: "students",
      render: (_: any, record: Department) => (
        <Tag color="green">
          <TeamOutlined className="mr-1" />
          {record._count?.students || 0}
        </Tag>
      ),
    },
    {
      title: "Courses",
      key: "courses",
      render: (_: any, record: Department) => (
        <Tag color="purple">
          <BookOutlined className="mr-1" />
          {record._count?.courses || 0}
        </Tag>
      ),
    },
    // {
    //   title: 'Actions',
    //   key: 'actions',
    //   render: (_: any, record: Department) => (
    //     <Space size="small">
    //       <Tooltip title="View Details">
    //         <Link to={ROUTES.ADMIN.DEPARTMENT_DETAILS(record.id)}>
    //           <Button type="text" icon={<EyeOutlined />} />
    //         </Link>
    //       </Tooltip>
    //       <Tooltip title="Edit">
    //         <Button
    //           type="text"
    //           icon={<EditOutlined />}
    //           onClick={() => onEdit(record)}
    //         />
    //       </Tooltip>
    //       <Tooltip title="Delete">
    //         <Button
    //           type="text"
    //           danger
    //           icon={<DeleteOutlined />}
    //           onClick={() => showDeleteConfirm(record.id, record.name)}
    //           disabled={
    //             (record._count?.teachers || 0) > 0 ||
    //             (record._count?.students || 0) > 0 ||
    //             (record._count?.courses || 0) > 0
    //           }
    //         />
    //       </Tooltip>
    //     </Space>
    //   ),
    // },
  ];

  return (
    <Table
      columns={columns}
      dataSource={departments}
      rowKey="id"
      loading={loading}
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showTotal: (total) => `Total ${total} departments`,
      }}
      className="shadow-sm"
    />
  );
};

export default DepartmentTable;
