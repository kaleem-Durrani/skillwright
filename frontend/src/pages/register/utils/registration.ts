import { z } from "zod";
import { StudentSignupData, TeacherSignupData } from "@/common/types/auth.types";
import { ROUTES } from "@/common/constants";
import { NavigateFunction } from "react-router-dom";
import { NotificationInstance } from "antd/es/notification/interface";
import { studentSchema, teacherSchema, UserType } from "./schemas";
import { FormInstance } from 'antd/es/form/Form';


interface RegistrationParams {
  values: any;
  userType: UserType;
  form: FormInstance;
  notification: NotificationInstance;
  navigate: NavigateFunction;
  studentSignupMutation: any;
  teacherSignupMutation: any;
  setLoading: (loading: boolean) => void;
}

export const handleRegistration = async ({
  values,
  userType,
  form,
  notification,
  navigate,
  studentSignupMutation,
  teacherSignupMutation,
  setLoading,
}: RegistrationParams) => {
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
