import React from "react";
import { Typography } from "antd";
import { LoginType } from "./LoginTypeSelector";

const { Title, Paragraph } = Typography;

interface InfoPanelProps {
  type: LoginType;
  className?: string;
}

const InfoPanel: React.FC<InfoPanelProps> = ({ type, className = "" }) => {
  const getContent = () => {
    switch (type) {
      case "student":
        return {
          title: "Welcome, Student!",
          description:
            "Access your courses, assignments, and learning resources. Track your progress and connect with teachers.",
          points: [
            "View enrolled courses and materials",
            "Submit assignments and check grades",
            "Communicate with teachers and peers",
            "Access learning resources and study materials",
          ],
        };
      case "teacher":
        return {
          title: "Welcome, Teacher!",
          description:
            "Manage your courses, students, and teaching materials. Create assignments and track student progress.",
          points: [
            "Manage course content and materials",
            "Create and grade assignments",
            "Track student progress and performance",
            "Communicate with students and colleagues",
          ],
        };
      case "admin":
        return {
          title: "Welcome, Administrator!",
          description:
            "Manage the entire platform, including users, courses, and departments. Monitor system performance.",
          points: [
            "Manage users, courses, and departments",
            "Monitor system performance and usage",
            "Configure system settings and permissions",
            "Generate reports and analytics",
          ],
        };
    }
  };

  const content = getContent();

  return (
    <div className={`p-8 text-white ${className}`}>
      <Title level={1} className="text-white mb-4">
        {content.title}
      </Title>
      <Paragraph className="text-white text-2xl mb-6">
        {content.description}
      </Paragraph>
      <ul className="space-y-2">
        {content.points.map((point, index) => (
          <li key={index} className="flex items-start text-lg">
            <span className="mr-2 text-blue-300">•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default InfoPanel;
