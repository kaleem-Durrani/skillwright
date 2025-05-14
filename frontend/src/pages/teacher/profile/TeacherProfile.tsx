import React, { useState, useEffect } from "react";
import { Typography, Row, Col, App } from "antd";
import { useTeacherQuery } from "@/hooks";
import { ProfileInfo, ProfileStats, ProfileForm } from "./components";
import { Teacher } from "@/common/types";

const { Title } = Typography;

const TeacherProfile: React.FC = () => {
  const { notification } = App.useApp();
  const { getProfileQuery, updateProfileMutation } = useTeacherQuery();
  const [isEditing, setIsEditing] = useState(false);
  const [teacher, setTeacher] = useState<Teacher | null>(null);

  useEffect(() => {
    if (getProfileQuery.data?.data?.data) {
      setTeacher(getProfileQuery.data.data.data);
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
        <Col xs={24} lg={isEditing ? 24 : 18}>
          {isEditing ? (
            <ProfileForm
              teacher={teacher as Teacher}
              loading={getProfileQuery.isLoading}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSubmitting={updateProfileMutation.isPending}
            />
          ) : (
            <ProfileInfo
              teacher={teacher as Teacher}
              loading={getProfileQuery.isLoading}
              onEdit={handleEdit}
            />
          )}
        </Col>

        {!isEditing && (
          <Col xs={24} lg={6}>
            <ProfileStats
              teacher={teacher as Teacher}
              loading={getProfileQuery.isLoading}
            />
          </Col>
        )}
      </Row>
    </div>
  );
};

export default TeacherProfile;
