// API Versioning Middleware
// Adds version headers and deprecation warnings for non-versioned /api routes

export const CURRENT_API_VERSION = 'v1';

// Adds X-API-Version header to all API responses
export function addApiVersionHeader(_req, res, next) {
  res.setHeader('X-API-Version', CURRENT_API_VERSION);
  next();
}

// Adds deprecation headers for legacy /api (non-versioned) routes.
// Mobile apps in the field use /api — they keep working, but clients are
// informed to migrate to /api/v1.
export function deprecationWarning(req, res, next) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Mon, 01 Jan 2029 00:00:00 GMT');
  res.setHeader('Link', `</api/v1${req.path}>; rel="successor-version"`);
  next();
}
