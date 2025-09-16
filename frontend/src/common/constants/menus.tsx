import {
  DashboardOutlined,
  BookOutlined,
  TeamOutlined,
  UserOutlined,
  FileTextOutlined,
  BankOutlined,
  NotificationOutlined,
  MessageOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import { ROUTES } from "./routes";
import { MenuProps } from "antd";

type MenuItem = Required<MenuProps>["items"][number];

// Student Menu Items
export const STUDENT_MENU_ITEMS: MenuItem[] = [
  {
    key: ROUTES.STUDENT.DASHBOARD,
    icon: <DashboardOutlined />,
    label: "Dashboard",
  },
  {
    key: ROUTES.STUDENT.COURSES,
    icon: <BookOutlined />,
    label: "My Courses",
  },
  {
    key: ROUTES.STUDENT.RESOURCES,
    icon: <FileTextOutlined />,
    label: "Resources",
  },
  {
    key: ROUTES.STUDENT.CONVERSATIONS,
    icon: <MessageOutlined />,
    label: "Messages",
  },
  {
    key: ROUTES.STUDENT.PROFILE,
    icon: <UserOutlined />,
    label: "Profile",
  },
];

// Teacher Menu Items
export const TEACHER_MENU_ITEMS: MenuItem[] = [
  {
    key: ROUTES.TEACHER.DASHBOARD,
    icon: <DashboardOutlined />,
    label: "Dashboard",
  },
  {
    key: ROUTES.TEACHER.COURSES,
    icon: <BookOutlined />,
    label: "My Courses",
  },
  {
    key: ROUTES.TEACHER.RESOURCES,
    icon: <FileTextOutlined />,
    label: "Resources",
  },
  {
    key: ROUTES.TEACHER.CONVERSATIONS,
    icon: <MessageOutlined />,
    label: "Messages",
  },
  {
    key: ROUTES.TEACHER.PROFILE,
    icon: <UserOutlined />,
    label: "Profile",
  },
];

// Admin Menu Items
export const ADMIN_MENU_ITEMS: MenuItem[] = [
  {
    key: ROUTES.ADMIN.DASHBOARD,
    icon: <DashboardOutlined />,
    label: "Dashboard",
  },
  {
    key: ROUTES.ADMIN.TEACHERS,
    icon: <SolutionOutlined />,
    label: "Teachers",
  },
  {
    key: ROUTES.ADMIN.STUDENTS,
    icon: <TeamOutlined />,
    label: "Students",
  },
  {
    key: ROUTES.ADMIN.DEPARTMENTS,
    icon: <BankOutlined />,
    label: "Departments",
  },
  {
    key: ROUTES.ADMIN.NEWS_EVENTS,
    icon: <NotificationOutlined />,
    label: "News & Events",
  },
  // {
  //   key: ROUTES.ADMIN.CONVERSATIONS,
  //   icon: <MessageOutlined />,
  //   label: "Messages",
  // },
  {
    key: ROUTES.ADMIN.PROFILE,
    icon: <UserOutlined />,
    label: "Profile",
  },
];

// Function to get menu items based on user type
export const getMenuItemsByUserType = (
  userType: "student" | "teacher" | "admin"
) => {
  switch (userType) {
    case "student":
      return STUDENT_MENU_ITEMS;
    case "teacher":
      return TEACHER_MENU_ITEMS;
    case "admin":
      return ADMIN_MENU_ITEMS;
    default:
      return [];
  }
};
