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
    <div className="flex flex-col items-center py-3 px-4 rounded-xl backdrop-blur-md bg-white/30 border border-white/40 shadow-md">
      <Text className="text-lg mb-2 font-medium text-gray-800">
        Select User Type
      </Text>
      <Radio.Group
        value={selectedType}
        onChange={(e) => onChange(e.target.value as LoginType)}
        buttonStyle="solid"
        className="login-type-selector"
      >
        <Radio.Button
          value="student"
          className={`px-6 py-1 ${
            selectedType === "student" ? "bg-blue-600 text-white" : ""
          }`}
        >
          Student
        </Radio.Button>
        <Radio.Button
          value="teacher"
          className={`px-6 py-1 ${
            selectedType === "teacher" ? "bg-green-600 text-white" : ""
          }`}
        >
          Teacher
        </Radio.Button>
        <Radio.Button
          value="admin"
          className={`px-6 py-1 ${
            selectedType === "admin" ? "bg-indigo-600 text-white" : ""
          }`}
        >
          Admin
        </Radio.Button>
      </Radio.Group>
    </div>
  );
};

export default LoginTypeSelector;
