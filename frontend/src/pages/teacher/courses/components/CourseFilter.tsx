import React from 'react';
import { Input, Select, Form, Button, Card } from 'antd';
import { SearchOutlined, FilterOutlined, ClearOutlined } from '@ant-design/icons';
import { useDepartmentQuery } from '@/hooks';

const { Option } = Select;

interface CourseFilterProps {
  onSearch: (values: any) => void;
  onReset: () => void;
}

/**
 * Component for filtering and searching courses
 */
const CourseFilter: React.FC<CourseFilterProps> = ({ onSearch, onReset }) => {
  const [form] = Form.useForm();
  const { getAllDepartmentsQuery } = useDepartmentQuery();
  const departmentsQuery = getAllDepartmentsQuery();
  const departments = departmentsQuery.data?.data?.data || [];

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
        <Form.Item 
          name="search" 
          className="mb-0 flex-1 min-w-[200px]"
        >
          <Input
            placeholder="Search by name or code"
            prefix={<SearchOutlined className="text-gray-400" />}
            allowClear
          />
        </Form.Item>

        <Form.Item 
          name="departmentId" 
          className="mb-0 min-w-[200px]"
        >
          <Select
            placeholder="Filter by department"
            allowClear
            loading={departmentsQuery.isLoading}
            style={{ width: '100%' }}
          >
            {departments.map((dept) => (
              <Option key={dept.id} value={dept.id}>
                {dept.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <div className="flex gap-2">
          <Button 
            type="primary" 
            htmlType="submit" 
            icon={<FilterOutlined />}
          >
            Filter
          </Button>
          <Button 
            onClick={handleReset} 
            icon={<ClearOutlined />}
          >
            Reset
          </Button>
        </div>
      </Form>
    </Card>
  );
};

export default CourseFilter;
