import React, { useState, useEffect } from "react";
import { Typography, Row, Col, App } from "antd";
import { useApi, useMutation } from "@/hooks";
import { teacherService } from "@/services";
import { ProfileInfo, ProfileStats, ProfileForm } from "./components";
import { Teacher } from "@/common/types";

const { Title } = Typography;

const TeacherProfile: React.FC = () => {
  const { notification } = App.useApp();
  const [isEditing, setIsEditing] = useState(false);

  // API calls
  const profileQuery = useApi(() => teacherService.getProfile(), {
    immediate: true,
  });

  const updateProfileMutation = useMutation(teacherService.updateProfile, {
    onSuccess: () => {
      notification.success({
        message: "Success",
        description: "Profile updated successfully.",
      });
      setIsEditing(false);
      profileQuery.refetch();
    },
    onError: () => {
      notification.error({
        message: "Error",
        description: "Failed to update profile. Please try again.",
      });
    },
  });

  // Extract data
  const teacher = profileQuery.data?.data;

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleSubmit = async (values: any) => {
    try {
      await updateProfileMutation.mutateAsync(values);
    } catch (error) {
      // Error handling is done in the mutation onError callback
      console.error("Update profile error:", error);
    }
  };

  return (
    <div className="p-6">
      <Title level={2} className="mb-6">
        My Profile
      </Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={isEditing ? 24 : 18}>
          {isEditing ? (
            <ProfileForm
              teacher={teacher as Teacher}
              loading={profileQuery.loading}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSubmitting={updateProfileMutation.loading}
            />
          ) : (
            <ProfileInfo
              teacher={teacher as Teacher}
              loading={profileQuery.loading}
              onEdit={handleEdit}
            />
          )}
        </Col>

        {!isEditing && (
          <Col xs={24} lg={6}>
            <ProfileStats
              teacher={teacher as Teacher}
              loading={profileQuery.loading}
            />
          </Col>
        )}
      </Row>
    </div>
  );
};

export default TeacherProfile;
