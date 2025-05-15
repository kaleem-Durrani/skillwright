import React from 'react';
import { Card, List, Typography, Tag, Skeleton, Button, Badge } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined, CalendarOutlined } from '@ant-design/icons';
import { NewsEvent } from '@/common/types';
import { ROUTES } from '@/common/constants';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface RecentNewsEventsProps {
  newsEvents: NewsEvent[];
  loading: boolean;
}

/**
 * Component to display recent news and events on the dashboard
 */
const RecentNewsEvents: React.FC<RecentNewsEventsProps> = ({ newsEvents, loading }) => {
  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'NEWS':
        return 'blue';
      case 'EVENT':
        return 'green';
      case 'ANNOUNCEMENT':
        return 'orange';
      default:
        return 'blue';
    }
  };

  return (
    <Card 
      title={<Title level={5}>Recent News & Events</Title>}
      extra={
        <Link to={ROUTES.ADMIN.NEWS_EVENTS}>
          <Button type="link" size="small">
            View All <RightOutlined />
          </Button>
        </Link>
      }
      className="shadow-sm h-full"
    >
      <Skeleton loading={loading} active paragraph={{ rows: 5 }}>
        <List
          dataSource={newsEvents.slice(0, 5)}
          renderItem={(item) => (
            <List.Item>
              <Badge.Ribbon 
                text={item.isPublished ? 'Published' : 'Draft'} 
                color={item.isPublished ? 'green' : 'gray'}
              >
                <Card className="w-full" size="small">
                  <List.Item.Meta
                    title={
                      <Link to={ROUTES.ADMIN.NEWS_EVENT_DETAILS(item.id)}>
                        {item.title}
                      </Link>
                    }
                    description={
                      <>
                        <Text type="secondary" ellipsis={{ rows: 2 }}>
                          {item.content}
                        </Text>
                        <div className="mt-1 flex items-center justify-between">
                          <Tag color={getEventTypeColor(item.type)}>
                            {item.type}
                          </Tag>
                          <div className="flex items-center">
                            <CalendarOutlined className="mr-1 text-gray-500" />
                            <Text type="secondary">
                              {dayjs(item.date).format('MMM D, YYYY')}
                            </Text>
                          </div>
                        </div>
                      </>
                    }
                  />
                </Card>
              </Badge.Ribbon>
            </List.Item>
          )}
          locale={{ emptyText: 'No news or events found' }}
        />
      </Skeleton>
    </Card>
  );
};

export default RecentNewsEvents;
