import React, { useState, useEffect } from "react";
import { Typography, Row, Col, App } from "antd";
import { useAdminQuery } from "@/hooks";
import { ProfileInfo, ProfileForm } from "./components";
import { Admin } from "@/common/types";

const { Title } = Typography;

const AdminProfile: React.FC = () => {
  const { notification } = App.useApp();
  const { getProfileQuery, updateProfileMutation } = useAdminQuery();
  const [isEditing, setIsEditing] = useState(false);
  const [admin, setAdmin] = useState<Admin | null>(null);

  useEffect(() => {
    if (getProfileQuery.data?.data?.data) {
      setAdmin(getProfileQuery.data.data.data);
    }
  }, [getProfileQuery.data]);

  useEffect(() => {
    if (getProfileQuery.isError) {
      notification.error({
        message: "Error",
        description: "Failed to load profile. Please try again later.",
      });
    }
  }, [getProfileQuery.isError, notification]);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleSubmit = async (values: any) => {
    try {
      await updateProfileMutation.mutateAsync(values);
      notification.success({
        message: "Success",
        description: "Profile updated successfully.",
      });
      setIsEditing(false);
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to update profile. Please try again.",
      });
    }
  };

  return (
    <div className="p-6">
      <Title level={2} className="mb-6">
        My Profile
      </Title>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          {isEditing ? (
            <ProfileForm
              admin={admin as Admin}
              loading={getProfileQuery.isLoading}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSubmitting={updateProfileMutation.isPending}
            />
          ) : (
            <ProfileInfo
              admin={admin as Admin}
              loading={getProfileQuery.isLoading}
              onEdit={handleEdit}
            />
          )}
        </Col>
      </Row>
    </div>
  );
};

export default AdminProfile;
