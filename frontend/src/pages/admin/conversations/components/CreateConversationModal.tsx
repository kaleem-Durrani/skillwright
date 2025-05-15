import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button, Divider } from 'antd';
import { useDepartmentQuery, useAdminQuery } from '@/hooks';
import { ConversationCreateData } from '@/common/types';

const { Option } = Select;
const { TextArea } = Input;

interface CreateConversationModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: ConversationCreateData) => void;
  isSubmitting: boolean;
}

/**
 * Modal component for creating a new conversation
 */
const CreateConversationModal: React.FC<CreateConversationModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  isSubmitting,
}) => {
  const [form] = Form.useForm();
  const [recipientType, setRecipientType] = useState<'teacher' | 'student'>('teacher');
  
  const { getAllDepartmentsQuery } = useDepartmentQuery();
  const { getTeachersQuery, getStudentsQuery } = useAdminQuery();
  
  const departmentsQuery = getAllDepartmentsQuery();
  const teachersQuery = getTeachersQuery();
  const studentsQuery = getStudentsQuery();
  
  const departments = departmentsQuery.data?.data?.data || [];
  const teachers = teachersQuery.data?.data?.data || [];
  const students = studentsQuery.data?.data?.data || [];

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (visible) {
      form.resetFields();
      setRecipientType('teacher');
    }
  }, [visible, form]);

  const handleSubmit = (values: any) => {
    const submitData: ConversationCreateData = {
      title: values.title,
      initialMessage: values.initialMessage,
      participants: [
        {
          id: values.recipientId,
          userType: recipientType,
        },
      ],
    };
    
    onSubmit(submitData);
  };

  return (
    <Modal
      title="Start New Conversation"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="title"
          label="Conversation Title (Optional)"
        >
          <Input placeholder="Enter conversation title" />
        </Form.Item>

        <Divider>Recipient</Divider>

        <Form.Item
          name="recipientType"
          label="Recipient Type"
          initialValue="teacher"
        >
          <Select 
            onChange={(value) => setRecipientType(value as 'teacher' | 'student')}
          >
            <Option value="teacher">Teacher</Option>
            <Option value="student">Student</Option>
          </Select>
        </Form.Item>

        {recipientType === 'teacher' && (
          <Form.Item
            name="recipientId"
            label="Select Teacher"
            rules={[{ required: true, message: 'Please select a teacher' }]}
          >
            <Select
              placeholder="Select a teacher"
              loading={teachersQuery.isLoading}
              showSearch
              optionFilterProp="children"
            >
              {teachers.map((teacher) => (
                <Option key={teacher.id} value={teacher.id}>
                  {teacher.name} ({teacher.email})
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}

        {recipientType === 'student' && (
          <>
            <Form.Item
              name="departmentId"
              label="Department (Optional)"
            >
              <Select
                placeholder="Filter by department"
                allowClear
                loading={departmentsQuery.isLoading}
              >
                {departments.map((dept) => (
                  <Option key={dept.id} value={dept.id}>
                    {dept.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="recipientId"
              label="Select Student"
              rules={[{ required: true, message: 'Please select a student' }]}
            >
              <Select
                placeholder="Select a student"
                loading={studentsQuery.isLoading}
                showSearch
                optionFilterProp="children"
              >
                {students.map((student) => (
                  <Option key={student.id} value={student.id}>
                    {student.name} ({student.email})
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </>
        )}

        <Form.Item
          name="initialMessage"
          label="Initial Message"
          rules={[
            { required: true, message: 'Please enter a message' },
            { min: 2, message: 'Message must be at least 2 characters' },
          ]}
        >
          <TextArea
            placeholder="Enter your message"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>

        <Form.Item className="mb-0 flex justify-end">
          <Button onClick={onCancel} className="mr-2">
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={isSubmitting}>
            Start Conversation
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateConversationModal;
