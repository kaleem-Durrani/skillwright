import React, { useState, useRef, useEffect } from "react";
import LoginTypeSelector, { LoginType } from "./components/LoginTypeSelector";
import {
  StudentLogin,
  TeacherLogin,
  AdminLogin,
  InfoPanel,
} from "./components";
import "./styles.css";

const Login: React.FC = () => {
  const [loginType, setLoginType] = useState<LoginType>("student");
  const [prevLoginType, setPrevLoginType] = useState<LoginType | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Reset animation classes when animation completes
  useEffect(() => {
    const resetAnimationClasses = () => {
      if (panelRef.current) {
        panelRef.current.classList.remove("exit-left");
      }
      if (formRef.current) {
        formRef.current.classList.remove("exit-right");
      }
    };

    if (!isAnimating && prevLoginType === null) {
      resetAnimationClasses();
    }
  }, [isAnimating, prevLoginType]);

  // Handle login type change with animation
  const handleLoginTypeChange = (type: LoginType) => {
    if (type !== loginType && !isAnimating) {
      setIsAnimating(true);
      setPrevLoginType(loginType);

      // Add exit animation classes
      if (panelRef.current) {
        panelRef.current.classList.add("exit-left");
      }

      if (formRef.current) {
        formRef.current.classList.add("exit-right");
      }

      // Wait for exit animation to complete before changing type
      setTimeout(() => {
        setLoginType(type);
      }, 300);

      // Reset animation state after animation completes
      setTimeout(() => {
        setIsAnimating(false);
        setPrevLoginType(null);
      }, 900);
    }
  };

  // Get the appropriate login component based on type
  const getLoginComponent = () => {
    switch (loginType) {
      case "student":
        return <StudentLogin key="student-login" className="h-full" />;
      case "teacher":
        return <TeacherLogin key="teacher-login" className="h-full" />;
      case "admin":
        return <AdminLogin key="admin-login" className="h-full" />;
    }
  };

  // Get background gradient based on login type
  const getGradient = () => {
    switch (loginType) {
      case "student":
        return "from-blue-600 to-purple-600";
      case "teacher":
        return "from-green-600 to-teal-600";
      case "admin":
        return "from-indigo-600 to-blue-800";
    }
  };

  return (
    <div className=" flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        <LoginTypeSelector
          selectedType={loginType}
          onChange={handleLoginTypeChange}
        />

        <div className="flex flex-col lg:flex-row w-full rounded-xl overflow-hidden">
          <div
            ref={panelRef}
            className={`login-panel login-panel-${loginType} w-full lg:w-1/2 bg-gradient-to-br ${getGradient()} rounded-t-xl lg:rounded-tr-none lg:rounded-l-xl`}
          >
            <InfoPanel
              key={`info-panel-${loginType}`}
              type={loginType}
              className="h-full"
            />
          </div>

          <div
            ref={formRef}
            className={`login-form login-form-${loginType} w-full lg:w-1/2 bg-white rounded-b-xl lg:rounded-bl-none lg:rounded-r-xl`}
          >
            {getLoginComponent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
