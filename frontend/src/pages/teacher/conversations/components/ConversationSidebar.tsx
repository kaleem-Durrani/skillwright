import React from 'react';
import { List, Input, Button, Typography, Spin, Empty } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Conversation } from '@/common/types';
import ConversationItem from './ConversationItem';

const { Title } = Typography;
const { Search } = Input;

interface ConversationSidebarProps {
  conversations: Conversation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onSearch: (value: string) => void;
}

/**
 * Sidebar component for displaying conversation list
 */
const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  loading,
  selectedId,
  onSelect,
  onNewConversation,
  onSearch,
}) => {
  return (
    <div className="h-full flex flex-col border-r border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <Title level={4} className="m-0">Messages</Title>
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={onNewConversation}
            size="small"
          >
            New
          </Button>
        </div>
        <Search
          placeholder="Search conversations"
          onSearch={onSearch}
          allowClear
          prefix={<SearchOutlined className="text-gray-400" />}
        />
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center items-center h-full">
            <Spin />
          </div>
        ) : conversations.length === 0 ? (
          <Empty 
            description="No conversations found" 
            className="mt-8"
          />
        ) : (
          <List
            dataSource={conversations}
            renderItem={(conversation) => (
              <ConversationItem
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => onSelect(conversation.id)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
};

export default ConversationSidebar;
