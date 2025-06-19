import React from "react";
import { Input, Select, Form, Button, Card, Switch } from "antd";
import {
  SearchOutlined,
  FilterOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { useApi } from "@/hooks";
import { teacherService } from "@/services";

const { Option } = Select;

interface ResourceFilterProps {
  onSearch: (values: any) => void;
  onReset: () => void;
}

/**
 * Component for filtering and searching resources
 */
const ResourceFilter: React.FC<ResourceFilterProps> = ({
  onSearch,
  onReset,
}) => {
  const [form] = Form.useForm();

  // API call for courses
  const coursesQuery = useApi(
    () => teacherService.getMyCourses({ limit: 100 }),
    { immediate: true }
  );

  const responseData = coursesQuery.data?.data as any;
  const courses = responseData?.items || [];

  const handleReset = () => {
    form.resetFields();
    onReset();
  };

  return (
    <Card className="mb-6 shadow-sm">
      <Form
        form={form}
        layout="vertical"
        onFinish={onSearch}
        className="flex flex-wrap gap-4"
      >
        <Form.Item name="search" className="mb-0 flex-1 min-w-[200px]">
          <Input
            placeholder="Search by title"
            prefix={<SearchOutlined className="text-gray-400" />}
            allowClear
          />
        </Form.Item>

        <Form.Item name="courseId" className="mb-0 min-w-[200px]">
          <Select
            placeholder="Filter by course"
            allowClear
            loading={coursesQuery.loading}
            style={{ width: "100%" }}
          >
            {courses.map((course: any) => (
              <Option key={course.id} value={course.id}>
                {course.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="type" className="mb-0 min-w-[150px]">
          <Select
            placeholder="Resource type"
            allowClear
            style={{ width: "100%" }}
          >
            <Option value="DOCUMENT">Document</Option>
            <Option value="VIDEO">Video</Option>
            <Option value="LINK">Link</Option>
          </Select>
        </Form.Item>

        <Form.Item name="isPublic" className="mb-0" valuePropName="checked">
          <Switch checkedChildren="Public" unCheckedChildren="All" />
        </Form.Item>

        <div className="flex gap-2">
          <Button type="primary" htmlType="submit" icon={<FilterOutlined />}>
            Filter
          </Button>
          <Button onClick={handleReset} icon={<ClearOutlined />}>
            Reset
          </Button>
        </div>
      </Form>
    </Card>
  );
};

export default ResourceFilter;
