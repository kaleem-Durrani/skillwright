import { useState } from "react";
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
  Radio,
  Spin,
  Empty,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  LockOutlined,
  IdcardOutlined,
  PhoneOutlined,
  BookOutlined,
  ApartmentOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import { useAuthQuery } from "@/hooks";
import { useDepartmentContext } from "@/context/DepartmentContext";
import { z } from "zod";
import { StudentSignupData, TeacherSignupData } from "@/common/types";

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;

// Define base schema for validation
const baseSchema = {
  name: z.string().min(3, "Name must be at least 3 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .regex(/\d/, "Password must contain at least one number")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter"),
  confirmPassword: z.string(),
  departmentId: z.string().min(1, "Please select a department"),
  phoneNumber: z.string().optional(),
};

// Student schema
const studentSchema = z
  .object({
    ...baseSchema,
    enrollmentNo: z.string().min(1, "Enrollment number is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Teacher schema
const teacherSchema = z
  .object({
    ...baseSchema,
    qualification: z.string().min(1, "Qualification is required"),
    specialization: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type UserType = "student" | "teacher";

const Register = () => {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [userType, setUserType] = useState<UserType>("student");
  const navigate = useNavigate();

  // Get mutations from hooks
  const { studentSignupMutation, teacherSignupMutation } = useAuthQuery();

  // Get departments from context
  const {
    departmentOptions,
    loading: fetchingDepartments,
    refreshDepartments,
  } = useDepartmentContext();

  const onFinish = async (values: StudentSignupData | TeacherSignupData) => {
    console.log("running registeration function");
    console.log(values);
    console.log(userType);
    try {
      // Get all form values including those from the first step
      const allFormValues = form.getFieldsValue(true);
      console.log("All form values:", allFormValues);

      // Validate with Zod before submitting
      try {
        if (userType === "student") {
          studentSchema.parse(allFormValues);
        } else {
          teacherSchema.parse(allFormValues);
        }
      } catch (zodError) {
        console.log("zod error");
        console.log(zodError);
        if (zodError instanceof z.ZodError) {
          // Format and display Zod validation errors
          const errorMessages = zodError.errors
            .map((err) => `${err.path.join(".")}: ${err.message}`)
            .join(", ");

          notification.error({
            message: "Validation Error",
            description: errorMessages,
          });
          return;
        }
      }

      console.log("zod validation finished");

      setLoading(true);

      // Remove confirmPassword as it's not needed in the API
      const {
        confirmPassword,
        userType: formUserType,
        ...registrationData
      } = allFormValues;

      let response;

      if (userType === "student") {
        response = await studentSignupMutation.mutateAsync(
          registrationData as StudentSignupData
        );
      } else {
        response = await teacherSignupMutation.mutateAsync(
          registrationData as TeacherSignupData
        );
      }

      console.log(response);

      if (response?.data?.success) {
        // Store user data in localStorage
        const userData = response.data.data;
        localStorage.setItem("user", JSON.stringify(userData));

        // Show success notification
        notification.success({
          message: "Registration Successful",
          description: "Please verify your email to continue",
        });

        // Redirect to verification page
        navigate(ROUTES.VERIFY_EMAIL);
      }
    } catch (error: any) {
      console.error("Registration error:", error);

      // Handle different types of errors
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error("Error response data:", error.response.data);
        console.error("Error response status:", error.response.status);

        notification.error({
          message: "Registration Failed",
          description:
            error.response.data?.message ||
            "Server error. Please try again later.",
          duration: 5, // Show for 5 seconds
        });
      } else if (error.request) {
        // The request was made but no response was received
        console.error("Error request:", error.request);

        notification.error({
          message: "Network Error",
          description: "No response from server. Please check your connection.",
          duration: 5,
        });
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error("Error message:", error.message);

        notification.error({
          message: "Registration Failed",
          description: error.message || "An unexpected error occurred.",
          duration: 5,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const next = async () => {
    try {
      // Validate the current step fields before moving to the next step
      if (currentStep === 0) {
        await form.validateFields(["userType", "name", "email"]);
      } else {
        const fieldsToValidate = [
          "password",
          "confirmPassword",
          "departmentId",
          "phoneNumber",
        ];

        // Add user type specific fields
        if (userType === "student") {
          fieldsToValidate.push("enrollmentNo");
        } else {
          fieldsToValidate.push("qualification");
          fieldsToValidate.push("specialization");
        }

        await form.validateFields(fieldsToValidate);
      }

      setCurrentStep(currentStep + 1);
    } catch (error) {
      // Form validation failed
      console.error("Validation failed:", error);
    }
  };

  const prev = () => {
    setCurrentStep(currentStep - 1);
  };

  const handleUserTypeChange = (e: any) => {
    setUserType(e.target.value);
    // Reset form fields that are specific to user type
    if (currentStep === 1) {
      if (e.target.value === "student") {
        form.setFieldsValue({
          qualification: undefined,
          specialization: undefined,
        });
      } else {
        form.setFieldsValue({
          enrollmentNo: undefined,
        });
      }
    }
  };

  const steps = [
    {
      title: "Basic Info",
      content: (
        <>
          <Form.Item
            name="userType"
            initialValue="student"
            rules={[{ required: true, message: "Please select user type" }]}
          >
            <Radio.Group
              onChange={handleUserTypeChange}
              buttonStyle="solid"
              className="w-full flex mb-6"
            >
              <Radio.Button value="student" className="w-1/2 text-center">
                Student
              </Radio.Button>
              <Radio.Button value="teacher" className="w-1/2 text-center">
                Teacher
              </Radio.Button>
            </Radio.Group>
          </Form.Item>

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
            name="departmentId"
            rules={[
              { required: true, message: "Please select your department" },
            ]}
          >
            <Select
              placeholder="Select Department"
              size="large"
              loading={fetchingDepartments}
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
      ),
    },
  ];

  return (
    <Row className="h-full py-12">
      <Col xs={24} sm={22} md={20} lg={16} xl={14} xxl={12} className="mx-auto">
        <Card className="shadow-md bg-white/40 backdrop-blur-md border border-white/20">
          <Title level={2} className="mb-6 text-center text-blue-700">
            {userType === "student" ? "Student" : "Teacher"} Registration
          </Title>

          <Paragraph className="text-center mb-8">
            {userType === "student"
              ? "Register to access courses, resources, and connect with teachers"
              : "Register to create courses, share resources, and connect with students"}
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
                    key="submit"
                    type="primary"
                    htmlType="submit"
                    size="large"
                    loading={
                      loading ||
                      studentSignupMutation.isPending ||
                      teacherSignupMutation.isPending
                    }
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
