import { BrowserRouter } from "react-router-dom";
import Router from "./router";
import { App as AntdApp } from "antd";
import { ThemeProvider } from "./context/ThemeContext";
import { DepartmentProvider } from "./context/DepartmentContext";
import { AuthProvider } from "./context/AuthContext";

const App = () => {
  return (
    <ThemeProvider>
      <AntdApp message={{ maxCount: 2 }} notification={{ maxCount: 2 }}>
        <AuthProvider>
          <DepartmentProvider>
            <BrowserRouter>
              <Router />
            </BrowserRouter>
          </DepartmentProvider>
        </AuthProvider>
      </AntdApp>
    </ThemeProvider>
  );
};

export default App;
