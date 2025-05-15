import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, Switch, Button } from 'antd';
import { NewsEvent } from '@/common/types';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;

interface CreateNewsEventModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: any) => void;
  isSubmitting: boolean;
  editingNewsEvent: NewsEvent | null;
  title?: string;
}

/**
 * Modal component for creating or editing a news/event
 */
const CreateNewsEventModal: React.FC<CreateNewsEventModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
  editingNewsEvent,
  title = 'Create News/Event',
}) => {
  const [form] = Form.useForm();

  // Reset form when modal is opened/closed or editing item changes
  useEffect(() => {
    if (visible) {
      if (editingNewsEvent) {
        form.setFieldsValue({
          title: editingNewsEvent.title,
          content: editingNewsEvent.content,
          type: editingNewsEvent.type,
          date: editingNewsEvent.date ? dayjs(editingNewsEvent.date) : null,
          isPublished: editingNewsEvent.isPublished,
          imageUrl: editingNewsEvent.imageUrl,
        });
      } else {
        form.resetFields();
        // Set default values
        form.setFieldsValue({
          type: 'NEWS',
          date: dayjs(),
          isPublished: false,
        });
      }
    }
  }, [visible, form, editingNewsEvent]);

  const handleSubmit = (values: any) => {
    const submitData = {
      ...values,
      date: values.date?.toISOString(),
    };
    
    if (editingNewsEvent) {
      submitData.id = editingNewsEvent.id;
    }
    
    onSubmit(submitData);
  };

  return (
    <Modal
      title={editingNewsEvent ? 'Edit News/Event' : title}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={700}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="title"
          label="Title"
          rules={[
            { required: true, message: 'Please enter a title' },
            { min: 3, message: 'Title must be at least 3 characters' },
          ]}
        >
          <Input placeholder="Enter title" />
        </Form.Item>

        <Form.Item
          name="type"
          label="Type"
          rules={[{ required: true, message: 'Please select a type' }]}
        >
          <Select placeholder="Select type">
            <Option value="NEWS">News</Option>
            <Option value="EVENT">Event</Option>
            <Option value="ANNOUNCEMENT">Announcement</Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="date"
          label="Date"
          rules={[{ required: true, message: 'Please select a date' }]}
        >
          <DatePicker 
            style={{ width: '100%' }} 
            showTime 
            format="YYYY-MM-DD HH:mm"
          />
        </Form.Item>

        <Form.Item
          name="content"
          label="Content"
          rules={[
            { required: true, message: 'Please enter content' },
            { min: 10, message: 'Content must be at least 10 characters' },
          ]}
        >
          <TextArea
            placeholder="Enter content"
            autoSize={{ minRows: 4, maxRows: 8 }}
          />
        </Form.Item>

        <Form.Item
          name="imageUrl"
          label="Image URL (Optional)"
        >
          <Input placeholder="Enter image URL" />
        </Form.Item>

        <Form.Item
          name="isPublished"
          label="Published"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            {editingNewsEvent ? 'Update' : 'Create'}
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateNewsEventModal;
