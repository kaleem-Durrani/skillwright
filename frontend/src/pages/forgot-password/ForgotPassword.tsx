import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Steps, Typography, Button, Space, Result } from "antd";
import {
  MailOutlined,
  SafetyOutlined,
  LockOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { EmailStep, OtpStep, ResetStep } from "./components";
import { ROUTES } from "@/common";

const { Title, Text } = Typography;

export type UserType = "student" | "teacher";

export interface ForgotPasswordState {
  email: string;
  userType: UserType;
  otp: string;
  newPassword: string;
  confirmPassword: string;
}

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<ForgotPasswordState>({
    email: "",
    userType: "student",
    otp: "",
    newPassword: "",
    confirmPassword: "",
  });

  const steps = [
    {
      title: "Email",
      icon: <MailOutlined />,
      description: "Enter your email address",
    },
    {
      title: "Verification",
      icon: <SafetyOutlined />,
      description: "Enter OTP from email",
    },
    {
      title: "Reset",
      icon: <LockOutlined />,
      description: "Set new password",
    },
    {
      title: "Complete",
      icon: <CheckCircleOutlined />,
      description: "Password reset successful",
    },
  ];

  const handleNext = () => {
    setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
  };

  const handleUpdateFormData = (data: Partial<ForgotPasswordState>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const handleComplete = () => {
    // Navigate to login page
    navigate(ROUTES.LOGIN);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <EmailStep
            formData={formData}
            onNext={handleNext}
            onUpdateFormData={handleUpdateFormData}
            loading={loading}
            setLoading={setLoading}
          />
        );
      case 1:
        return (
          <OtpStep
            formData={formData}
            onNext={handleNext}
            onBack={handleBack}
            onUpdateFormData={handleUpdateFormData}
            loading={loading}
            setLoading={setLoading}
          />
        );
      case 2:
        return (
          <ResetStep
            formData={formData}
            onNext={handleNext}
            onBack={handleBack}
            onUpdateFormData={handleUpdateFormData}
            loading={loading}
            setLoading={setLoading}
          />
        );
      case 3:
        return (
          <Result
            status="success"
            title="Password Reset Successful!"
            subTitle="Your password has been successfully reset. You can now login with your new password."
            extra={[
              <Button type="primary" key="login" onClick={handleComplete}>
                Go to Login
              </Button>,
            ]}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className=" flex items-center justify-center p-4 relative z-10">
      <Card className="w-full max-w-md shadow-2xl border-0 bg-white/95 backdrop-blur-sm">
        <div className="text-center mb-6">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(ROUTES.LOGIN)}
            className="absolute top-4 left-4 text-gray-600 hover:text-gray-800"
          >
            Back to Login
          </Button>

          <Title level={2} className="!mb-2 !mt-8">
            Reset Password
          </Title>
          <Text className="text-gray-600">
            Follow the steps below to reset your password
          </Text>
        </div>

        <Steps
          current={currentStep}
          size="small"
          className="mb-8"
          items={steps}
        />

        <div className="min-h-[300px]">{renderStepContent()}</div>
      </Card>
    </div>
  );
};

export default ForgotPassword;
