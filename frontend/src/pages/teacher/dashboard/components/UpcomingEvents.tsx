import React from 'react';
import { Card, List, Typography, Tag, Skeleton, Empty, Badge } from 'antd';
import { CalendarOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface Event {
  id: string;
  title: string;
  date: string;
  type: 'course_start' | 'course_end' | 'deadline';
  courseId?: string;
  courseName?: string;
}

interface UpcomingEventsProps {
  events: Event[];
  loading: boolean;
}

/**
 * Component to display upcoming events on the dashboard
 */
const UpcomingEvents: React.FC<UpcomingEventsProps> = ({ events, loading }) => {
  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'course_start':
        return 'green';
      case 'course_end':
        return 'red';
      case 'deadline':
        return 'orange';
      default:
        return 'blue';
    }
  };

  const getEventTypeLabel = (type: string) => {
    switch (type) {
      case 'course_start':
        return 'Course Start';
      case 'course_end':
        return 'Course End';
      case 'deadline':
        return 'Deadline';
      default:
        return 'Event';
    }
  };

  return (
    <Card title={<Title level={5}>Upcoming Events</Title>} className="shadow-sm h-full">
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        {events.length > 0 ? (
          <List
            dataSource={events}
            renderItem={(event) => (
              <List.Item>
                <Badge.Ribbon text={getEventTypeLabel(event.type)} color={getEventTypeColor(event.type)}>
                  <Card className="w-full" size="small">
                    <div className="flex flex-col gap-1">
                      <Text strong>{event.title}</Text>
                      {event.courseName && (
                        <Text type="secondary">Course: {event.courseName}</Text>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <CalendarOutlined className="text-gray-500" />
                        <Text type="secondary">
                          {dayjs(event.date).format('MMM D, YYYY')}
                        </Text>
                        <ClockCircleOutlined className="text-gray-500 ml-2" />
                        <Text type="secondary">
                          {dayjs(event.date).format('h:mm A')}
                        </Text>
                      </div>
                    </div>
                  </Card>
                </Badge.Ribbon>
              </List.Item>
            )}
          />
        ) : (
          <Empty description="No upcoming events" />
        )}
      </Skeleton>
    </Card>
  );
};

export default UpcomingEvents;
