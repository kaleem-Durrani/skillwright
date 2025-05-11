import { FormInstance } from "antd";
import { UserType } from "./schemas";

export const handleNext = async (
  currentStep: number,
  setCurrentStep: (step: number) => void,
  form: FormInstance,
  userType: UserType
) => {
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

export const handlePrev = (
  currentStep: number,
  setCurrentStep: (step: number) => void
) => {
  setCurrentStep(currentStep - 1);
};

export const handleUserTypeChange = (
  e: any,
  setUserType: (userType: UserType) => void,
  form: FormInstance,
  currentStep: number
) => {
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
