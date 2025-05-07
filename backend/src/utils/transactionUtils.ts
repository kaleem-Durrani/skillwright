import prisma from '../db/prisma.js'
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Executes a function within a Prisma transaction
 * 
 * This utility function provides a consistent way to use transactions across the application.
 * It handles starting the transaction, committing on success, and rolling back on error.
 * 
 * @param callback Function to execute within the transaction
 * @returns Result of the callback function
 * 
 * @example
 * // Example usage:
 * const result = await withTransaction(async (tx) => {
 *   const user = await tx.user.create({ data: { ... } });
 *   const profile = await tx.profile.create({ data: { userId: user.id, ... } });
 *   return { user, profile };
 * });
 */
export const withTransaction = async <T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> => {
  return await prisma.$transaction(async (tx) => {
    return await callback(tx);
  }, {
    // Transaction options
    maxWait: 5000, // Maximum amount of time to wait to acquire transaction
    timeout: 10000, // Maximum amount of time transaction can run
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, // Default isolation level
  });
};

/**
 * Executes a function within a Prisma transaction with custom options
 * 
 * This version allows specifying custom transaction options.
 * 
 * @param callback Function to execute within the transaction
 * @param options Transaction options
 * @returns Result of the callback function
 * 
 * @example
 * // Example usage with custom options:
 * const result = await withTransactionOptions(
 *   async (tx) => {
 *     // Transaction logic here
 *     return result;
 *   },
 *   {
 *     maxWait: 10000,
 *     timeout: 30000,
 *     isolationLevel: Prisma.TransactionIsolationLevel.Serializable
 *   }
 * );
 */


type TransactionOptions = Parameters<
  PrismaClient['$transaction']
>[1];

export const withTransactionOptions = async <T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionOptions
): Promise<T> => {
  return await prisma.$transaction(async (tx) => {
    return await callback(tx);
  }, options);
};
