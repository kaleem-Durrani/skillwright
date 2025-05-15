import React from 'react';
import { Input, Select, Form, Button, Card, DatePicker, Switch } from 'antd';
import { SearchOutlined, FilterOutlined, ClearOutlined } from '@ant-design/icons';

const { Option } = Select;
const { RangePicker } = DatePicker;

interface NewsEventFilterProps {
  onSearch: (values: any) => void;
  onReset: () => void;
}

/**
 * Component for filtering and searching news and events
 */
const NewsEventFilter: React.FC<NewsEventFilterProps> = ({ onSearch, onReset }) => {
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
            placeholder="Search by title or content"
            prefix={<SearchOutlined className="text-gray-400" />}
            allowClear
          />
        </Form.Item>

        <Form.Item 
          name="type" 
          className="mb-0 min-w-[150px]"
        >
          <Select
            placeholder="Filter by type"
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="NEWS">News</Option>
            <Option value="EVENT">Event</Option>
            <Option value="ANNOUNCEMENT">Announcement</Option>
          </Select>
        </Form.Item>

        <Form.Item 
          name="dateRange" 
          className="mb-0 min-w-[250px]"
        >
          <RangePicker 
            placeholder={['Start Date', 'End Date']}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item 
          name="isPublished" 
          className="mb-0"
          valuePropName="checked"
        >
          <Switch 
            checkedChildren="Published" 
            unCheckedChildren="All" 
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

export default NewsEventFilter;
