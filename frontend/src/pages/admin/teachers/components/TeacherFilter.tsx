import React from "react";
import { Input, Select, Form, Button, Card, Switch } from "antd";
import {
  SearchOutlined,
  FilterOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { useDepartmentContext } from "@/context/DepartmentContext";

const { Option } = Select;

interface TeacherFilterProps {
  onSearch: (values: any) => void;
  onReset: () => void;
}

/**
 * Component for filtering and searching teachers
 */
const TeacherFilter: React.FC<TeacherFilterProps> = ({ onSearch, onReset }) => {
  const [form] = Form.useForm();
  const { departments, loading: departmentsLoading } = useDepartmentContext();

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
            placeholder="Search by name or email"
            prefix={<SearchOutlined className="text-gray-400" />}
            allowClear
          />
        </Form.Item>

        <Form.Item name="departmentId" className="mb-0 min-w-[200px]">
          <Select
            placeholder="Filter by department"
            allowClear
            loading={departmentsLoading}
            style={{ width: "100%" }}
          >
            {departments.map((dept) => (
              <Option key={dept.id} value={dept.id}>
                {dept.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="isBanned" className="mb-0" valuePropName="checked">
          <Switch checkedChildren="Banned" unCheckedChildren="All" />
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

export default TeacherFilter;
