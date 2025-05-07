import { useState, useEffect } from "react";
import {
  Form,
  Input,
  Button,
  Typography,
  Card,
  notification,
  Row,
  Col,
  Divider,
  Result,
} from "antd";
import {
  MailOutlined,
  KeyOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import { useAuthQuery } from "@/hooks";

const { Title, Text, Paragraph } = Typography;

const VerifyEmail = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userType, setUserType] = useState<"student" | "teacher" | null>(null);
  const navigate = useNavigate();

  // Get mutations from hooks
  const {
    studentVerifyOtpMutation,
    teacherVerifyOtpMutation,
    studentResendOtpMutation,
    teacherResendOtpMutation,
  } = useAuthQuery();

  // Get user data from localStorage
  useEffect(() => {
    const userData = localStorage.getItem("user")
      ? JSON.parse(localStorage.getItem("user") || "{}")
      : null;

    if (userData) {
      setUserEmail(userData.email || "");
      setUserType(userData.userType === "admin" ? null : userData.userType);
      form.setFieldsValue({ email: userData.email || "" });

      // If user is already verified or is admin, redirect to dashboard
      if (userData.isVerified || userData.userType === "admin") {
        const dashboardRoute =
          userData.userType === "admin"
            ? ROUTES.ADMIN.DASHBOARD
            : userData.userType === "teacher"
            ? ROUTES.TEACHER.DASHBOARD
            : ROUTES.STUDENT.DASHBOARD;
        navigate(dashboardRoute);
      }
    } else {
      // If no user data, redirect to login
      navigate(ROUTES.LOGIN);
    }
  }, [form, navigate]);

  const onFinish = async (values: { email: string; otp: string }) => {
    if (!userType) {
      notification.error({
        message: "Verification Error",
        description: "User type not found. Please log in again.",
      });
      return;
    }

    try {
      setLoading(true);
      const mutation =
        userType === "student"
          ? studentVerifyOtpMutation
          : teacherVerifyOtpMutation;
      const response = await mutation.mutateAsync(values);

      if (response?.data?.success) {
        // Update user data in localStorage to mark as verified
        const userData = JSON.parse(localStorage.getItem("user") || "{}");
        userData.isVerified = true;
        localStorage.setItem("user", JSON.stringify(userData));

        // Show success notification
        notification.success({
          message: "Email Verified",
          description: "Your email has been successfully verified.",
        });

        setVerified(true);

        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
          const dashboardRoute =
            userType === "teacher"
              ? ROUTES.TEACHER.DASHBOARD
              : ROUTES.STUDENT.DASHBOARD;
          navigate(dashboardRoute);
        }, 3000);
      }
    } catch (error: any) {
      notification.error({
        message: "Verification Failed",
        description:
          error?.response?.data?.message ||
          "Please check your OTP and try again",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!userEmail || !userType) {
      notification.error({
        message: "Resend Failed",
        description: "Email or user type not found. Please log in again.",
      });
      return;
    }

    try {
      setResendLoading(true);
      const mutation =
        userType === "student"
          ? studentResendOtpMutation
          : teacherResendOtpMutation;
      const response = await mutation.mutateAsync(userEmail);

      if (response?.data?.success) {
        notification.success({
          message: "OTP Resent",
          description: "A new verification code has been sent to your email.",
        });
      }
    } catch (error: any) {
      notification.error({
        message: "Resend Failed",
        description:
          error?.response?.data?.message ||
          "Failed to resend verification code",
      });
    } finally {
      setResendLoading(false);
    }
  };

  if (verified) {
    return (
      <Row className="h-full py-12">
        <Col
          xs={22}
          sm={20}
          md={16}
          lg={12}
          xl={10}
          xxl={8}
          className="mx-auto"
        >
          <Result
            status="success"
            icon={<CheckCircleOutlined className="text-green-500" />}
            title="Email Verified Successfully!"
            subTitle="You will be redirected to your dashboard in a moment..."
            extra={[
              <Button
                type="primary"
                key="dashboard"
                onClick={() => {
                  const dashboardRoute =
                    userType === "teacher"
                      ? ROUTES.TEACHER.DASHBOARD
                      : ROUTES.STUDENT.DASHBOARD;
                  navigate(dashboardRoute);
                }}
              >
                Go to Dashboard
              </Button>,
            ]}
          />
        </Col>
      </Row>
    );
  }

  return (
    <Row className="h-full py-12">
      <Col xs={22} sm={20} md={16} lg={12} xl={10} xxl={8} className="mx-auto">
        <Card className="shadow-md bg-white/40 backdrop-blur-md border border-white/20">
          <Title level={2} className="mb-4 text-center text-blue-700">
            Verify Your Email
          </Title>

          <Paragraph className="text-center mb-8">
            We've sent a verification code to your email address. Please enter
            the code below to verify your account.
          </Paragraph>

          <Form
            form={form}
            name="verify_email"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
            className="max-w-md mx-auto"
          >
            <Form.Item
              name="email"
              rules={[
                { required: true, message: "Please enter your email" },
                {
                  type: "email",
                  message: "Please enter a valid email address",
                },
              ]}
            >
              <Input
                prefix={<MailOutlined className="site-form-item-icon" />}
                placeholder="Email"
                size="large"
                disabled={!!userEmail}
              />
            </Form.Item>

            <Form.Item
              name="otp"
              rules={[
                {
                  required: true,
                  message: "Please enter the verification code",
                },
              ]}
            >
              <Input
                prefix={<KeyOutlined className="site-form-item-icon" />}
                placeholder="Verification Code"
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={loading}
                className="w-full"
              >
                Verify Email
              </Button>
            </Form.Item>
          </Form>

          <Divider>
            <Text type="secondary">Didn't receive the code?</Text>
          </Divider>

          <div className="text-center">
            <Button
              type="link"
              onClick={handleResendOtp}
              loading={resendLoading}
              className="text-blue-600 hover:text-blue-800"
            >
              Resend Verification Code
            </Button>
          </div>
        </Card>
      </Col>
    </Row>
  );
};

export default VerifyEmail;
