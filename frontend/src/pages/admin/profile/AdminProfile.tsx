import React, { useState } from "react";
import { Typography, Row, Col, App } from "antd";
import { useApi, useMutation } from "@/hooks";
import { useAuth } from "@/context/AuthContext";
import { ProfileInfo, ProfileForm } from "./components";
import { Admin } from "@/common/types";
import { adminService } from "@/services";

const { Title } = Typography;

const AdminProfile: React.FC = () => {
  const { notification } = App.useApp();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  // API calls
  const profileQuery = useApi(() => adminService.getProfile(), {
    immediate: true,
  });

  const updateProfileMutation = useMutation(
    (data: Partial<Admin>) => adminService.updateProfile(data),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Profile updated successfully.",
        });
        setIsEditing(false);
        profileQuery.refetch();
      },
    }
  );

  // Use profile data from API or fallback to auth context
  const admin = profileQuery.data?.data || (user as Admin);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleSubmit = async (values: Partial<Admin>) => {
    await updateProfileMutation.mutateAsync(values);
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
              loading={profileQuery.loading}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSubmitting={updateProfileMutation.loading}
            />
          ) : (
            <ProfileInfo
              admin={admin as Admin}
              loading={profileQuery.loading}
              onEdit={handleEdit}
            />
          )}
        </Col>
      </Row>
    </div>
  );
};

export default AdminProfile;
