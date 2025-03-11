import { BrowserRouter } from "react-router-dom";
import Router from "./router";
import { App as AntdApp } from "antd";
import { ThemeProvider } from "./context/ThemeContext";

const App = () => {
  return (
    <ThemeProvider>
      <AntdApp message={{ maxCount: 2 }} notification={{ maxCount: 2 }}>
        <BrowserRouter>
          <Router />
        </BrowserRouter>
      </AntdApp>
    </ThemeProvider>
  );
};

export default App;
