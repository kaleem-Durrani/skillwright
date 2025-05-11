import React from 'react';
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

interface CourseSearchProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Course search component for filtering courses
 */
const CourseSearch: React.FC<CourseSearchProps> = ({
  value,
  onChange,
  className = '',
}) => {
  return (
    <Input
      placeholder="Search courses..."
      prefix={<SearchOutlined />}
      allowClear
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`max-w-md ${className}`}
    />
  );
};

export default CourseSearch;
