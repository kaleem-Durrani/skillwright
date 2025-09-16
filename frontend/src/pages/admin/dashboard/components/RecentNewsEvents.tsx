import React from "react";
import { Card, List, Typography, Tag, Skeleton, Button, Badge } from "antd";
import { Link } from "react-router-dom";
import { RightOutlined, CalendarOutlined } from "@ant-design/icons";
import { NewsEvent } from "@/common/types";
import { ROUTES } from "@/common/constants";
import dayjs from "dayjs";

const { Title, Text } = Typography;

interface RecentNewsEventsProps {
  newsEvents: NewsEvent[];
  loading: boolean;
}

/**
 * Component to display recent news and events on the dashboard
 */
const RecentNewsEvents: React.FC<RecentNewsEventsProps> = ({
  newsEvents,
  loading,
}) => {
  const getEventTypeColor = (type: string) => {
    switch (type) {
      case "NEWS":
        return "blue";
      case "EVENT":
        return "green";
      case "ANNOUNCEMENT":
        return "orange";
      default:
        return "blue";
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
            <List.Item className="px-0">
              <div className="w-full">
                <List.Item.Meta
                  title={
                    <div className="flex items-center justify-between">
                      <Link
                        to={ROUTES.ADMIN.NEWS_EVENT_DETAILS(item.id)}
                        className="flex-1 truncate"
                      >
                        {item.title}
                      </Link>
                      <Tag
                        color={item.isPublished ? "green" : "gray"}
                        className="ml-2"
                      >
                        {item.isPublished ? "Published" : "Draft"}
                      </Tag>
                    </div>
                  }
                  description={
                    <div className="space-y-2">
                      <Text
                        type="secondary"
                        className="block"
                        ellipsis={{ rows: 2 }}
                      >
                        {item.content}
                      </Text>
                      <div className="flex items-center justify-between">
                        <Tag color={getEventTypeColor(item.type)} size="small">
                          {item.type}
                        </Tag>
                        <div className="flex items-center">
                          <CalendarOutlined className="mr-1 text-gray-500" />
                          <Text type="secondary" className="text-xs">
                            {dayjs(item.date).format("MMM D, YYYY")}
                          </Text>
                        </div>
                      </div>
                    </div>
                  }
                />
              </div>
            </List.Item>
          )}
          locale={{ emptyText: "No news or events found" }}
        />
      </Skeleton>
    </Card>
  );
};

export default RecentNewsEvents;
