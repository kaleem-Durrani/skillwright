import { useState, useEffect } from 'react';
import { Typography, Button, Layout, Input, Empty, message } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMessagesQuery, useAuthStore } from '@/hooks';
import { 
  ConversationList, 
  MessageList, 
  MessageInput, 
  NewConversationModal 
} from './components';

const { Title, Text } = Typography;
const { Sider, Content } = Layout;

const StudentMessages = () => {
  const { user } = useAuthStore();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Get conversations and messages
  const { 
    getConversationsQuery, 
    getMessagesQuery, 
    sendMessageMutation,
    createConversationMutation,
    markConversationAsReadMutation,
    getRecipientsQuery
  } = useMessagesQuery();

  const { 
    data: conversationsData, 
    isLoading: isLoadingConversations,
    refetch: refetchConversations
  } = getConversationsQuery();

  const { 
    data: messagesData, 
    isLoading: isLoadingMessages,
    refetch: refetchMessages
  } = getMessagesQuery(selectedConversationId || '');

  const {
    data: recipientsData,
    isLoading: isLoadingRecipients
  } = getRecipientsQuery();

  // Extract conversations from the API response
  const conversationsResponse = conversationsData?.data?.data as any;
  const conversations = conversationsResponse?.items || [];
  
  // Filter conversations by search text
  const filteredConversations = conversations.filter((conversation: any) => {
    const participantName = conversation.participants.find(
      (participant: any) => !participant.isCurrentUser
    )?.name || '';
    
    return participantName.toLowerCase().includes(searchText.toLowerCase());
  });

  // Extract messages from the API response
  const messagesResponse = messagesData?.data?.data as any;
  const messages = messagesResponse?.items || [];

  // Extract recipients from the API response
  const recipients = recipientsData?.data?.data || [];

  // Mark conversation as read when selected
  useEffect(() => {
    if (selectedConversationId) {
      markConversationAsReadMutation.mutate(selectedConversationId, {
        onSuccess: () => {
          refetchConversations();
        }
      });
    }
  }, [selectedConversationId, markConversationAsReadMutation, refetchConversations]);

  // Handle select conversation
  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
  };

  // Handle send message
  const handleSendMessage = (content: string) => {
    if (selectedConversationId) {
      sendMessageMutation.mutate(
        { conversationId: selectedConversationId, content },
        {
          onSuccess: () => {
            refetchMessages();
            refetchConversations();
          },
          onError: (error: any) => {
            message.error(error.response?.data?.message || 'Failed to send message');
          }
        }
      );
    }
  };

  // Handle create conversation
  const handleCreateConversation = (recipientId: string, initialMessage: string) => {
    createConversationMutation.mutate(
      { recipientId, initialMessage },
      {
        onSuccess: (response) => {
          const newConversationId = response.data?.data?.id;
          if (newConversationId) {
            setSelectedConversationId(newConversationId);
            setIsModalVisible(false);
            refetchConversations();
            message.success('Conversation created successfully');
          }
        },
        onError: (error: any) => {
          message.error(error.response?.data?.message || 'Failed to create conversation');
        }
      }
    );
  };

  return (
    <div className="h-full">
      <Layout className="h-full">
        {/* Conversations Sidebar */}
        <Sider
          width={300}
          theme="light"
          className="border-r overflow-hidden flex flex-col"
        >
          <div className="p-4 border-b">
            <div className="flex justify-between items-center mb-4">
              <Title level={4} className="m-0">Messages</Title>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setIsModalVisible(true)}
              >
                New
              </Button>
            </div>
            <Input
              placeholder="Search conversations..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
          </div>
          
          <div className="flex-1 overflow-y-auto">
            <ConversationList
              conversations={filteredConversations}
              selectedConversationId={selectedConversationId}
              isLoading={isLoadingConversations}
              onSelectConversation={handleSelectConversation}
            />
          </div>
        </Sider>
        
        {/* Messages Content */}
        <Content className="bg-white flex flex-col">
          {selectedConversationId ? (
            <>
              {/* Conversation Header */}
              <div className="p-4 border-b">
                <Title level={4} className="m-0">
                  {filteredConversations.find(
                    (c: any) => c.id === selectedConversationId
                  )?.participants.find(
                    (p: any) => !p.isCurrentUser
                  )?.name || 'Conversation'}
                </Title>
              </div>
              
              {/* Messages */}
              <div className="flex-1 overflow-hidden">
                <MessageList
                  messages={messages}
                  isLoading={isLoadingMessages}
                  currentUserId={user?.id || ''}
                />
              </div>
              
              {/* Message Input */}
              <MessageInput
                onSendMessage={handleSendMessage}
                isLoading={sendMessageMutation.isPending}
              />
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <Empty
                description="Select a conversation or start a new one"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          )}
        </Content>
      </Layout>
      
      {/* New Conversation Modal */}
      <NewConversationModal
        visible={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onCreateConversation={handleCreateConversation}
        isLoading={createConversationMutation.isPending}
        recipients={recipients}
      />
    </div>
  );
};

export default StudentMessages;
