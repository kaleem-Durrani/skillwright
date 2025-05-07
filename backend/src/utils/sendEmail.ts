import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create a transporter object using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App password generated from Google account
  },
  // Add DKIM and SPF configurations if available
  // This helps improve email deliverability
  dkim: process.env.DKIM_PRIVATE_KEY ? {
    domainName: process.env.DKIM_DOMAIN || '',
    keySelector: process.env.DKIM_SELECTOR || '',
    privateKey: process.env.DKIM_PRIVATE_KEY || '',
  } : undefined,
});

/**
 * Send an email using nodemailer with improved deliverability
 * @param to Recipient email address
 * @param subject Email subject
 * @param html HTML content of the email
 * @param text Plain text version of the email (optional)
 * @returns Promise that resolves with the nodemailer info object
 */
export const sendEmail = async (
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<any> => {
  try {
    const mailOptions = {
      from: `"Millat Vocational Training" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: text || '',
      html,
      // Headers to improve deliverability
      headers: {
        'X-Priority': '1', // High priority
        'X-MSMail-Priority': 'High',
        'Importance': 'High',
        'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}?subject=Unsubscribe>`,
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

/**
 * Send a verification OTP email to a student
 * @param to Student's email address
 * @param otp One-time password for verification
 * @param firstName Student's first name (optional)
 */
export const sendVerificationEmail = async (
  to: string,
  otp: string,
  firstName?: string
): Promise<any> => {
  const subject = 'Verify Your Email - Millat Vocational Training';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email Verification</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9f9f9;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #1a56db;">
            <h1 style="color: #ffffff; margin: 0;">Millat Vocational Training</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 20px;">
            <h2 style="color: #333333; margin-top: 0;">Email Verification</h2>
            <p style="color: #555555; line-height: 1.5;">Hello ${firstName || 'there'},</p>
            <p style="color: #555555; line-height: 1.5;">Thank you for registering with Millat Vocational Training. To complete your registration, please use the following verification code:</p>
            <div style="background-color: #f2f7ff; border: 1px solid #d1e3ff; border-radius: 4px; padding: 15px; text-align: center; margin: 20px 0;">
              <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1a56db;">${otp}</span>
            </div>
            <p style="color: #555555; line-height: 1.5;">This code will expire in 15 minutes.</p>
            <p style="color: #555555; line-height: 1.5;">If you did not request this verification, please ignore this email.</p>
            <p style="color: #555555; line-height: 1.5; margin-top: 30px;">Best regards,<br>Millat Vocational Training Team</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 15px; text-align: center; background-color: #f2f7ff; border-top: 1px solid #e5e5e5;">
            <p style="color: #777777; font-size: 12px; margin: 0;">This is an automated message, please do not reply to this email.</p>
            <p style="color: #777777; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `
    Millat Vocational Training - Email Verification

    Hello ${firstName || 'there'},

    Thank you for registering with Millat Vocational Training. To complete your registration, please use the following verification code:

    ${otp}

    This code will expire in 15 minutes.

    If you did not request this verification, please ignore this email.

    Best regards,
    Millat Vocational Training Team

    © ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.
  `;

  return sendEmail(to, subject, html, text);
};

/**
 * Send a password reset email with OTP
 * @param to User's email address
 * @param otp One-time password for password reset
 * @param firstName User's first name (optional)
 */
export const sendPasswordResetEmail = async (
  to: string,
  otp: string,
  firstName?: string
): Promise<any> => {
  const subject = 'Reset Password - Millat Vocational Training';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9f9f9;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #1a56db;">
            <h1 style="color: #ffffff; margin: 0;">Millat Vocational Training</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 20px;">
            <h2 style="color: #333333; margin-top: 0;">Password Reset</h2>
            <p style="color: #555555; line-height: 1.5;">Hello ${firstName || 'there'},</p>
            <p style="color: #555555; line-height: 1.5;">We received a request to reset your password for your Millat Vocational Training account. Please use the following code to reset your password:</p>
            <div style="background-color: #f2f7ff; border: 1px solid #d1e3ff; border-radius: 4px; padding: 15px; text-align: center; margin: 20px 0;">
              <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1a56db;">${otp}</span>
            </div>
            <p style="color: #555555; line-height: 1.5;">This code will expire in 15 minutes.</p>
            <p style="color: #555555; line-height: 1.5;">If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
            <p style="color: #555555; line-height: 1.5; margin-top: 30px;">Best regards,<br>Millat Vocational Training Team</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 15px; text-align: center; background-color: #f2f7ff; border-top: 1px solid #e5e5e5;">
            <p style="color: #777777; font-size: 12px; margin: 0;">This is an automated message, please do not reply to this email.</p>
            <p style="color: #777777; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `
    Millat Vocational Training - Password Reset

    Hello ${firstName || 'there'},

    We received a request to reset your password for your Millat Vocational Training account. Please use the following code to reset your password:

    ${otp}

    This code will expire in 15 minutes.

    If you did not request a password reset, please ignore this email or contact support if you have concerns.

    Best regards,
    Millat Vocational Training Team

    © ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.
  `;

  return sendEmail(to, subject, html, text);
};

/**
 * Send a welcome email after successful verification
 * @param to User's email address
 * @param firstName User's first name (optional)
 */
export const sendWelcomeEmail = async (
  to: string,
  firstName?: string
): Promise<any> => {
  const subject = 'Welcome to Millat Vocational Training!';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to Millat Vocational Training</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9f9f9;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #1a56db;">
            <h1 style="color: #ffffff; margin: 0;">Millat Vocational Training</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 20px;">
            <h2 style="color: #333333; margin-top: 0;">Welcome!</h2>
            <p style="color: #555555; line-height: 1.5;">Hello ${firstName || 'there'},</p>
            <p style="color: #555555; line-height: 1.5;">Thank you for verifying your email address. Your Millat Vocational Training account is now fully activated!</p>
            <p style="color: #555555; line-height: 1.5;">You can now:</p>
            <ul style="color: #555555; line-height: 1.5;">
              <li>Access your courses and learning materials</li>
              <li>Participate in training sessions</li>
              <li>Track your progress and certifications</li>
              <li>Connect with instructors and other students</li>
            </ul>
            <div style="background-color: #f2f7ff; border-radius: 4px; padding: 15px; margin: 20px 0;">
              <p style="color: #1a56db; margin: 0; font-weight: bold;">Get Started Now</p>
              <p style="color: #555555; margin-top: 10px; margin-bottom: 0;">Log in to your account to explore all the resources available to you.</p>
            </div>
            <p style="color: #555555; line-height: 1.5;">If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
            <p style="color: #555555; line-height: 1.5; margin-top: 30px;">Best regards,<br>Millat Vocational Training Team</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 15px; text-align: center; background-color: #f2f7ff; border-top: 1px solid #e5e5e5;">
            <p style="color: #777777; font-size: 12px; margin: 0;">This is an automated message, please do not reply to this email.</p>
            <p style="color: #777777; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `
    Welcome to Millat Vocational Training!

    Hello ${firstName || 'there'},

    Thank you for verifying your email address. Your Millat Vocational Training account is now fully activated!

    You can now:
    - Access your courses and learning materials
    - Participate in training sessions
    - Track your progress and certifications
    - Connect with instructors and other students

    Get Started Now:
    Log in to your account to explore all the resources available to you.

    If you have any questions or need assistance, please don't hesitate to contact our support team.

    Best regards,
    Millat Vocational Training Team

    © ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.
  `;

  return sendEmail(to, subject, html, text);
};

/**
 * Send initial password to a teacher created by an admin
 * @param to Teacher's email address
 * @param password Initial password
 * @param firstName Teacher's first name (optional)
 * @param lastName Teacher's last name (optional)
 */
export const sendTeacherInitialPasswordEmail = async (
  to: string,
  password: string,
  firstName?: string,
  lastName?: string
): Promise<any> => {
  const fullName = firstName && lastName
    ? `${firstName} ${lastName}`
    : firstName || 'there';

  const subject = 'Your Millat Vocational Training Teacher Account';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Teacher Account Created</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9f9f9;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #1a56db;">
            <h1 style="color: #ffffff; margin: 0;">Millat Vocational Training</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 20px;">
            <h2 style="color: #333333; margin-top: 0;">Teacher Account Created</h2>
            <p style="color: #555555; line-height: 1.5;">Hello ${fullName},</p>
            <p style="color: #555555; line-height: 1.5;">An administrator has created a teacher account for you on the Millat Vocational Training platform.</p>
            <p style="color: #555555; line-height: 1.5;">Here are your login details:</p>
            <div style="background-color: #f2f7ff; border: 1px solid #d1e3ff; border-radius: 4px; padding: 15px; margin: 20px 0;">
              <p style="margin: 5px 0; color: #555555;"><strong>Email:</strong> ${to}</p>
              <p style="margin: 5px 0; color: #555555;"><strong>Initial Password:</strong> <span style="font-family: monospace; background-color: #ffffff; padding: 2px 5px; border: 1px solid #d1e3ff;">${password}</span></p>
            </div>
            <p style="color: #d9534f; font-weight: bold;">Important: You will be required to change this password when you first log in.</p>
            <p style="color: #555555; line-height: 1.5;">As a teacher on our platform, you can:</p>
            <ul style="color: #555555; line-height: 1.5;">
              <li>Create and manage classes</li>
              <li>Upload learning materials</li>
              <li>Monitor student progress</li>
              <li>Conduct assessments</li>
            </ul>
            <p style="color: #555555; line-height: 1.5;">If you have any questions or need assistance, please contact your administrator.</p>
            <p style="color: #555555; line-height: 1.5; margin-top: 30px;">Best regards,<br>Millat Vocational Training Team</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 15px; text-align: center; background-color: #f2f7ff; border-top: 1px solid #e5e5e5;">
            <p style="color: #777777; font-size: 12px; margin: 0;">This is an automated message, please do not reply to this email.</p>
            <p style="color: #777777; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `
    Millat Vocational Training - Teacher Account Created

    Hello ${fullName},

    An administrator has created a teacher account for you on the Millat Vocational Training platform.

    Here are your login details:
    - Email: ${to}
    - Initial Password: ${password}

    IMPORTANT: You will be required to change this password when you first log in.

    As a teacher on our platform, you can:
    - Create and manage classes
    - Upload learning materials
    - Monitor student progress
    - Conduct assessments

    If you have any questions or need assistance, please contact your administrator.

    Best regards,
    Millat Vocational Training Team

    © ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.
  `;

  return sendEmail(to, subject, html, text);
};

/**
 * Send a password reset notification to a teacher
 * @param to Teacher's email address
 * @param newPassword New password
 * @param firstName Teacher's first name (optional)
 */
export const sendTeacherPasswordResetEmail = async (
  to: string,
  newPassword: string,
  firstName?: string
): Promise<any> => {
  const subject = 'Your Password Has Been Reset - Millat Vocational Training';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9f9f9;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #1a56db;">
            <h1 style="color: #ffffff; margin: 0;">Millat Vocational Training</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 20px;">
            <h2 style="color: #333333; margin-top: 0;">Password Reset</h2>
            <p style="color: #555555; line-height: 1.5;">Hello ${firstName || 'there'},</p>
            <p style="color: #555555; line-height: 1.5;">An administrator has reset your password for your Millat Vocational Training teacher account.</p>
            <div style="background-color: #f2f7ff; border: 1px solid #d1e3ff; border-radius: 4px; padding: 15px; margin: 20px 0;">
              <p style="margin: 5px 0; color: #555555;"><strong>Your new password is:</strong> <span style="font-family: monospace; background-color: #ffffff; padding: 2px 5px; border: 1px solid #d1e3ff;">${newPassword}</span></p>
            </div>
            <p style="color: #d9534f; font-weight: bold;">Important: You will be required to change this password when you next log in.</p>
            <p style="color: #555555; line-height: 1.5;">If you did not request this password reset, please contact your administrator immediately.</p>
            <p style="color: #555555; line-height: 1.5; margin-top: 30px;">Best regards,<br>Millat Vocational Training Team</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 15px; text-align: center; background-color: #f2f7ff; border-top: 1px solid #e5e5e5;">
            <p style="color: #777777; font-size: 12px; margin: 0;">This is an automated message, please do not reply to this email.</p>
            <p style="color: #777777; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `
    Millat Vocational Training - Password Reset

    Hello ${firstName || 'there'},

    An administrator has reset your password for your Millat Vocational Training teacher account.

    Your new password is: ${newPassword}

    IMPORTANT: You will be required to change this password when you next log in.

    If you did not request this password reset, please contact your administrator immediately.

    Best regards,
    Millat Vocational Training Team

    © ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.
  `;

  return sendEmail(to, subject, html, text);
};

/**
 * Send initial password to a new admin created by another admin
 * @param to Admin's email address
 * @param password Initial password
 * @param firstName Admin's first name (optional)
 * @param lastName Admin's last name (optional)
 */
export const sendAdminInitialPasswordEmail = async (
  to: string,
  password: string,
  firstName?: string,
  lastName?: string
): Promise<any> => {
  const fullName = firstName && lastName
    ? `${firstName} ${lastName}`
    : firstName || 'there';

  const subject = 'Your Millat Vocational Training Admin Account';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Account Created</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9f9f9;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #1a56db;">
            <h1 style="color: #ffffff; margin: 0;">Millat Vocational Training</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 20px;">
            <h2 style="color: #333333; margin-top: 0;">Admin Account Created</h2>
            <p style="color: #555555; line-height: 1.5;">Hello ${fullName},</p>
            <p style="color: #555555; line-height: 1.5;">An administrator has created an admin account for you on the Millat Vocational Training platform.</p>
            <p style="color: #555555; line-height: 1.5;">Here are your login details:</p>
            <div style="background-color: #f2f7ff; border: 1px solid #d1e3ff; border-radius: 4px; padding: 15px; margin: 20px 0;">
              <p style="margin: 5px 0; color: #555555;"><strong>Email:</strong> ${to}</p>
              <p style="margin: 5px 0; color: #555555;"><strong>Initial Password:</strong> <span style="font-family: monospace; background-color: #ffffff; padding: 2px 5px; border: 1px solid #d1e3ff;">${password}</span></p>
            </div>
            <p style="color: #555555; line-height: 1.5;">As an administrator on our platform, you have full access to manage the platform, including:</p>
            <ul style="color: #555555; line-height: 1.5;">
              <li>Creating and managing teacher accounts</li>
              <li>Managing student accounts</li>
              <li>Creating departments and courses</li>
              <li>Monitoring system usage</li>
              <li>Managing other administrative functions</li>
            </ul>
            <p style="color: #555555; line-height: 1.5;">If you have any questions, please contact the system administrator.</p>
            <p style="color: #555555; line-height: 1.5; margin-top: 30px;">Best regards,<br>Millat Vocational Training Team</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 15px; text-align: center; background-color: #f2f7ff; border-top: 1px solid #e5e5e5;">
            <p style="color: #777777; font-size: 12px; margin: 0;">This is an automated message, please do not reply to this email.</p>
            <p style="color: #777777; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `
    Millat Vocational Training - Admin Account Created

    Hello ${fullName},

    An administrator has created an admin account for you on the Millat Vocational Training platform.

    Here are your login details:
    - Email: ${to}
    - Initial Password: ${password}

    As an administrator on our platform, you have full access to manage the platform, including:
    - Creating and managing teacher accounts
    - Managing student accounts
    - Creating departments and courses
    - Monitoring system usage
    - Managing other administrative functions

    If you have any questions, please contact the system administrator.

    Best regards,
    Millat Vocational Training Team

    © ${new Date().getFullYear()} Millat Vocational Training. All rights reserved.
  `;

  return sendEmail(to, subject, html, text);
};
