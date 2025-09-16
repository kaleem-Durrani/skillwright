import React from "react";
import {
  Card,
  Avatar,
  Typography,
  Descriptions,
  Button,
  Form,
  Input,
  Tag,
} from "antd";
import {
  UserOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  PhoneOutlined,
  MailOutlined,
} from "@ant-design/icons";
import { StudentWithDetails } from "@/common/types";

const { Title, Text } = Typography;

interface ProfileInfoProps {
  student: StudentWithDetails;
  isEditing: boolean;
  isLoading: boolean;
  form: any; // Form instance
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * Profile information component for displaying and editing student profile
 */
const ProfileInfo: React.FC<ProfileInfoProps> = ({
  student,
  isEditing,
  isLoading,
  form,
  onEdit,
  onCancel,
  onSave,
}) => {
  return (
    <Card>
      <div className="flex flex-col md:flex-row gap-8">
        {/* Profile Avatar */}
        <div className="flex flex-col items-center">
          <Avatar
            size={120}
            icon={<UserOutlined />}
            className="bg-blue-500 mb-4"
          />
          <Title level={4}>{student?.name}</Title>
          <Text type="secondary">Student</Text>
        </div>

        {/* Profile Details */}
        <div className="flex-1">
          {isEditing ? (
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                name: student?.name,
                email: student?.email,
                phoneNumber: student?.phoneNumber || "",
              }}
            >
              <Form.Item
                name="name"
                label="Full Name"
                rules={[{ required: true, message: "Please enter your name" }]}
              >
                <Input prefix={<UserOutlined />} />
              </Form.Item>

              <Form.Item
                name="email"
                label="Email"
                rules={[
                  { required: true, message: "Please enter your email" },
                  { type: "email", message: "Please enter a valid email" },
                ]}
              >
                <Input prefix={<MailOutlined />} disabled />
              </Form.Item>

              <Form.Item
                name="phoneNumber"
                label="Phone Number"
                rules={[
                  {
                    pattern: /^\+?[1-9]\d{1,14}$/,
                    message: "Please enter a valid phone number",
                  },
                ]}
              >
                <Input
                  prefix={<PhoneOutlined />}
                  placeholder="Enter your phone number"
                />
              </Form.Item>

              <div className="flex justify-end gap-2 mt-4">
                <Button icon={<CloseOutlined />} onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={onSave}
                  loading={isLoading}
                >
                  Save Changes
                </Button>
              </div>
            </Form>
          ) : (
            <>
              <div className="flex justify-end mb-4">
                <Button type="primary" icon={<EditOutlined />} onClick={onEdit}>
                  Edit Profile
                </Button>
              </div>

              <Descriptions bordered column={1}>
                <Descriptions.Item label="Full Name">
                  {student?.name}
                </Descriptions.Item>
                <Descriptions.Item label="Email">
                  {student?.email}
                </Descriptions.Item>
                <Descriptions.Item label="Phone Number">
                  {student?.phoneNumber || "Not provided"}
                </Descriptions.Item>
                <Descriptions.Item label="Enrollment Number">
                  {student?.enrollmentNo}
                </Descriptions.Item>
                <Descriptions.Item label="Department">
                  {student?.department?.name || "Not assigned"}
                </Descriptions.Item>
                <Descriptions.Item label="Account Status">
                  {student?.isBanned ? (
                    <Tag color="red">Banned</Tag>
                  ) : (
                    <Tag color="green">Active</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Email Verification">
                  {student?.isVerified ? (
                    <Tag color="green">Verified</Tag>
                  ) : (
                    <Tag color="orange">Not Verified</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Joined On">
                  {student?.createdAt
                    ? new Date(student.createdAt).toLocaleDateString()
                    : "Unknown"}
                </Descriptions.Item>
              </Descriptions>
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

export default ProfileInfo;
