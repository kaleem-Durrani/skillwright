import React from 'react';
import { List, Empty, Spin, Pagination } from 'antd';
import { ResourceWithDetails } from '@/common/types';
import ResourceCard from './ResourceCard';

interface ResourceListProps {
  resources: ResourceWithDetails[];
  isLoading: boolean;
  currentPage: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onView: (resourceId: string) => void;
  onViewComments: (resourceId: string) => void;
  emptyText?: string;
  emptyAction?: React.ReactNode;
}

/**
 * Resource list component for displaying a list of resources
 */
const ResourceList: React.FC<ResourceListProps> = ({
  resources,
  isLoading,
  currentPage,
  pageSize,
  total,
  onPageChange,
  onView,
  onViewComments,
  emptyText = 'No resources found',
  emptyAction,
}) => {
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spin size="large" />
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <Empty 
        description={emptyText} 
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        {emptyAction}
      </Empty>
    );
  }

  return (
    <>
      <List
        grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 3, xl: 3, xxl: 4 }}
        dataSource={resources}
        renderItem={(resource) => (
          <List.Item key={resource.id}>
            <ResourceCard
              resource={resource}
              onView={onView}
              onViewComments={onViewComments}
            />
          </List.Item>
        )}
      />
      
      {resources.length > 0 && total > pageSize && (
        <div className="mt-4 flex justify-end">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={total}
            onChange={onPageChange}
            showSizeChanger={false}
          />
        </div>
      )}
    </>
  );
};

export default ResourceList;
