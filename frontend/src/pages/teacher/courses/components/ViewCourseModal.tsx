import React from "react";
import { Modal, Descriptions, Tag, Typography, Space } from "antd";
import {
  BookOutlined,
  TeamOutlined,
  FileOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Course } from "@/common/types";
import dayjs from "dayjs";

const { Title, Text } = Typography;

interface ViewCourseModalProps {
  visible: boolean;
  course: Course | null;
  loading: boolean;
  onCancel: () => void;
}

/**
 * Modal component to view course details
 */
const ViewCourseModal: React.FC<ViewCourseModalProps> = ({
  visible,
  course,
  loading,
  onCancel,
}) => {
  if (!course) return null;

  return (
    <Modal
      title={
        <Space>
          <BookOutlined />
          <span>Course Details</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
      loading={loading}
    >
      <div className="space-y-6">
        {/* Basic Information */}
        <div>
          <Title level={4} className="mb-4">
            Basic Information
          </Title>
          <Descriptions bordered column={2}>
            <Descriptions.Item label="Course Name" span={2}>
              <Text strong>{course.name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Course Code">
              <Tag color="blue">{course.code}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Duration">
              <Tag color="green">{course.duration}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Department" span={2}>
              <Tag color="purple">{course.department?.name}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Capacity">
              <Space>
                <TeamOutlined />
                <span>{course.capacity} students</span>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Current Enrollments">
              <Space>
                <UserOutlined />
                <span>{course._count?.enrollments || 0} students</span>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* Description */}
        {course.description && (
          <div>
            <Title level={4} className="mb-4">
              Description
            </Title>
            <div className="p-4 bg-gray-50 rounded-lg">
              <Text>{course.description}</Text>
            </div>
          </div>
        )}

        {/* Schedule Information */}
        <div>
          <Title level={4} className="mb-4">
            Schedule
          </Title>
          <Descriptions bordered column={2}>
            <Descriptions.Item label="Start Date">
              {course.startDate ? (
                <Space>
                  <CalendarOutlined />
                  <span>{dayjs(course.startDate).format("MMMM D, YYYY")}</span>
                </Space>
              ) : (
                <Text type="secondary">Not set</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="End Date">
              {course.endDate ? (
                <Space>
                  <CalendarOutlined />
                  <span>{dayjs(course.endDate).format("MMMM D, YYYY")}</span>
                </Space>
              ) : (
                <Text type="secondary">Not set</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* Statistics */}
        <div>
          <Title level={4} className="mb-4">
            Statistics
          </Title>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <Space>
                <TeamOutlined className="text-blue-500 text-xl" />
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {course._count?.enrollments || 0}
                  </div>
                  <div className="text-sm text-gray-600">Enrolled Students</div>
                </div>
              </Space>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <Space>
                <FileOutlined className="text-green-500 text-xl" />
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {course._count?.resources || 0}
                  </div>
                  <div className="text-sm text-gray-600">Resources</div>
                </div>
              </Space>
            </div>
          </div>
        </div>

        {/* Teacher Information */}
        {course.teacher && (
          <div>
            <Title level={4} className="mb-4">
              Teacher Information
            </Title>
            <Descriptions bordered>
              <Descriptions.Item label="Name">
                <Space>
                  <UserOutlined />
                  <span>{course.teacher.name}</span>
                </Space>
              </Descriptions.Item>
              {course.teacher.qualification && (
                <Descriptions.Item label="Qualification">
                  {course.teacher.qualification}
                </Descriptions.Item>
              )}
              {course.teacher.specialization && (
                <Descriptions.Item label="Specialization">
                  {course.teacher.specialization}
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        )}

        {/* Timestamps */}
        <div>
          <Title level={4} className="mb-4">
            Timestamps
          </Title>
          <Descriptions bordered column={2}>
            <Descriptions.Item label="Created At">
              <Space>
                <ClockCircleOutlined />
                <span>
                  {dayjs(course.createdAt).format("MMMM D, YYYY [at] h:mm A")}
                </span>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Updated At">
              <Space>
                <ClockCircleOutlined />
                <span>
                  {dayjs(course.updatedAt).format("MMMM D, YYYY [at] h:mm A")}
                </span>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>
      </div>
    </Modal>
  );
};

export default ViewCourseModal;
