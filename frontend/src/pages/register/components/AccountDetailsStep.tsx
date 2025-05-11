import React from 'react';
import { Form, Input, Select, Button, Spin, Divider } from 'antd';
import {
  LockOutlined,
  IdcardOutlined,
  PhoneOutlined,
  BookOutlined,
  ApartmentOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { UserType } from '../utils';

interface AccountDetailsStepProps {
  userType: UserType;
  departmentOptions: any[];
  fetchingDepartments: boolean;
  refreshDepartments: () => void;
}

const AccountDetailsStep: React.FC<AccountDetailsStepProps> = ({
  userType,
  departmentOptions,
  fetchingDepartments,
  refreshDepartments,
}) => {
  return (
    <>
      <Form.Item
        name="password"
        rules={[
          { required: true, message: "Please enter your password" },
          { min: 6, message: "Password must be at least 6 characters" },
          {
            pattern: /\d/,
            message: "Password must contain at least one number",
          },
          {
            pattern: /[A-Z]/,
            message: "Password must contain at least one uppercase letter",
          },
        ]}
        hasFeedback
      >
        <Input.Password
          prefix={<LockOutlined className="site-form-item-icon" />}
          placeholder="Password"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        dependencies={["password"]}
        hasFeedback
        rules={[
          { required: true, message: "Please confirm your password" },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue("password") === value) {
                return Promise.resolve();
              }
              return Promise.reject(
                new Error("The two passwords do not match")
              );
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined className="site-form-item-icon" />}
          placeholder="Confirm Password"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="departmentId"
        rules={[
          { required: true, message: "Please select your department" },
        ]}
      >
        <Select
          placeholder="Select Department"
          size="large"
          loading={fetchingDepartments}
          showSearch
          filterOption={(input, option) =>
            (option?.label as string)
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          notFoundContent={
            fetchingDepartments ? (
              <Spin size="small" />
            ) : (
              <div className="text-center py-2">
                <div>No departments found</div>
                <Button
                  type="link"
                  onClick={() => refreshDepartments()}
                  icon={<ReloadOutlined />}
                >
                  Refresh
                </Button>
              </div>
            )
          }
          options={departmentOptions}
          dropdownRender={(menu) => (
            <>
              {menu}
              <Divider style={{ margin: "8px 0" }} />
              <Button
                type="text"
                icon={<ReloadOutlined />}
                onClick={() => refreshDepartments()}
                loading={fetchingDepartments}
                block
              >
                Refresh Departments
              </Button>
            </>
          )}
        />
      </Form.Item>

      {userType === "student" ? (
        <Form.Item
          name="enrollmentNo"
          rules={[
            {
              required: true,
              message: "Please enter your enrollment number",
            },
          ]}
        >
          <Input
            prefix={<IdcardOutlined className="site-form-item-icon" />}
            placeholder="Enrollment Number"
            size="large"
          />
        </Form.Item>
      ) : (
        <>
          <Form.Item
            name="qualification"
            rules={[
              {
                required: true,
                message: "Please enter your qualification",
              },
            ]}
          >
            <Input
              prefix={<BookOutlined className="site-form-item-icon" />}
              placeholder="Qualification (e.g., Ph.D., M.Tech)"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="specialization"
            rules={[
              {
                required: false,
                message: "Please enter your specialization",
              },
            ]}
          >
            <Input
              prefix={<ApartmentOutlined className="site-form-item-icon" />}
              placeholder="Specialization (Optional)"
              size="large"
            />
          </Form.Item>
        </>
      )}

      <Form.Item
        name="phoneNumber"
        rules={[
          {
            pattern: /^\+?[1-9]\d{1,14}$/,
            message: "Please enter a valid phone number",
          },
        ]}
      >
        <Input
          prefix={<PhoneOutlined className="site-form-item-icon" />}
          placeholder="Phone Number (Optional)"
          size="large"
        />
      </Form.Item>
    </>
  );
};

export default AccountDetailsStep;
