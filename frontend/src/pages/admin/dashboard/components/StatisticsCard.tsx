import React from 'react';
import { Card, Statistic } from 'antd';
import { StatisticProps } from 'antd/es/statistic/Statistic';

interface StatisticsCardProps {
  title: string;
  value: number;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  precision?: number;
  loading?: boolean;
  className?: string;
  valueStyle?: React.CSSProperties;
}

/**
 * A card component that displays a statistic
 */
const StatisticsCard: React.FC<StatisticsCardProps> = ({
  title,
  value,
  prefix,
  suffix,
  precision = 0,
  loading = false,
  className = '',
  valueStyle,
}) => {
  return (
    <Card className={`shadow-sm hover:shadow-md transition-shadow ${className}`}>
      <Statistic
        title={title}
        value={value}
        precision={precision}
        valueStyle={valueStyle}
        prefix={prefix}
        suffix={suffix}
        loading={loading}
      />
    </Card>
  );
};

export default StatisticsCard;
