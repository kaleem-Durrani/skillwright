import { BrowserRouter } from "react-router-dom";
import Router from "./router";
import { App as AntdApp } from "antd";
import { ThemeProvider } from "./context/ThemeContext";
import { DepartmentProvider } from "./context/DepartmentContext";

const App = () => {
  return (
    <ThemeProvider>
      <AntdApp message={{ maxCount: 2 }} notification={{ maxCount: 2 }}>
        <DepartmentProvider>
          <BrowserRouter>
            <Router />
          </BrowserRouter>
        </DepartmentProvider>
      </AntdApp>
    </ThemeProvider>
  );
};

export default App;
