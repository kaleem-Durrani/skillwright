import React from 'react';
import { Card, Avatar, Typography, Descriptions, Button, Divider } from 'antd';
import { EditOutlined, UserOutlined, MailOutlined, PhoneOutlined, BankOutlined } from '@ant-design/icons';
import { Admin } from '@/common/types';

const { Title, Text } = Typography;

interface ProfileInfoProps {
  admin: Admin;
  loading: boolean;
  onEdit: () => void;
}

/**
 * Component to display admin profile information
 */
const ProfileInfo: React.FC<ProfileInfoProps> = ({ admin, loading, onEdit }) => {
  if (!admin) return null;

  return (
    <Card loading={loading} className="shadow-sm">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Profile Image and Basic Info */}
        <div className="flex flex-col items-center">
          <Avatar 
            size={120} 
            icon={<UserOutlined />} 
            className="bg-blue-600 mb-4"
          />
          <Title level={4}>{admin.name}</Title>
          <Text type="secondary">Administrator</Text>
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
              {admin.email}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label={<><PhoneOutlined className="mr-2" /> Phone Number</>}
            >
              {admin.phoneNumber || 'Not provided'}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label={<><BankOutlined className="mr-2" /> Role</>}
              span={2}
            >
              {admin.role || 'Administrator'}
            </Descriptions.Item>
            
            <Descriptions.Item 
              label="Account Created"
              span={2}
            >
              {new Date(admin.createdAt).toLocaleDateString()}
            </Descriptions.Item>
          </Descriptions>
        </div>
      </div>
    </Card>
  );
};

export default ProfileInfo;
