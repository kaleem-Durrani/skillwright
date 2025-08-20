import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createServer } from "http";
import { setupWebSocket } from "./websocket/socketHandler.js";

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

app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
	next();
  });

app.use(cors({
	origin: "http://localhost:5173",
	credentials: true,
}));

app.use("/api/auth/admin", authAdminRouter);
app.use("/api/auth/student", authStudentRouter);
app.use("/api/auth/teacher", authTeacherRouter);
app.use("/api/auth/refresh", authRefreshRouter);

app.use("/api/admin", adminRouter);
app.use("/api/student", studentRouter);
app.use("/api/teacher", teacherRouter);

app.use("/api/departments", departmentRouter);
app.use("/api/course", courseRouter);
app.use("/api/resource", resourceRouter);
app.use("/api/news", newsRouter);
app.use("/api/conversations", conversationRouter);

app.get("/", (req, res) => {
	res.send("Hello World");
});

app.use(notFound);
app.use(errorHandler);

// Create HTTP server and setup WebSocket
const server = createServer(app);
const io = setupWebSocket(server);

// Make io available globally for broadcasting messages
app.set('io', io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
	console.log(`WebSocket server is ready for real-time messaging`);
});

// Handle server errors
server.on('error', (error: any) => {
	if (error.code === 'EADDRINUSE') {
		console.error(`Port ${PORT} is already in use. Please:`);
		console.error('1. Stop any other processes using this port');
		console.error('2. Or change the PORT in your .env file');
		console.error('3. Or kill the process using: npx kill-port 5000');
		process.exit(1);
	} else {
		console.error('Server error:', error);
		process.exit(1);
	}
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('SIGTERM received, shutting down gracefully');
	server.close(() => {
		console.log('Server closed');
		process.exit(0);
	});
});

process.on('SIGINT', () => {
	console.log('SIGINT received, shutting down gracefully');
	server.close(() => {
		console.log('Server closed');
		process.exit(0);
	});
});
