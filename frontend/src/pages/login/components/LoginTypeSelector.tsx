import React from "react";
import { Radio, Typography } from "antd";

const { Text } = Typography;

export type LoginType = "student" | "teacher" | "admin";

interface LoginTypeSelectorProps {
  selectedType: LoginType;
  onChange: (type: LoginType) => void;
}

const LoginTypeSelector: React.FC<LoginTypeSelectorProps> = ({
  selectedType,
  onChange,
}) => {
  return (
    <div className="flex flex-col items-center mb-6">
      <Text className="text-lg mb-2 text-gray-700">Select User Type</Text>
      <Radio.Group
        value={selectedType}
        onChange={(e) => onChange(e.target.value as LoginType)}
        buttonStyle="solid"
        className="login-type-selector"
      >
        <Radio.Button value="student" className="px-6 py-1">
          Student
        </Radio.Button>
        <Radio.Button value="teacher" className="px-6 py-1">
          Teacher
        </Radio.Button>
        <Radio.Button value="admin" className="px-6 py-1">
          Admin
        </Radio.Button>
      </Radio.Group>
    </div>
  );
};

export default LoginTypeSelector;
