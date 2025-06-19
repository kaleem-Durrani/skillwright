import React, { useEffect } from "react";
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  DatePicker,
  Space,
} from "antd";
import { EditOutlined } from "@ant-design/icons";
import { Course, CourseUpdateData } from "@/common/types";
import dayjs from "dayjs";
import { useDepartmentContext } from "@/context/DepartmentContext";

const { TextArea } = Input;
const { RangePicker } = DatePicker;

interface EditCourseModalProps {
  visible: boolean;
  course: Course | null;
  onCancel: () => void;
  onSubmit: (values: CourseUpdateData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for editing a course
 */
const EditCourseModal: React.FC<EditCourseModalProps> = ({
  visible,
  course,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();

  const { loading: departmentsLoading, departmentOptions } =
    useDepartmentContext();

  // Reset form when modal is opened/closed or course changes
  useEffect(() => {
    if (visible && course) {
      const dateRange =
        course.startDate && course.endDate
          ? [dayjs(course.startDate), dayjs(course.endDate)]
          : undefined;

      form.setFieldsValue({
        name: course.name,
        code: course.code,
        description: course.description,
        duration: course.duration,
        capacity: course.capacity,
        departmentId: course.departmentId || course.department?.id,
        dateRange,
      });
    } else {
      form.resetFields();
    }
  }, [visible, course, form]);

  const handleSubmit = (values: any) => {
    const { dateRange, ...rest } = values;

    const formattedValues: CourseUpdateData = {
      ...rest,
      startDate: dateRange?.[0]?.toISOString(),
      endDate: dateRange?.[1]?.toISOString(),
    };

    onSubmit(formattedValues);
  };

  return (
    <Modal
      title={
        <Space>
          <EditOutlined />
          <span>Edit Course</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={isSubmitting}
      width={600}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        preserve={true}
      >
        <Form.Item
          name="name"
          label="Course Name"
          rules={[
            { required: true, message: "Please enter course name" },
            { min: 3, message: "Course name must be at least 3 characters" },
            { max: 100, message: "Course name must not exceed 100 characters" },
          ]}
        >
          <Input placeholder="Enter course name" />
        </Form.Item>

        <Form.Item
          name="code"
          label="Course Code"
          rules={[
            { required: true, message: "Please enter course code" },
            { min: 2, message: "Course code must be at least 2 characters" },
            { max: 20, message: "Course code must not exceed 20 characters" },
            {
              pattern: /^[A-Z0-9-_]+$/,
              message:
                "Course code must contain only uppercase letters, numbers, hyphens, and underscores",
            },
          ]}
        >
          <Input placeholder="e.g., CS101, MATH-201" />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
          rules={[
            {
              max: 1000,
              message: "Description must not exceed 1000 characters",
            },
          ]}
        >
          <TextArea
            rows={4}
            placeholder="Enter course description"
            showCount
            maxLength={1000}
          />
        </Form.Item>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="duration"
            label="Duration"
            rules={[
              { required: true, message: "Please enter course duration" },
              { max: 50, message: "Duration must not exceed 50 characters" },
            ]}
          >
            <Input placeholder="e.g., 3 months, 16 weeks" />
          </Form.Item>

          <Form.Item
            name="capacity"
            label="Capacity"
            rules={[
              { required: true, message: "Please enter course capacity" },
              {
                type: "number",
                min: 1,
                message: "Capacity must be at least 1",
              },
              {
                type: "number",
                max: 1000,
                message: "Capacity must not exceed 1000",
              },
            ]}
          >
            <InputNumber
              placeholder="Enter capacity"
              className="w-full"
              min={1}
              max={1000}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="departmentId"
          label="Department"
          rules={[{ required: true, message: "Please select a department" }]}
        >
          <Select
            placeholder="Select department"
            loading={departmentsLoading}
            options={departmentOptions}
          />
        </Form.Item>

        {/* Commented out syllabus field as requested */}
        {/* <Form.Item
          name="syllabus"
          label="Syllabus URL"
          rules={[
            { type: 'url', message: 'Please enter a valid URL' },
          ]}
        >
          <Input placeholder="Enter syllabus URL (optional)" />
        </Form.Item> */}

        <Form.Item name="dateRange" label="Course Duration">
          <RangePicker
            className="w-full"
            placeholder={["Start Date", "End Date"]}
            format="YYYY-MM-DD"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EditCourseModal;
