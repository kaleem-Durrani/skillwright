import React, { useState, useRef, useEffect } from "react";
import { LoginType } from "./components/LoginTypeSelector";
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

  // Handle login type change
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
        return (
          <StudentLogin
            key="student-login"
            className="h-full"
            onTypeChange={handleLoginTypeChange}
          />
        );
      case "teacher":
        return (
          <TeacherLogin
            key="teacher-login"
            className="h-full"
            onTypeChange={handleLoginTypeChange}
          />
        );
      case "admin":
        return (
          <AdminLogin
            key="admin-login"
            className="h-full"
            onTypeChange={handleLoginTypeChange}
          />
        );
    }
  };

  // Get background gradient based on login type
  const getGradient = () => {
    switch (loginType) {
      case "student":
        return "from-blue-600/80 to-purple-600/20";
      case "teacher":
        return "from-green-600/80 to-teal-600/20";
      case "admin":
        return "from-indigo-600/80 to-blue-800/20";
    }
  };

  return (
    <div className="flex items-center justify-center w-full h-full py-4">
      <div className="w-full h-auto overflow-clip flex flex-col lg:flex-row items-stretch justify-between gap-6 lg:gap-10">
        <div
          ref={panelRef}
          className={`login-panel  login-panel-${loginType} w-full lg:w-5/12 h-auto lg:h-[600px] bg-gradient-to-br ${getGradient()} rounded-2xl lg:rounded-l-none backdrop-blur-md border border-white/20 shadow-xl overflow-hidden`}
        >
          <InfoPanel
            key={`info-panel-${loginType}`}
            type={loginType}
            className="h-full"
          />
        </div>

        <div
          ref={formRef}
          className={`login-form login-form-${loginType} w-full lg:w-5/12 h-auto lg:h-[600px] bg-white/50 backdrop-blur-md rounded-2xl lg:rounded-r-none border border-white/20 shadow-xl overflow-auto`}
        >
          {getLoginComponent()}
        </div>
      </div>
    </div>
  );
};

export default Login;
