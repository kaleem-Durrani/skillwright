import { Table as AntTable, Empty, Spin } from "antd";
import type { ColumnType, ColumnGroupType } from "antd/es/table";
import { TableProps, TableColumn } from "@/common/types";
import "./Table.scss";

/**
 * Reusable Table component that wraps Ant Design's Table with custom styling and features
 */
function Table<T extends object>({
  columns,
  dataSource,
  loading = false,
  pagination,
  rowKey = "id",
  onChange,
  scroll,
  bordered = false,
  size = "middle",
  title,
  footer,
  rowSelection,
  expandable,
}: TableProps<T>) {
  // Convert our TableColumn type to Ant Design's ColumnType
  const antColumns: (ColumnGroupType<T> | ColumnType<T>)[] = columns.map(
    (col: TableColumn<T>) => {
      return col as ColumnType<T>;
    }
  );
  // Custom empty state component
  const customEmpty = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="No data available"
    />
  );

  // Custom loading component
  const customLoading = {
    indicator: <Spin size="large" />,
    spinning: loading,
    delay: 300,
  };

  return (
    <div className="custom-table-wrapper">
      <AntTable
        columns={antColumns}
        dataSource={dataSource}
        loading={customLoading}
        pagination={pagination}
        rowKey={rowKey}
        onChange={onChange}
        scroll={scroll || { x: "max-content" }}
        bordered={bordered}
        size={size}
        title={title}
        footer={footer}
        rowSelection={rowSelection}
        expandable={expandable}
        locale={{ emptyText: customEmpty }}
        className="custom-table"
      />
    </div>
  );
}

export default Table;
