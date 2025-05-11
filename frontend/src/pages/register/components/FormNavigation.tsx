import React from 'react';
import { Button } from 'antd';

interface FormNavigationProps {
  currentStep: number;
  stepsLength: number;
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
  studentSignupMutation: any;
  teacherSignupMutation: any;
}

const FormNavigation: React.FC<FormNavigationProps> = ({
  currentStep,
  stepsLength,
  onPrev,
  onNext,
  loading,
  studentSignupMutation,
  teacherSignupMutation,
}) => {
  return (
    <div className="flex justify-between items-center">
      {currentStep > 0 && (
        <Button onClick={onPrev} size="large">
          Previous
        </Button>
      )}

      {currentStep < stepsLength - 1 && (
        <Button
          type="primary"
          onClick={onNext}
          size="large"
          className="ml-auto"
        >
          Next
        </Button>
      )}

      {currentStep === stepsLength - 1 && (
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
  );
};

export default FormNavigation;
