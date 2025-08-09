import { useState, useEffect } from "react";
import { Form, Input, Button, Typography, Space, App } from "antd";
import { SafetyOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { authService } from "@/services";
import type { ForgotPasswordState } from "../ForgotPassword";

const { Text, Title } = Typography;

interface OtpStepProps {
  formData: ForgotPasswordState;
  onNext: () => void;
  onBack: () => void;
  onUpdateFormData: (data: Partial<ForgotPasswordState>) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const OtpStep = ({
  formData,
  onNext,
  onBack,
  onUpdateFormData,
  loading,
  setLoading,
}: OtpStepProps) => {
  const [form] = Form.useForm();
  const { notification } = App.useApp();
  const [countdown, setCountdown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSubmit = async (values: { otp: string }) => {
    setLoading(true);
    try {
      // Update form data
      onUpdateFormData(values);

      // Validate OTP by attempting to reset password with a dummy password
      // This is just to validate the OTP, actual password reset happens in next step
      onNext();
    } catch (error: any) {
      notification.error({
        message: "Invalid OTP",
        description:
          error.response?.data?.message ||
          "The verification code you entered is invalid or has expired.",
        duration: 4,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResendLoading(true);
    try {
      // Call the appropriate forgot password API again
      if (formData.userType === "teacher") {
        await authService.teacherForgotPassword(formData.email);
      } else {
        await authService.studentForgotPassword(formData.email);
      }

      notification.success({
        message: "OTP Resent",
        description: "A new verification code has been sent to your email.",
        duration: 4,
      });

      setCountdown(60); // 60 seconds countdown
    } catch (error: any) {
      notification.error({
        message: "Error",
        description:
          error.response?.data?.message ||
          "Failed to resend verification code. Please try again.",
        duration: 4,
      });
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <SafetyOutlined className="text-2xl text-green-600" />
        </div>
        <Title level={4} className="!mb-2">
          Check Your Email
        </Title>
        <Text className="text-gray-600">
          We've sent a 6-digit verification code to
        </Text>
        <br />
        <Text strong className="text-blue-600">
          {formData.email}
        </Text>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          otp: formData.otp,
        }}
        requiredMark={false}
      >
        <Form.Item
          name="otp"
          label="Verification Code"
          rules={[
            { required: true, message: "Please enter the verification code" },
            { len: 6, message: "Verification code must be 6 digits" },
            { pattern: /^\d+$/, message: "Verification code must contain only numbers" },
          ]}
        >
          <Input
            size="large"
            placeholder="Enter 6-digit code"
            maxLength={6}
            className="text-center text-lg tracking-widest"
            autoComplete="one-time-code"
          />
        </Form.Item>

        <div className="text-center mb-4">
          <Text className="text-gray-500">
            Didn't receive the code?{" "}
          </Text>
          {countdown > 0 ? (
            <Text className="text-gray-400">
              <ClockCircleOutlined className="mr-1" />
              Resend in {countdown}s
            </Text>
          ) : (
            <Button
              type="link"
              onClick={handleResendOtp}
              loading={resendLoading}
              className="p-0 h-auto"
            >
              Resend Code
            </Button>
          )}
        </div>

        <Space direction="vertical" className="w-full">
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
          >
            Verify Code
          </Button>
          <Button size="large" onClick={onBack} block>
            Back
          </Button>
        </Space>
      </Form>
    </div>
  );
};

export default OtpStep;
