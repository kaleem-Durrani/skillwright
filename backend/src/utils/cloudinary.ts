import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import type { Request } from "express";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configure Cloudinary
const configureCloudinary = () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error("Missing Cloudinary credentials in environment variables");
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
};

// Initialize Cloudinary configuration
configureCloudinary();

interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  resourceType: string;
  format: string;
  mimeType: string;
}

// Upload file to Cloudinary
export const uploadFile = async (file: Express.Multer.File): Promise<CloudinaryUploadResult> => {
  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "auto", // Automatically detect resource type (image, video, raw)
      folder: "millat-vocational-training", // Optional: organize files in folders
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      mimeType: file.mimetype,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Error uploading file to Cloudinary: ${error.message}`);
    }
    throw new Error("Unknown error occurred while uploading to Cloudinary");
  }
};

// Delete file from Cloudinary
export const deleteFile = async (publicId: string): Promise<UploadApiResponse> => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Error deleting file from Cloudinary: ${error.message}`);
    }
    throw new Error("Unknown error occurred while deleting from Cloudinary");
  }
};

export const test = "test";
