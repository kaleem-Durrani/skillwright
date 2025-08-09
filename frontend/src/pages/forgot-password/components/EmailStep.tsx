import { Form, Input, Button, Select, Typography, Space, App } from "antd";
import { MailOutlined, UserOutlined } from "@ant-design/icons";
import { authService } from "@/services";
import type { ForgotPasswordState, UserType } from "../ForgotPassword";

const { Text } = Typography;
const { Option } = Select;

interface EmailStepProps {
  formData: ForgotPasswordState;
  onNext: () => void;
  onUpdateFormData: (data: Partial<ForgotPasswordState>) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const EmailStep = ({
  formData,
  onNext,
  onUpdateFormData,
  loading,
  setLoading,
}: EmailStepProps) => {
  const [form] = Form.useForm();
  const { notification } = App.useApp();

  const handleSubmit = async (values: { email: string; userType: UserType }) => {
    setLoading(true);
    try {
      // Update form data
      onUpdateFormData(values);

      // Call the appropriate forgot password API
      if (values.userType === "teacher") {
        await authService.teacherForgotPassword(values.email);
      } else {
        await authService.studentForgotPassword(values.email);
      }

      notification.success({
        message: "OTP Sent",
        description: "A verification code has been sent to your email address.",
        duration: 4,
      });

      onNext();
    } catch (error: any) {
      notification.error({
        message: "Error",
        description:
          error.response?.data?.message ||
          "Failed to send verification code. Please try again.",
        duration: 4,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <MailOutlined className="text-2xl text-blue-600" />
        </div>
        <Text className="text-gray-600">
          Enter your email address and select your account type to receive a
          verification code.
        </Text>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          email: formData.email,
          userType: formData.userType,
        }}
        requiredMark={false}
      >
        <Form.Item
          name="userType"
          label="Account Type"
          rules={[{ required: true, message: "Please select your account type" }]}
        >
          <Select
            size="large"
            placeholder="Select your account type"
            suffixIcon={<UserOutlined />}
          >
            <Option value="student">Student</Option>
            <Option value="teacher">Teacher</Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="email"
          label="Email Address"
          rules={[
            { required: true, message: "Please enter your email address" },
            { type: "email", message: "Please enter a valid email address" },
          ]}
        >
          <Input
            size="large"
            prefix={<MailOutlined />}
            placeholder="Enter your email address"
            autoComplete="email"
          />
        </Form.Item>

        <Form.Item className="mb-0">
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
            className="mt-4"
          >
            Send Verification Code
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default EmailStep;
