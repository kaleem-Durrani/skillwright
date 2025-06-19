import React, { useEffect } from "react";
import { Modal, Form, Input, Switch, Upload, message, Space } from "antd";
import { EditOutlined, InboxOutlined } from "@ant-design/icons";
import { Resource } from "@/common/types";

const { TextArea } = Input;

interface EditResourceModalProps {
  visible: boolean;
  resource: Resource | null;
  onCancel: () => void;
  onSubmit: (id: string, formData: FormData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for editing a resource
 */
const EditResourceModal: React.FC<EditResourceModalProps> = ({
  visible,
  resource,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();

  // Reset form when modal is opened/closed or resource changes
  useEffect(() => {
    if (visible && resource) {
      console.log("Setting form values for resource:", resource);
      form.setFieldsValue({
        title: resource.title,
        description: resource.description,
        isPublic: resource.isPublic,
      });
    } else if (!visible) {
      form.resetFields();
    }
  }, [visible, resource, form]);

  const handleSubmit = (values: any) => {
    if (!resource) return;

    const formData = new FormData();

    // Add form fields
    formData.append("title", values.title);
    formData.append("description", values.description || "");
    formData.append("isPublic", values.isPublic ? "true" : "false");

    // Add file if uploaded
    if (values.document && values.document[0]) {
      formData.append("document", values.document[0].originFileObj);
    }

    onSubmit(resource.id, formData);
  };

  const normFile = (e: any) => {
    if (Array.isArray(e)) {
      return e;
    }
    return e?.fileList;
  };

  const beforeUpload = (file: File) => {
    const isValidType =
      file.type.startsWith("image/") ||
      file.type.startsWith("video/") ||
      file.type.startsWith("application/");

    if (!isValidType) {
      message.error("You can only upload image, video, or document files!");
      return false;
    }

    const isLt50M = file.size / 1024 / 1024 < 50;
    if (!isLt50M) {
      message.error("File must be smaller than 50MB!");
      return false;
    }

    return false; // Prevent auto upload
  };

  return (
    <Modal
      title={
        <Space>
          <EditOutlined />
          <span>Edit Resource</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={isSubmitting}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        preserve={true}
      >
        <Form.Item
          name="title"
          label="Resource Title"
          rules={[
            { required: true, message: "Please enter resource title" },
            { min: 3, message: "Title must be at least 3 characters" },
          ]}
        >
          <Input placeholder="Enter resource title" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <TextArea
            placeholder="Enter resource description"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>

        <Form.Item
          name="document"
          label="Replace File (Optional)"
          valuePropName="fileList"
          getValueFromEvent={normFile}
          extra="Leave empty to keep the current file"
        >
          <Upload.Dragger
            name="document"
            beforeUpload={beforeUpload}
            maxCount={1}
            accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              Click or drag file to this area to replace current file
            </p>
            <p className="ant-upload-hint">
              Support for images, videos, documents (PDF, Word, Excel,
              PowerPoint, etc.)
              <br />
              Maximum file size: 50MB
            </p>
          </Upload.Dragger>
        </Form.Item>

        <Form.Item
          name="isPublic"
          label="Make Public"
          valuePropName="checked"
          extra="Public resources are visible to all students"
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EditResourceModal;
