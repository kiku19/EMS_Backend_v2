// Centralized error handling middleware
import { createLogger } from '../../utils/logger.js';
import { captureError } from '../../utils/sentry.js';

const logger = createLogger('ErrorHandler');

/**
 * Standard error response format
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Create standardized error responses
 */
export function createError(statusCode, message, details = null) {
  return new ApiError(statusCode, message, details);
}

/**
 * Error handler middleware
 */
export function errorHandler(err, req, res, next) {
  let { statusCode, message, details } = err;

  // Default to 500 if no status code
  statusCode = statusCode || 500;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = req?.t?.('common:errors.validationError') ?? 'Validation Error';
    details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = req?.t?.('common:errors.invalidId') ?? 'Invalid ID format';
    details = { field: err.path, value: err.value };
  } else if (err.code === 11000) {
    statusCode = 409;
    message = req?.t?.('common:errors.duplicateEntry') ?? 'Duplicate entry';
    const field = Object.keys(err.keyPattern)[0];
    details = { field, message: `${field} already exists` };
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = req?.t?.('common:errors.tokenInvalid') ?? 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = req?.t?.('common:errors.tokenExpired') ?? 'Token expired';
  }

  // Log error with structured fields for log aggregation
  const logData = {
    statusCode,
    message,
    details,
    requestId: req?.requestId,
    schoolId: req?.user?.schoolId,
    userId: req?.user?._id,
    method: req?.method,
    url: req?.path,
    err,
  };
  if (statusCode >= 500) {
    logger.error(logData, 'Unhandled error');
    captureError(err, req);
  } else if (statusCode >= 400) {
    logger.warn(logData, 'Client error');
  }

  // Send standardized error response
  const response = {
    success: false,
    error: message,
    statusCode,
  };

  if (details) {
    response.details = details;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 handler
 */
export function notFoundHandler(req, res, next) {
  const message =
    req?.t?.('common:errors.routeNotFound', { path: req.originalUrl }) ??
    `Route not found: ${req.originalUrl}`;
  const error = new ApiError(404, message);
  next(error);
}

/**
 * Async error wrapper
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Send a standardized error response directly from a route handler.
 * Use this in catch blocks instead of res.json({ error: ... }).
 * Server errors (5xx) are automatically captured to Sentry.
 *
 * @example
 *   catch (err) { return sendError(res, 500, err.message, null, err, req); }
 *   catch (err) { return sendError(res, 400, 'Invalid input', [{ field: 'name', message: 'Required' }]); }
 */
export function sendError(res, statusCode, message, details = null, err = null, req = null) {
  if (statusCode >= 500 && err) {
    captureError(err, req);
  }
  const response = { success: false, error: message, statusCode };
  if (details) response.details = details;
  return res.status(statusCode).json(response);
}

// Export ApiError class
export { ApiError };
