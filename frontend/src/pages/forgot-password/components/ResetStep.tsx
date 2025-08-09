import { Form, Input, Button, Typography, Space, App, Progress } from "antd";
import { LockOutlined, EyeInvisibleOutlined, EyeTwoTone } from "@ant-design/icons";
import { authService } from "@/services";
import type { ForgotPasswordState } from "../ForgotPassword";

const { Text, Title } = Typography;

interface ResetStepProps {
  formData: ForgotPasswordState;
  onNext: () => void;
  onBack: () => void;
  onUpdateFormData: (data: Partial<ForgotPasswordState>) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const ResetStep = ({
  formData,
  onNext,
  onBack,
  onUpdateFormData,
  loading,
  setLoading,
}: ResetStepProps) => {
  const [form] = Form.useForm();
  const { notification } = App.useApp();

  const getPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 6) strength += 25;
    if (password.length >= 8) strength += 25;
    if (/[A-Z]/.test(password)) strength += 25;
    if (/\d/.test(password)) strength += 25;
    return strength;
  };

  const getPasswordStrengthColor = (strength: number) => {
    if (strength < 50) return "#ff4d4f";
    if (strength < 75) return "#faad14";
    return "#52c41a";
  };

  const getPasswordStrengthText = (strength: number) => {
    if (strength < 50) return "Weak";
    if (strength < 75) return "Medium";
    return "Strong";
  };

  const handleSubmit = async (values: { newPassword: string; confirmPassword: string }) => {
    setLoading(true);
    try {
      // Update form data
      onUpdateFormData(values);

      // Call the appropriate reset password API
      const resetData = {
        email: formData.email,
        otp: formData.otp,
        newPassword: values.newPassword,
      };

      if (formData.userType === "teacher") {
        await authService.teacherResetPassword(resetData);
      } else {
        await authService.studentResetPassword(resetData);
      }

      notification.success({
        message: "Password Reset Successful",
        description: "Your password has been successfully reset.",
        duration: 4,
      });

      onNext();
    } catch (error: any) {
      notification.error({
        message: "Reset Failed",
        description:
          error.response?.data?.message ||
          "Failed to reset password. Please try again.",
        duration: 4,
      });
    } finally {
      setLoading(false);
    }
  };

  const watchPassword = Form.useWatch("newPassword", form);
  const passwordStrength = watchPassword ? getPasswordStrength(watchPassword) : 0;

  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <LockOutlined className="text-2xl text-purple-600" />
        </div>
        <Title level={4} className="!mb-2">
          Set New Password
        </Title>
        <Text className="text-gray-600">
          Create a strong password for your account
        </Text>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          newPassword: formData.newPassword,
          confirmPassword: formData.confirmPassword,
        }}
        requiredMark={false}
      >
        <Form.Item
          name="newPassword"
          label="New Password"
          rules={[
            { required: true, message: "Please enter your new password" },
            { min: 6, message: "Password must be at least 6 characters long" },
            {
              pattern: /\d/,
              message: "Password must contain at least one number",
            },
            {
              pattern: /[A-Z]/,
              message: "Password must contain at least one uppercase letter",
            },
          ]}
        >
          <Input.Password
            size="large"
            prefix={<LockOutlined />}
            placeholder="Enter new password"
            iconRender={(visible) =>
              visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
            }
          />
        </Form.Item>

        {watchPassword && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1">
              <Text className="text-sm text-gray-600">Password Strength</Text>
              <Text
                className="text-sm font-medium"
                style={{ color: getPasswordStrengthColor(passwordStrength) }}
              >
                {getPasswordStrengthText(passwordStrength)}
              </Text>
            </div>
            <Progress
              percent={passwordStrength}
              strokeColor={getPasswordStrengthColor(passwordStrength)}
              showInfo={false}
              size="small"
            />
          </div>
        )}

        <Form.Item
          name="confirmPassword"
          label="Confirm Password"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "Please confirm your new password" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("Passwords do not match"));
              },
            }),
          ]}
        >
          <Input.Password
            size="large"
            prefix={<LockOutlined />}
            placeholder="Confirm new password"
            iconRender={(visible) =>
              visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
            }
          />
        </Form.Item>

        <Space direction="vertical" className="w-full">
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
            className="mt-4"
          >
            Reset Password
          </Button>
          <Button size="large" onClick={onBack} block>
            Back
          </Button>
        </Space>
      </Form>
    </div>
  );
};

export default ResetStep;
