import React from 'react';
import { Input, Form, Button, Card } from 'antd';
import { SearchOutlined, FilterOutlined, ClearOutlined } from '@ant-design/icons';

interface DepartmentFilterProps {
  onSearch: (values: any) => void;
  onReset: () => void;
}

/**
 * Component for filtering and searching departments
 */
const DepartmentFilter: React.FC<DepartmentFilterProps> = ({ onSearch, onReset }) => {
  const [form] = Form.useForm();

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
            placeholder="Search by department name"
            prefix={<SearchOutlined className="text-gray-400" />}
            allowClear
          />
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

export default DepartmentFilter;
