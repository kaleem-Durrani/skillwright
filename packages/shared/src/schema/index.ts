/**
 * Every request and response shape in the system, in one namespace.
 *
 * The API validates with these and the SPA infers its types from them, so a
 * renamed field is a compile error on both sides of the wire in the same commit.
 */
export * from './errors.js';
export * from './common.js';
export * from './pagination.js';
export * from './user.js';
export * from './department.js';
export * from './course.js';
export * from './enrollment.js';
export * from './upload.js';
export * from './resource.js';
export * from './announcement.js';
export * from './comment.js';
export * from './message.js';
export * from './conversation.js';
export * from './notification.js';
export * from './auth.js';
