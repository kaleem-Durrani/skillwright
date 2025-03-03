import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

import authAdminRouter from "./routes/auth.adminRoutes.js";
import authStudentRouter from "./routes/auth.studentRoutes.js";
import authTeacherRouter from "./routes/auth.teacherRoutes.js";
import authRefreshRouter from "./routes/auth.refreshRoutes.js";

import adminRouter from "./routes/admin.routes.js";
import studentRouter from "./routes/student.routes.js";
import teacherRouter from "./routes/teacher.routes.js";

import departmentRouter from "./routes/department.routes.js";
import courseRouter from "./routes/course.routes.js";
import resourceRouter from "./routes/resource.routes.js";
import newsRouter from "./routes/news.routes.js";
import conversationRouter from "./routes/conversation.routes.js";

dotenv.config();

const app = express();

app.use(express.json());
// app.use(express.urlencoded({extended:true}));
app.use(cookieParser());

// app.use(cors());

app.use("/api/auth/admin", authAdminRouter);
app.use("/api/auth/student", authStudentRouter);
app.use("/api/auth/teacher", authTeacherRouter);
app.use("/api/auth/refresh", authRefreshRouter);

app.use("/api/admin", adminRouter);
app.use("/api/student", studentRouter);
app.use("/api/teacher", teacherRouter);

app.use("/api/department", departmentRouter);
app.use("/api/course", courseRouter);
app.use("/api/resource", resourceRouter);
app.use("/api/news", newsRouter);
app.use("/api/conversations", conversationRouter);

app.get("/", (req, res) => {
	res.send("Hello World");
});

app.use(notFound);
app.use(errorHandler);

app.listen(process.env.PORT, () => {
	console.log(`Server is running on port ${process.env.PORT}`);
});
