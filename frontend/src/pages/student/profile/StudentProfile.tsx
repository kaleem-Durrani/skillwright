import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Typography, Tabs, Form, Spin, Divider, message } from "antd";
import { useApi, useMutation } from "@/hooks";
import { studentService } from "@/services";
import { ROUTES } from "@/common/constants";
import { CourseWithEnrollment, StudentWithDetails } from "@/common/types";
import { ProfileInfo, EnrolledCoursesList } from "./components";

const { Title, Text } = Typography;
const { TabPane } = Tabs;

const StudentProfile = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  // API calls for student profile and courses
  const profileQuery = useApi(() => studentService.getProfile(), {
    immediate: true,
  });

  const enrolledCoursesQuery = useApi(
    () => studentService.getEnrolledCourses(),
    { immediate: true }
  );

  // Mutation for updating profile
  const updateProfileMutation = useMutation(studentService.updateProfile, {
    onSuccess: () => {
      message.success("Profile updated successfully");
      setIsEditing(false);
      profileQuery.refetch();
    },
  });

  // Cast student data to StudentWithDetails
  const student = profileQuery.data?.data as StudentWithDetails;

  // Extract courses from the API response
  const enrolledCoursesResponse = enrolledCoursesQuery.data?.data;
  const enrolledCourses = enrolledCoursesResponse?.items || [];

  // Filter enrolled courses by status
  const approvedCourses = enrolledCourses.filter(
    (course: CourseWithEnrollment) =>
      course.enrollments && course.enrollments[0]?.status === "APPROVED"
  );

  const pendingCourses = enrolledCourses.filter(
    (course: CourseWithEnrollment) =>
      course.enrollments && course.enrollments[0]?.status === "PENDING"
  );

  // Set form values when profile data is loaded
  useEffect(() => {
    if (student) {
      form.setFieldsValue({
        name: student.name,
        email: student.email,
        phoneNumber: student.phoneNumber || "",
      });
    }
  }, [student, form]);

  // Handle edit profile
  const handleEditProfile = () => {
    setIsEditing(true);
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    form.setFieldsValue({
      name: student?.name,
      email: student?.email,
      phoneNumber: student?.phoneNumber || "",
    });
    setIsEditing(false);
  };

  // Handle save profile
  const handleSaveProfile = async () => {
    try {
      const values = await form.validateFields();
      await updateProfileMutation.mutateAsync(values);
    } catch (error: any) {
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else if (error.message) {
        console.error("Validation failed:", error);
      } else {
        message.error("Failed to update profile");
      }
    }
  };

  // Handle view course
  const handleViewCourse = (courseId: string) => {
    navigate(ROUTES.STUDENT.COURSE_DETAILS(courseId));
  };

  if (profileQuery.loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <Title level={2}>My Profile</Title>
        <Text className="text-gray-600">
          View and manage your personal information
        </Text>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="Profile Information" key="profile">
          <ProfileInfo
            student={student}
            isEditing={isEditing}
            isLoading={updateProfileMutation.loading}
            form={form}
            onEdit={handleEditProfile}
            onCancel={handleCancelEdit}
            onSave={handleSaveProfile}
          />
        </TabPane>

        <TabPane tab="Enrolled Courses" key="courses">
          <div>
            <Title level={4} className="mb-4">
              Approved Courses
            </Title>
            <EnrolledCoursesList
              courses={approvedCourses}
              isLoading={enrolledCoursesQuery.loading}
              onViewCourse={handleViewCourse}
              emptyText="You are not enrolled in any approved courses"
            />

            {pendingCourses.length > 0 && (
              <>
                <Divider />
                <Title level={4} className="mb-4">
                  Pending Enrollments
                </Title>
                <EnrolledCoursesList
                  courses={pendingCourses}
                  isLoading={enrolledCoursesQuery.loading}
                  onViewCourse={handleViewCourse}
                  emptyText="You don't have any pending enrollment requests"
                />
              </>
            )}
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
};

export default StudentProfile;
