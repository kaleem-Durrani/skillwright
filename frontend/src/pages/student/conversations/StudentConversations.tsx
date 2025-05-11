import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Typography,
  Card,
  List,
  Avatar,
  Button,
  Input,
  Empty,
  Spin,
  Divider,
  Space,
  Badge,
  Modal,
  Form,
  Select,
  message,
  Tooltip,
} from "antd";
import {
  SendOutlined,
  UserOutlined,
  MessageOutlined,
  PlusOutlined,
  TeamOutlined,
  ArrowLeftOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import {
  useConversationQuery,
  useStudentQuery,
  useTeacherQuery,
} from "@/hooks";
import { ROUTES } from "@/common/constants";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;
const { confirm } = Modal;

const StudentConversations = () => {
  const navigate = useNavigate();
  const { id: conversationId } = useParams<{ id: string }>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messageText, setMessageText] = useState("");
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [form] = Form.useForm();

  // Get conversations data
  const {
    studentGetConversationsQuery,
    studentGetConversationQuery,
    studentCreateConversationMutation,
    studentSendMessageMutation,
    studentLeaveConversationMutation,
  } = useConversationQuery();

  const { getProfileQuery } = useStudentQuery();
  const { data: profileData } = getProfileQuery;
  const student = profileData?.data;

  // Get conversations list
  const {
    data: conversationsData,
    isLoading: isLoadingConversations,
    refetch: refetchConversations,
  } = studentGetConversationsQuery();

  // Get selected conversation details
  const {
    data: conversationData,
    isLoading: isLoadingConversation,
    refetch: refetchConversation,
  } = studentGetConversationQuery(conversationId || "");

  // Scroll to bottom of messages when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [conversationData]);

  // Handle send message
  const handleSendMessage = () => {
    if (!messageText.trim() || !conversationId) return;

    studentSendMessageMutation.mutate(
      { conversationId, content: messageText },
      {
        onSuccess: () => {
          setMessageText("");
          refetchConversation();
        },
        onError: (error: any) => {
          message.error(
            error.response?.data?.message || "Failed to send message"
          );
        },
      }
    );
  };

  // Handle create new conversation
  const handleCreateConversation = () => {
    form.validateFields().then((values) => {
      const participants = [
        {
          userId: student?.id || "",
          userType: "student",
        },
      ];

      if (values.teacherId) {
        participants.push({
          userId: values.teacherId,
          userType: "teacher",
        });
      }

      if (values.adminId) {
        participants.push({
          userId: values.adminId,
          userType: "admin",
        });
      }

      studentCreateConversationMutation.mutate(
        {
          title: values.title,
          participants,
        },
        {
          onSuccess: (data) => {
            message.success("Conversation created successfully");
            setIsCreateModalVisible(false);
            form.resetFields();
            refetchConversations();
            // Navigate to the new conversation
            if (data?.data?.id) {
              navigate(`/student/conversations/${data.data.id}`);
            }
          },
          onError: (error: any) => {
            message.error(
              error.response?.data?.message || "Failed to create conversation"
            );
          },
        }
      );
    });
  };

  // Handle leave conversation
  const handleLeaveConversation = () => {
    if (!conversationId) return;

    confirm({
      title: "Are you sure you want to leave this conversation?",
      content: "You will no longer receive messages from this conversation.",
      onOk() {
        studentLeaveConversationMutation.mutate(conversationId, {
          onSuccess: () => {
            message.success("You have left the conversation");
            refetchConversations();
            navigate("/student/conversations");
          },
          onError: (error: any) => {
            message.error(
              error.response?.data?.message || "Failed to leave conversation"
            );
          },
        });
      },
    });
  };

  // Format date for messages
  const formatMessageDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Get conversations list
  const conversations = conversationsData?.data?.items || [];

  // Get current conversation
  const conversation = conversationData?.data;
  const messages = conversation?.messages || [];

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <Title level={2}>Messages</Title>
          <Text className="text-gray-600">
            Communicate with teachers and administrators
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsCreateModalVisible(true)}
        >
          New Conversation
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Conversations List */}
        <Card className="w-full md:w-1/3">
          <div className="mb-4">
            <Input
              placeholder="Search conversations..."
              prefix={<MessageOutlined />}
              allowClear
            />
          </div>

          {isLoadingConversations ? (
            <div className="flex justify-center py-10">
              <Spin size="large" />
            </div>
          ) : conversations.length > 0 ? (
            <List
              itemLayout="horizontal"
              dataSource={conversations}
              renderItem={(item: any) => {
                // Find other participants (not the current student)
                const otherParticipants = item.participants?.filter(
                  (p: any) => p.userId !== student?.id
                );
                const title =
                  item.title ||
                  otherParticipants
                    ?.map((p: any) => p.name || "Unknown")
                    .join(", ") ||
                  "Conversation";

                return (
                  <List.Item
                    className={`cursor-pointer hover:bg-gray-50 rounded p-2 ${
                      conversationId === item.id ? "bg-blue-50" : ""
                    }`}
                    onClick={() =>
                      navigate(`/student/conversations/${item.id}`)
                    }
                  >
                    <List.Item.Meta
                      avatar={
                        <Badge count={0} dot>
                          <Avatar icon={<TeamOutlined />} />
                        </Badge>
                      }
                      title={title}
                      description={
                        <Space direction="vertical" size={0}>
                          <Text type="secondary" ellipsis>
                            {item.messages?.[item.messages.length - 1]
                              ?.content || "No messages yet"}
                          </Text>
                          <Text type="secondary" className="text-xs">
                            <ClockCircleOutlined className="mr-1" />
                            {item.updatedAt
                              ? new Date(item.updatedAt).toLocaleDateString()
                              : "Unknown date"}
                          </Text>
                        </Space>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          ) : (
            <Empty
              description="No conversations found"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </Card>

        {/* Conversation Messages */}
        <Card
          className="w-full md:w-2/3 flex flex-col"
          style={{ minHeight: "70vh" }}
        >
          {conversationId ? (
            isLoadingConversation ? (
              <div className="flex justify-center items-center h-full">
                <Spin size="large" />
              </div>
            ) : (
              <>
                {/* Conversation Header */}
                <div className="flex justify-between items-center mb-4 pb-4 border-b">
                  <div className="flex items-center gap-2">
                    <Button
                      icon={<ArrowLeftOutlined />}
                      type="text"
                      onClick={() => navigate("/student/conversations")}
                      className="md:hidden"
                    />
                    <Title level={4} className="m-0">
                      {conversation?.title ||
                        conversation?.participants
                          ?.filter((p: any) => p.userId !== student?.id)
                          .map((p: any) => p.name || "Unknown")
                          .join(", ") ||
                        "Conversation"}
                    </Title>
                  </div>
                  <Button danger onClick={handleLeaveConversation}>
                    Leave Conversation
                  </Button>
                </div>

                {/* Messages List */}
                <div
                  className="flex-1 overflow-y-auto mb-4"
                  style={{ minHeight: "400px" }}
                >
                  {messages.length > 0 ? (
                    <List
                      itemLayout="horizontal"
                      dataSource={messages}
                      renderItem={(msg: any) => {
                        const isCurrentUser = msg.senderId === student?.id;
                        return (
                          <List.Item
                            className={`border-0 ${
                              isCurrentUser ? "justify-end" : "justify-start"
                            }`}
                          >
                            <div
                              className={`max-w-[80%] ${
                                isCurrentUser ? "bg-blue-100" : "bg-gray-100"
                              } rounded-lg p-3`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Avatar
                                  size="small"
                                  icon={<UserOutlined />}
                                  className={
                                    isCurrentUser
                                      ? "bg-blue-500"
                                      : "bg-gray-500"
                                  }
                                />
                                <Text strong>
                                  {isCurrentUser
                                    ? "You"
                                    : msg.senderName ||
                                      `${msg.senderType} User`}
                                </Text>
                              </div>
                              <Paragraph className="m-0">
                                {msg.content}
                              </Paragraph>
                              <Text
                                type="secondary"
                                className="text-xs block text-right mt-1"
                              >
                                {formatMessageDate(msg.createdAt)}
                              </Text>
                            </div>
                          </List.Item>
                        );
                      }}
                    />
                  ) : (
                    <Empty
                      description="No messages yet. Start the conversation!"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <div className="mt-auto">
                  <div className="flex gap-2">
                    <TextArea
                      placeholder="Type your message..."
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      onPressEnter={(e) => {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      onClick={handleSendMessage}
                      disabled={!messageText.trim()}
                    />
                  </div>
                  <Text type="secondary" className="text-xs mt-1">
                    Press Enter to send, Shift+Enter for new line
                  </Text>
                </div>
              </>
            )
          ) : (
            <div className="flex flex-col justify-center items-center h-full">
              <Empty
                description="Select a conversation or create a new one"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Create Conversation Modal */}
      <Modal
        title="New Conversation"
        open={isCreateModalVisible}
        onCancel={() => setIsCreateModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsCreateModalVisible(false)}>
            Cancel
          </Button>,
          <Button
            key="create"
            type="primary"
            onClick={handleCreateConversation}
            loading={studentCreateConversationMutation.isLoading}
          >
            Create
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="Conversation Title"
            rules={[{ required: true, message: "Please enter a title" }]}
          >
            <Input placeholder="Enter a title for this conversation" />
          </Form.Item>

          <Form.Item
            name="teacherId"
            label="Select Teacher"
            rules={[
              { required: true, message: "Please select at least one teacher" },
            ]}
          >
            <Select placeholder="Select a teacher">
              {/* This would be populated from an API call */}
              <Option value="teacher1">Teacher 1</Option>
              <Option value="teacher2">Teacher 2</Option>
            </Select>
          </Form.Item>

          <Form.Item name="adminId" label="Include Administrator">
            <Select placeholder="Select an administrator (optional)">
              {/* This would be populated from an API call */}
              <Option value="admin1">Admin 1</Option>
              <Option value="admin2">Admin 2</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default StudentConversations;
