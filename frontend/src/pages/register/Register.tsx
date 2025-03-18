import { useState, useEffect } from "react";
import {
  Form,
  Input,
  Button,
  Typography,
  Card,
  Steps,
  Select,
  notification,
  Row,
  Col,
  Divider,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  LockOutlined,
  IdcardOutlined,
  PhoneOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import { departmentApi } from "@/api/department.api";
import { Department, StudentSignupData } from "@/common/types";

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;
const { Option } = Select;

const Register = () => {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [fetchingDepartments, setFetchingDepartments] = useState(false);
  const navigate = useNavigate();

  // Fetch departments on component mount
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        setFetchingDepartments(true);
        // Using 'any' type to handle potential type mismatches between frontend and backend
        const response = await departmentApi.getAllDepartments();

        if (response?.data?.data) {
          // The response could be an array or a paginated structure
          // Handle both possibilities
          const departmentsData = Array.isArray(response.data.data)
            ? response.data.data
            : (response.data.data as any).items || [];

          setDepartments(departmentsData);
        }
      } catch (error) {
        notification.error({
          message: "Failed to fetch departments",
          description: "Please try again later",
        });
      } finally {
        setFetchingDepartments(false);
      }
    };

    fetchDepartments();
  }, []);

  const onFinish = async (values: StudentSignupData) => {
    try {
      setLoading(true);
      // API call would go here
      console.log("Registration values:", values);

      // Show success notification
      notification.success({
        message: "Registration Successful",
        description: "Please check your email for verification instructions",
      });

      // Redirect to verification page or login page
      navigate(ROUTES.VERIFY_EMAIL);
    } catch (error) {
      notification.error({
        message: "Registration Failed",
        description: "Please check your information and try again",
      });
    } finally {
      setLoading(false);
    }
  };

  const next = async () => {
    try {
      // Validate the current step fields before moving to the next step
      await form.validateFields(
        currentStep === 0
          ? ["name", "email"]
          : [
              "password",
              "confirmPassword",
              "enrollmentNo",
              "departmentId",
              "phoneNumber",
            ]
      );

      setCurrentStep(currentStep + 1);
    } catch (error) {
      // Form validation failed
      console.error("Validation failed:", error);
    }
  };

  const prev = () => {
    setCurrentStep(currentStep - 1);
  };

  const steps = [
    {
      title: "Basic Info",
      content: (
        <>
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Please enter your full name" }]}
          >
            <Input
              prefix={<UserOutlined className="site-form-item-icon" />}
              placeholder="Full Name"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="email"
            rules={[
              { required: true, message: "Please enter your email" },
              { type: "email", message: "Please enter a valid email address" },
            ]}
          >
            <Input
              prefix={<MailOutlined className="site-form-item-icon" />}
              placeholder="Email"
              size="large"
            />
          </Form.Item>
        </>
      ),
    },
    {
      title: "Account Details",
      content: (
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
            >
              {departments.map((department) => (
                <Option key={department.id} value={department.id}>
                  {department.name}
                </Option>
              ))}
            </Select>
          </Form.Item>

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
      ),
    },
  ];

  return (
    <Row className="h-full py-12">
      <Col xs={24} sm={22} md={20} lg={16} xl={14} xxl={12} className="mx-auto">
        <Card className="shadow-md bg-white/40 backdrop-blur-md border border-white/20">
          <Title level={2} className="mb-6 text-center text-blue-700">
            Student Registration
          </Title>

          <Paragraph className="text-center mb-8">
            Register to access courses, resources, and connect with teachers
          </Paragraph>

          <Steps current={currentStep} className="mb-8">
            {steps.map((item) => (
              <Step key={item.title} title={item.title} />
            ))}
          </Steps>

          <Form
            form={form}
            name="register"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
            scrollToFirstError
            className="max-w-lg mx-auto"
          >
            {steps[currentStep].content}

            <Form.Item className="mt-8">
              <div className="flex justify-between items-center">
                {currentStep > 0 && (
                  <Button onClick={prev} size="large">
                    Previous
                  </Button>
                )}

                {currentStep < steps.length - 1 && (
                  <Button
                    type="primary"
                    onClick={next}
                    size="large"
                    className="ml-auto"
                  >
                    Next
                  </Button>
                )}

                {currentStep === steps.length - 1 && (
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    loading={loading}
                    className="ml-auto"
                  >
                    Register
                  </Button>
                )}
              </div>
            </Form.Item>
          </Form>

          <Divider />

          <div className="text-center">
            <Text>Already have an account?</Text>{" "}
            <Link
              to={ROUTES.LOGIN}
              className="text-blue-600 hover:text-blue-800"
            >
              Login here
            </Link>
          </div>
        </Card>
      </Col>
    </Row>
  );
};

export default Register;
