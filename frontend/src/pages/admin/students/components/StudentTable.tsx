import React from "react";
import { Table, Tag, Button, Space, Tooltip, Modal, Avatar } from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  LockOutlined,
  UnlockOutlined,
  ExclamationCircleOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Student } from "@/common/types";
import { ROUTES } from "@/common/constants";

const { confirm } = Modal;

interface StudentTableProps {
  students: Student[];
  loading: boolean;
  onDelete: (id: string) => void;
  onToggleBan: (id: string, isBanned: boolean) => void;
}

/**
 * Table component for displaying students
 */
const StudentTable: React.FC<StudentTableProps> = ({
  students,
  loading,
  onDelete,
  onToggleBan,
}) => {
  const showDeleteConfirm = (id: string, name: string) => {
    confirm({
      title: `Are you sure you want to delete ${name}?`,
      icon: <ExclamationCircleOutlined />,
      content: "This action cannot be undone.",
      okText: "Yes, Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk() {
        onDelete(id);
      },
    });
  };

  const showBanConfirm = (id: string, name: string, isBanned: boolean) => {
    confirm({
      title: `Are you sure you want to ${isBanned ? "unban" : "ban"} ${name}?`,
      icon: <ExclamationCircleOutlined />,
      content: isBanned
        ? "This will allow the student to access the system again."
        : "This will prevent the student from accessing the system.",
      okText: isBanned ? "Yes, Unban" : "Yes, Ban",
      okType: isBanned ? "primary" : "danger",
      cancelText: "Cancel",
      onOk() {
        onToggleBan(id, !isBanned);
      },
    });
  };

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: Student) => (
        <div className="flex items-center">
          <Avatar icon={<UserOutlined />} className="mr-2" />
          <Link to={ROUTES.ADMIN.STUDENT_DETAILS(record.id)}>{text}</Link>
        </div>
      ),
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
    },
    {
      title: "Enrollment No",
      dataIndex: "enrollmentNo",
      key: "enrollmentNo",
    },
    {
      title: "Department",
      dataIndex: "department",
      key: "department",
      render: (_: any, record: Student) =>
        record.department ? (
          <Tag color="blue">{record.department.name}</Tag>
        ) : (
          <span>-</span>
        ),
    },
    {
      title: "Status",
      key: "status",
      render: (_: any, record: Student) =>
        record.isBanned ? (
          <Tag color="red">Banned</Tag>
        ) : (
          <Tag color="green">Active</Tag>
        ),
    },
    // {
    //   title: 'Actions',
    //   key: 'actions',
    //   render: (_: any, record: Student) => (
    //     <Space size="small">
    //       <Tooltip title="View Details">
    //         <Link to={ROUTES.ADMIN.STUDENT_DETAILS(record.id)}>
    //           <Button type="text" icon={<EyeOutlined />} />
    //         </Link>
    //       </Tooltip>
    //       <Tooltip title="Edit">
    //         <Link to={ROUTES.ADMIN.STUDENT_DETAILS(record.id)}>
    //           <Button type="text" icon={<EditOutlined />} />
    //         </Link>
    //       </Tooltip>
    //       <Tooltip title={record.isBanned ? 'Unban' : 'Ban'}>
    //         <Button
    //           type="text"
    //           danger={!record.isBanned}
    //           icon={record.isBanned ? <UnlockOutlined /> : <LockOutlined />}
    //           onClick={() => showBanConfirm(record.id, record.name, record.isBanned)}
    //         />
    //       </Tooltip>
    //       <Tooltip title="Delete">
    //         <Button
    //           type="text"
    //           danger
    //           icon={<DeleteOutlined />}
    //           onClick={() => showDeleteConfirm(record.id, record.name)}
    //         />
    //       </Tooltip>
    //     </Space>
    //   ),
    // },
  ];

  return (
    <Table
      columns={columns}
      dataSource={students}
      rowKey="id"
      loading={loading}
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showTotal: (total) => `Total ${total} students`,
      }}
      className="shadow-sm"
    />
  );
};

export default StudentTable;
