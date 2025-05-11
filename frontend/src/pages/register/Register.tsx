import { useState } from "react";
import { Form, Typography, Card, Steps, Row, Col, Divider, App } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/common/constants";
import { useAuthQuery } from "@/hooks";
import { useDepartmentContext } from "@/context/DepartmentContext";
import {
  UserType,
  handleRegistration,
  handleNext,
  handlePrev,
  handleUserTypeChange,
} from "./utils";
import {
  BasicInfoStep,
  AccountDetailsStep,
  FormNavigation,
} from "./components";

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;

const Register = () => {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [userType, setUserType] = useState<UserType>("student");
  const navigate = useNavigate();

  const { notification } = App.useApp();

  // Get mutations from hooks
  const { studentSignupMutation, teacherSignupMutation } = useAuthQuery();

  // Get departments from context
  const {
    departmentOptions,
    loading: fetchingDepartments,
    refreshDepartments,
  } = useDepartmentContext();

  const onFinish = async (values: any) => {
    await handleRegistration({
      values,
      userType,
      form,
      notification,
      navigate,
      studentSignupMutation,
      teacherSignupMutation,
      setLoading,
    });
  };

  const steps = [
    {
      title: "Basic Info",
      content: (
        <BasicInfoStep
          handleUserTypeChange={(e) =>
            handleUserTypeChange(e, setUserType, form, currentStep)
          }
        />
      ),
    },
    {
      title: "Account Details",
      content: (
        <AccountDetailsStep
          userType={userType}
          departmentOptions={departmentOptions}
          fetchingDepartments={fetchingDepartments}
          refreshDepartments={refreshDepartments}
        />
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
              <FormNavigation
                currentStep={currentStep}
                stepsLength={steps.length}
                onPrev={() => handlePrev(currentStep, setCurrentStep)}
                onNext={() =>
                  handleNext(currentStep, setCurrentStep, form, userType)
                }
                loading={loading}
                studentSignupMutation={studentSignupMutation}
                teacherSignupMutation={teacherSignupMutation}
              />
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
