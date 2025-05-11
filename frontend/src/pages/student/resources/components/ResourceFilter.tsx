import React from 'react';
import { Card, Input, Select, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { CourseWithEnrollment, ResourceType } from '@/common/types';

const { Option } = Select;

interface ResourceFilterProps {
  searchText: string;
  onSearchChange: (value: string) => void;
  resourceType: string;
  onResourceTypeChange: (value: string) => void;
  selectedCourseId: string;
  onCourseChange: (value: string) => void;
  courses: CourseWithEnrollment[];
  isLoadingCourses: boolean;
}

/**
 * Resource filter component for filtering resources
 */
const ResourceFilter: React.FC<ResourceFilterProps> = ({
  searchText,
  onSearchChange,
  resourceType,
  onResourceTypeChange,
  selectedCourseId,
  onCourseChange,
  courses,
  isLoadingCourses,
}) => {
  return (
    <Card className="mb-6">
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search resources..."
            prefix={<SearchOutlined />}
            allowClear
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        
        <div className="w-full md:w-64">
          <Select
            placeholder="Select Course"
            style={{ width: '100%' }}
            onChange={onCourseChange}
            loading={isLoadingCourses}
            value={selectedCourseId || undefined}
            allowClear
          >
            {courses.map((course) => (
              <Option key={course.id} value={course.id}>
                {course.name}
              </Option>
            ))}
          </Select>
        </div>
        
        <div className="w-full md:w-48">
          <Select
            placeholder="Resource Type"
            style={{ width: '100%' }}
            onChange={onResourceTypeChange}
            value={resourceType || undefined}
            allowClear
          >
            <Option value="DOCUMENT">Documents</Option>
            <Option value="VIDEO">Videos</Option>
            <Option value="LINK">Links</Option>
          </Select>
        </div>
      </div>
    </Card>
  );
};

export default ResourceFilter;
