// Centralized error handling middleware

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
    message = 'Validation Error';
    details = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message
    }));
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    details = { field: err.path, value: err.value };
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
    const field = Object.keys(err.keyPattern)[0];
    details = { field, message: `${field} already exists` };
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Log error for debugging (not in production)
  if (process.env.NODE_ENV !== 'production') {
    console.error('Error:', {
      statusCode,
      message,
      details,
      stack: err.stack
    });
  }

  // Send standardized error response
  const response = {
    success: false,
    error: message,
    statusCode
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
  const error = new ApiError(404, `Route not found: ${req.originalUrl}`);
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

// Export ApiError class
export { ApiError };
