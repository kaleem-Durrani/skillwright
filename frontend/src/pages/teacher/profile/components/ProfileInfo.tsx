import React from 'react';
import { Card, Avatar, Typography, Descriptions, Button, Tag, Divider } from 'antd';
import { EditOutlined, UserOutlined, MailOutlined, PhoneOutlined, BookOutlined, BankOutlined } from '@ant-design/icons';
import { Teacher } from '@/common/types';

const { Title, Text } = Typography;

interface ProfileInfoProps {
  teacher: Teacher;
  loading: boolean;
  onEdit: () => void;
}

/**
 * Component to display teacher profile information
 */
const ProfileInfo: React.FC<ProfileInfoProps> = ({ teacher, loading, onEdit }) => {
  if (!teacher) return null;

  return (
    <Card loading={loading} className="shadow-sm">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Profile Image and Basic Info */}
        <div className="flex flex-col items-center">
          <Avatar 
            size={120} 
            icon={<UserOutlined />} 
            className="bg-green-600 mb-4"
          />
          <Title level={4}>{teacher.name}</Title>
          <Text type="secondary">{teacher.qualification}</Text>
          {teacher.specialization && (
            <Tag color="green" className="mt-2">{teacher.specialization}</Tag>
          )}
          <Button 
            type="primary" 
            icon={<EditOutlined />} 
            onClick={onEdit}
            className="mt-4"
          >
            Edit Profile
          </Button>
        </div>

        <Divider type="vertical" className="hidden md:block h-auto" />

        {/* Detailed Information */}
        <div className="flex-1">
          <Descriptions 
            title="Profile Details" 
            column={{ xs: 1, sm: 2 }}
            layout="vertical"
            bordered
          >
            <Descriptions.Item 
              label={<><MailOutlined className="mr-2" /> Email</>}
            >
              {teacher.email}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label={<><PhoneOutlined className="mr-2" /> Phone Number</>}
            >
              {teacher.phoneNumber || 'Not provided'}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label={<><BookOutlined className="mr-2" /> Qualification</>}
            >
              {teacher.qualification}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label={<><BankOutlined className="mr-2" /> Department</>}
            >
              {teacher.department?.name || 'Not assigned'}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label="Specialization"
              span={2}
            >
              {teacher.specialization || 'Not specified'}
            </Descriptions.Item>
          </Descriptions>
        </div>
      </div>
    </Card>
  );
};

export default ProfileInfo;
