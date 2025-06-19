import React from "react";
import { Row, Col, Empty, Spin } from "antd";
import { Resource } from "@/common/types";
import ResourceCard from "./ResourceCard";

interface ResourceListProps {
  resources: Resource[];
  loading: boolean;
  onView: (resource: Resource) => void;
  onEdit: (resource: Resource) => void;
  onDelete: (id: string) => void;
}

/**
 * Component to display a grid of resource cards
 */
const ResourceList: React.FC<ResourceListProps> = ({
  resources,
  loading,
  onView,
  onEdit,
  onDelete,
}) => {
  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spin size="large" />
      </div>
    );
  }

  if (!resources || resources.length === 0) {
    return <Empty description="No resources found" className="py-12" />;
  }

  return (
    <Row gutter={[16, 16]}>
      {resources.map((resource) => (
        <Col xs={24} sm={12} lg={8} xl={6} key={resource.id}>
          <ResourceCard
            resource={resource}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </Col>
      ))}
    </Row>
  );
};

export default ResourceList;
