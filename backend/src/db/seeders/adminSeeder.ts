import bcrypt from "bcryptjs";
import prisma from "../prisma.js";
import dotenv from "dotenv";

dotenv.config();

const seedAdmin = async () => {
  try {
    // Check if admin already exists
    const adminExists = await prisma.admin.findFirst({
      where: {
        email: process.env.INITIAL_ADMIN_EMAIL,
      },
    });

    if (adminExists) {
      console.log("Initial admin already exists");
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(
      process.env.INITIAL_ADMIN_PASSWORD!,
      salt
    );

    // Create admin
    const admin = await prisma.admin.create({
      data: {
        email: process.env.INITIAL_ADMIN_EMAIL!,
        password: hashedPassword,
        name: "Super Admin",
        designation: "Super Admin",
        isVerified: true,
        isActive: true,
      },
    });

    console.log("Initial admin created:", admin.email);
  } catch (error) {
    console.error("Error seeding admin:", error);
  } finally {
    await prisma.$disconnect();
  }
};

// Run seeder if this file is run directly
if (require.main === module) {
  seedAdmin();
}

export { seedAdmin }; 