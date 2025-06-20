import React, { useState, useRef, useEffect } from "react";
import {
  Card,
  Typography,
  Button,
  Avatar,
  Space,
  Input,
  Pagination,
  Spin,
  Empty,
  Dropdown,
  App,
  Tag,
  Divider,
} from "antd";
import {
  ArrowLeftOutlined,
  SendOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  UserOutlined,
  FileTextOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";
import { useApi, useMutation } from "@/hooks";
import { studentService } from "@/services";
import { useAuth } from "@/context/AuthContext";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const { Title, Text, Paragraph } = Typography;

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  student?: {
    id: string;
    name: string;
  };
  teacher?: {
    id: string;
    name: string;
  };
}

const StudentResourceComments: React.FC = () => {
  const { resourceId } = useParams<{ resourceId: string }>();
  const navigate = useNavigate();
  const { notification, modal } = App.useApp();
  const { user } = useAuth();
  const [commentText, setCommentText] = useState("");
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // API queries - Note: We'll need to create these endpoints
  const resourceQuery = useApi(
    () =>
      resourceId
        ? studentService.getResourceDetails(resourceId)
        : Promise.reject("No resource ID"),
    {
      immediate: !!resourceId,
      dependencies: [resourceId],
    }
  );

  const commentsQuery = useApi(
    () =>
      resourceId
        ? studentService.getResourceComments(resourceId, {
            page: currentPage,
            limit: pageSize,
          })
        : Promise.reject("No resource ID"),
    {
      immediate: !!resourceId,
      dependencies: [resourceId, currentPage],
    }
  );

  // Mutations
  const createCommentMutation = useMutation(
    ({ resourceId, content }: { resourceId: string; content: string }) =>
      studentService.createResourceComment(resourceId, { content }),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Comment added successfully.",
        });
        // Comment added successfully
        commentsQuery.refetch();
      },
      onError: (error: any) => {
        notification.error({
          message: "Error",
          description:
            error.response?.data?.message || "Failed to add comment.",
        });
      },
    }
  );

  const updateCommentMutation = useMutation(
    ({ commentId, content }: { commentId: string; content: string }) =>
      studentService.updateResourceComment(commentId, { content }),
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Comment updated successfully.",
        });
        setEditingComment(null);
        // Comment updated successfully
        commentsQuery.refetch();
      },
      onError: (error: any) => {
        notification.error({
          message: "Error",
          description:
            error.response?.data?.message || "Failed to update comment.",
        });
      },
    }
  );

  const deleteCommentMutation = useMutation(
    studentService.deleteResourceComment,
    {
      onSuccess: () => {
        notification.success({
          message: "Success",
          description: "Comment deleted successfully.",
        });
        commentsQuery.refetch();
      },
      onError: (error: any) => {
        notification.error({
          message: "Error",
          description:
            error.response?.data?.message || "Failed to delete comment.",
        });
      },
    }
  );

  const resource = resourceQuery.data?.data;
  const commentsResponse = commentsQuery.data?.data;

  // Handle the paginated API response structure
  const comments = commentsResponse?.items || [];
  const pagination = commentsResponse?.pagination || {
    total: 0,
    page: currentPage,
    limit: pageSize,
    hasMore: false,
  };

  const handleBack = () => {
    navigate(-1);
  };

  const handleViewResource = () => {
    if (resource?.url) {
      window.open(resource.url, "_blank");
    }
  };

  const handleSubmitComment = async () => {
    if (!resourceId || !commentText.trim()) return;

    try {
      await createCommentMutation.mutateAsync({
        resourceId,
        content: commentText.trim(),
      });
      setCommentText("");
    } catch (error) {
      // Error handled by mutation
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitComment();
    }
  };

  const handleEditComment = (comment: Comment) => {
    setEditingComment(comment.id);
    setEditText(comment.content);
  };

  const handleUpdateComment = async () => {
    if (!editingComment || !editText.trim()) return;

    try {
      await updateCommentMutation.mutateAsync({
        commentId: editingComment,
        content: editText.trim(),
      });
      setEditingComment(null);
      setEditText("");
    } catch (error) {
      // Error handled by mutation
    }
  };

  const handleDeleteComment = (commentId: string) => {
    modal.confirm({
      title: "Delete Comment",
      content:
        "Are you sure you want to delete this comment? This action cannot be undone.",
      onOk: () => deleteCommentMutation.mutateAsync(commentId),
    });
  };

  const handleCancelEdit = () => {
    setEditingComment(null);
    setEditText("");
  };

  // Auto-scroll to bottom when new comments are added
  useEffect(() => {
    if (commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments.length]);

  const getResourceTypeColor = (type: string) => {
    switch (type) {
      case "VIDEO":
        return "red";
      case "DOCUMENT":
        return "blue";
      case "LINK":
        return "green";
      default:
        return "default";
    }
  };

  const isCommentOwner = (comment: Comment) => {
    return comment.student?.id === user?.id;
  };

  if (resourceQuery.loading) {
    return (
      <div className="flex justify-center items-center min-h-96">
        <Spin size="large" />
      </div>
    );
  }

  if (resourceQuery.error || !resource) {
    return (
      <div className="p-6">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
          className="mb-4"
        >
          Back
        </Button>
        <Empty description="Resource not found or you don't have access to this resource" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-4">
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            Back
          </Button>
          <div>
            <Title level={2} className="mb-0">
              Resource Comments
            </Title>
          </div>
        </div>
        <Button
          type="primary"
          icon={<EyeOutlined />}
          onClick={handleViewResource}
        >
          View Resource
        </Button>
      </div>

      {/* Resource Info */}
      <Card className="mb-6">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Space>
            <FileTextOutlined className="text-blue-500" />
            <Title level={4} className="mb-0">
              {resource.title}
            </Title>
            <Tag color={getResourceTypeColor(resource.type)}>
              {resource.type}
            </Tag>
          </Space>
          {resource.description && (
            <Paragraph type="secondary">{resource.description}</Paragraph>
          )}
          <Space>
            <Text type="secondary">Course: {resource.course?.name}</Text>
            <Divider type="vertical" />
            <Text type="secondary">By: {resource.teacher?.name}</Text>
            <Divider type="vertical" />
            <Text type="secondary">
              Created: {dayjs(resource.createdAt).format("MMM D, YYYY")}
            </Text>
          </Space>
        </Space>
      </Card>

      {/* Facebook-like Comments Container */}
      <div
        style={{
          height: "60vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid #d9d9d9",
          borderRadius: "8px",
          backgroundColor: "#fff",
        }}
      >
        {/* Comments Header */}
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #f0f0f0",
            backgroundColor: "#fafafa",
            borderRadius: "8px 8px 0 0",
          }}
        >
          <Typography.Title level={5} style={{ margin: 0 }}>
            Comments ({pagination.total})
          </Typography.Title>
        </div>

        {/* Comments List - Scrollable Area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
          }}
        >
          {commentsQuery.loading ? (
            <div className="flex justify-center py-8">
              <Spin size="large" />
            </div>
          ) : comments.length > 0 ? (
            <>
              {comments.map((comment: Comment) => (
                <div key={comment.id} style={{ marginBottom: "16px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                    }}
                  >
                    <Avatar icon={<UserOutlined />} size={40} />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          backgroundColor: "#f0f2f5",
                          borderRadius: "18px",
                          padding: "8px 12px",
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "13px",
                            color: "#050505",
                            marginBottom: "2px",
                          }}
                        >
                          {comment.student?.name ||
                            comment.teacher?.name ||
                            "Unknown User"}
                          {comment.teacher && (
                            <Tag
                              color="blue"
                              style={{ marginLeft: "8px", fontSize: "11px" }}
                            >
                              Teacher
                            </Tag>
                          )}
                        </div>
                        {editingComment === comment.id ? (
                          <div>
                            <Input.TextArea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  handleUpdateComment();
                                }
                              }}
                              autoSize={{ minRows: 1, maxRows: 4 }}
                              style={{
                                border: "none",
                                backgroundColor: "transparent",
                                padding: 0,
                                resize: "none",
                              }}
                            />
                            <div style={{ marginTop: "8px" }}>
                              <Button
                                size="small"
                                type="primary"
                                loading={updateCommentMutation.loading}
                                onClick={handleUpdateComment}
                                style={{ marginRight: "8px" }}
                              >
                                Save
                              </Button>
                              <Button size="small" onClick={handleCancelEdit}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: "14px", lineHeight: "1.4" }}>
                            {comment.content}
                          </div>
                        )}

                        {/* Comment Actions */}
                        {isCommentOwner(comment) &&
                          editingComment !== comment.id && (
                            <Dropdown
                              menu={{
                                items: [
                                  {
                                    key: "edit",
                                    label: "Edit",
                                    icon: <EditOutlined />,
                                    onClick: () => handleEditComment(comment),
                                  },
                                  {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <DeleteOutlined />,
                                    danger: true,
                                    onClick: () =>
                                      handleDeleteComment(comment.id),
                                  },
                                ],
                              }}
                              trigger={["click"]}
                              placement="bottomRight"
                            >
                              <Button
                                type="text"
                                icon={<MoreOutlined />}
                                size="small"
                                style={{
                                  position: "absolute",
                                  top: "4px",
                                  right: "4px",
                                  opacity: 0.6,
                                }}
                              />
                            </Dropdown>
                          )}
                      </div>

                      {/* Comment Metadata */}
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#65676b",
                          marginTop: "4px",
                          marginLeft: "12px",
                        }}
                      >
                        {dayjs(comment.createdAt).fromNow()}
                        {comment.updatedAt !== comment.createdAt && (
                          <span style={{ marginLeft: "8px" }}>(edited)</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={commentsEndRef} />

              {/* Pagination */}
              {pagination.total > pageSize && (
                <div className="flex justify-center mt-4">
                  <Pagination
                    current={pagination.page}
                    pageSize={pagination.limit}
                    total={pagination.total}
                    onChange={setCurrentPage}
                    showSizeChanger={false}
                    showQuickJumper
                    showTotal={(total) => `Total ${total} comments`}
                    size="small"
                  />
                </div>
              )}
            </>
          ) : (
            <Empty
              description="No comments yet. Be the first to comment!"
              style={{ marginTop: "40px" }}
            />
          )}
        </div>

        {/* Comment Input - Fixed at Bottom */}
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fff",
            borderTop: "1px solid #f0f0f0",
            borderRadius: "0 0 8px 8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
            <Avatar icon={<UserOutlined />} size={32} />
            <div style={{ flex: 1, position: "relative" }}>
              <Input.TextArea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a comment..."
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{
                  borderRadius: "20px",
                  paddingRight: "40px",
                  backgroundColor: "#f0f2f5",
                  border: "none",
                }}
              />
              <Button
                type="text"
                icon={<SendOutlined />}
                onClick={handleSubmitComment}
                loading={createCommentMutation.loading}
                disabled={!commentText.trim()}
                style={{
                  position: "absolute",
                  right: "8px",
                  bottom: "4px",
                  color: commentText.trim() ? "#1890ff" : "#bfbfbf",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentResourceComments;
