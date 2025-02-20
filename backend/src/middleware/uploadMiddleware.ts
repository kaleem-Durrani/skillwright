import multer, { Multer } from "multer";
import path from "path";
import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import fs from "fs";

// Create uploads directory if it doesn't exist
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Define allowed file types
const ALLOWED_FILE_TYPES = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  video: ["video/mp4", "video/mpeg", "video/quicktime"],
  document: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  // Add more types as needed
};

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with original extension
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// File filter function
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check if the file type is in our allowed types
  const isAllowed = Object.values(ALLOWED_FILE_TYPES).some(types => 
    types.includes(file.mimetype)
  );

  if (isAllowed) {
    cb(null, true);
  } else {
    cb(new Error("File type not allowed"));
  }
};

// Create multer instance with configuration
const upload: Multer = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size (adjust as needed)
    files: 1 // Maximum number of files
  }
});

// Specific upload middlewares for different types
export const uploadImage = upload;
export const uploadVideo = upload;
export const uploadDocument = upload;

// Error handler middleware for multer errors
export const handleUploadError: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        success: false,
        error: "File size too large. Maximum size is 100MB"
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: err.message
    });
    return;
  }

  if (err.message === "File type not allowed") {
    res.status(400).json({
      success: false,
      error: "Invalid file type. Allowed types are: images (JPEG, PNG, GIF, WEBP), videos (MP4, MPEG, QuickTime), documents (PDF, DOC, DOCX)"
    });
    return;
  }

  next(err);
};

// Helper function to clean up uploaded file
export const cleanupUpload = (filePath: string) => {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("Error deleting file:", err);
    }
  });
}; 