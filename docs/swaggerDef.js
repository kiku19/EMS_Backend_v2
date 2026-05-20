/**
 * OpenAPI / Swagger definition for EMS Backend API.
 *
 * swagger-jsdoc collects @swagger JSDoc blocks from all route files and merges
 * them with this base definition.  The result is served as JSON at
 * GET /api/docs/spec and rendered by swagger-ui-express at GET /api/docs.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Reusable response component definitions */
const commonComponents = {
  securitySchemes: {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT token obtained from POST /api/auth/login. Prefix: `Bearer <token>`',
    },
    CookieAuth: {
      type: 'apiKey',
      in: 'cookie',
      name: 'token',
      description: 'JWT stored in an httpOnly cookie (set automatically on login)',
    },
  },
  schemas: {
    // ─── Generic ────────────────────────────────────────────────────────────────
    ObjectId: {
      type: 'string',
      pattern: '^[0-9a-fA-F]{24}$',
      example: '64a1b2c3d4e5f6a7b8c9d0e1',
    },
    AcademicYear: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}$',
      example: CURRENT_ACADEMIC_YEAR,
    },
    Error: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Resource not found' },
      },
    },
    ValidationError: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Validation failed' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', example: 'name' },
              message: { type: 'string', example: 'String must contain at least 2 character(s)' },
            },
          },
        },
      },
    },
    SuccessMessage: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Operation completed successfully' },
      },
    },
    PaginationMeta: {
      type: 'object',
      properties: {
        total: { type: 'integer', example: 150 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
        hasMore: { type: 'boolean', example: true },
      },
    },

    // ─── Auth ────────────────────────────────────────────────────────────────────
    LoginRequest: {
      type: 'object',
      required: ['password'],
      properties: {
        phone: { type: 'string', pattern: '^[0-9]{10}$', example: '9876543210' },
        email: { type: 'string', format: 'email', example: 'admin@school.com' },
        password: { type: 'string', minLength: 8, example: 'Secret123!' },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        schoolCode: { type: 'string', example: 'SCHOOL001' },
      },
    },
    LoginResponse: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'JWT access token' },
        refreshToken: { type: 'string', description: 'JWT refresh token (30d expiry)' },
        user: {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/ObjectId' },
            name: { type: 'string', example: 'Jane Admin' },
            role: { type: 'string', example: 'admin' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            schoolId: { $ref: '#/components/schemas/ObjectId' },
          },
        },
      },
    },
    SignupRequest: {
      type: 'object',
      required: ['name', 'email', 'schoolName', 'password', 'inviteToken'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 100, example: 'Jane Admin' },
        email: { type: 'string', format: 'email', example: 'admin@school.com' },
        schoolName: { type: 'string', minLength: 2, maxLength: 200, example: 'Sunrise Academy' },
        password: { type: 'string', minLength: 8, maxLength: 128, example: 'Secret123!' },
        inviteToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
        phone: { type: 'string', pattern: '^[0-9]{10}$', example: '9876543210' },
      },
    },

    // ─── Student ─────────────────────────────────────────────────────────────────
    ParentInfo: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Ramesh Kumar' },
        relationship: { type: 'string', example: 'Father' },
        phone: { type: 'string', example: '9876543210' },
        email: { type: 'string', format: 'email' },
        occupation: { type: 'string' },
        isWhatsapp: { type: 'boolean' },
      },
    },
    StudentBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string', example: 'Priya Sharma' },
        admissionId: { type: 'string', example: 'ADM2024001' },
        rollNo: { type: 'integer', example: 5 },
        classId: { $ref: '#/components/schemas/ObjectId' },
        academicYear: { $ref: '#/components/schemas/AcademicYear' },
        gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
        dateOfBirth: { type: 'string', format: 'date', example: '2010-05-15' },
        bloodGroup: { type: 'string', example: 'O+' },
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'graduated', 'transferred', 'alumni'],
          example: 'active',
        },
        photo: { type: 'string', format: 'uri' },
        phone: { type: 'string' },
        email: { type: 'string', format: 'email' },
        address: { type: 'string' },
        parents: { type: 'array', items: { $ref: '#/components/schemas/ParentInfo' } },
        feeStatus: { type: 'string', enum: ['paid', 'partial', 'pending', 'overdue'] },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateStudentRequest: {
      type: 'object',
      required: ['name', 'admissionId', 'academicYear', 'classId'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 100, example: 'Priya Sharma' },
        admissionId: { type: 'string', maxLength: 50, example: 'ADM2024001' },
        academicYear: { $ref: '#/components/schemas/AcademicYear' },
        classId: { $ref: '#/components/schemas/ObjectId' },
        rollNo: { type: 'integer', minimum: 1 },
        gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
        dateOfBirth: { type: 'string', format: 'date' },
        bloodGroup: { type: 'string', example: 'O+' },
        phone: { type: 'string', pattern: '^[0-9]{10}$' },
        email: { type: 'string', format: 'email' },
        address: { type: 'string' },
        parents: { type: 'array', items: { $ref: '#/components/schemas/ParentInfo' } },
      },
    },

    // ─── Class ──────────────────────────────────────────────────────────────────
    ClassBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string', example: 'Class 10' },
        section: { type: 'string', example: 'A' },
        subjects: { type: 'array', items: { type: 'string' }, example: ['Mathematics', 'Science'] },
        classTeacherId: { $ref: '#/components/schemas/ObjectId' },
        academicYear: { $ref: '#/components/schemas/AcademicYear' },
        strengthLimit: { type: 'integer', example: 40 },
        studentCount: { type: 'integer', example: 35 },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateClassRequest: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', example: 'Class 10' },
        section: { type: 'string', example: 'A' },
        subjects: { type: 'array', items: { type: 'string' } },
        classTeacherId: { $ref: '#/components/schemas/ObjectId' },
        academicYear: { $ref: '#/components/schemas/AcademicYear' },
        strengthLimit: { type: 'integer', minimum: 1 },
      },
    },

    // ─── Staff ──────────────────────────────────────────────────────────────────
    StaffBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string', example: 'Rahul Verma' },
        code: { type: 'string', example: 'EMP001' },
        role: { type: 'array', items: { type: 'string' }, example: ['teacher'] },
        department: { type: 'string', example: 'Science' },
        status: { type: 'string', enum: ['active', 'inactive', 'on-leave'], example: 'active' },
        phone: { type: 'string', example: '9876543210' },
        email: { type: 'string', format: 'email' },
        joinDate: { type: 'string', format: 'date' },
        isClassTeacher: { type: 'boolean' },
        classTeacherOf: { type: 'string', example: '10-A' },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateStaffRequest: {
      type: 'object',
      required: ['name', 'role'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 100, example: 'Rahul Verma' },
        role: {
          oneOf: [
            { type: 'string', example: 'teacher' },
            { type: 'array', items: { type: 'string' }, example: ['teacher', 'admin'] },
          ],
        },
        department: { type: 'string' },
        phone: { type: 'string', pattern: '^[0-9]{10}$' },
        email: { type: 'string', format: 'email' },
        joinDate: { type: 'string', format: 'date' },
        status: { type: 'string', enum: ['active', 'inactive', 'on-leave'], default: 'active' },
        password: { type: 'string', minLength: 8 },
      },
    },

    // ─── Attendance ─────────────────────────────────────────────────────────────
    AttendanceRecord: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        studentId: { $ref: '#/components/schemas/ObjectId' },
        classId: { $ref: '#/components/schemas/ObjectId' },
        date: { type: 'string', format: 'date', example: '2024-11-15' },
        status: {
          type: 'string',
          enum: ['present', 'absent', 'late', 'leave', 'halfday'],
          example: 'present',
        },
        markedBy: { $ref: '#/components/schemas/ObjectId' },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
      },
    },
    BulkAttendanceRequest: {
      type: 'object',
      required: ['classId', 'date', 'attendance'],
      properties: {
        classId: { $ref: '#/components/schemas/ObjectId' },
        date: { type: 'string', format: 'date', example: '2024-11-15' },
        attendance: {
          type: 'object',
          description: 'Map of studentId → status',
          additionalProperties: {
            type: 'string',
            enum: ['present', 'absent', 'late', 'leave', 'halfday'],
          },
          example: { '64a1b2c3d4e5f6a7b8c9d0e1': 'present', '64a1b2c3d4e5f6a7b8c9d0e2': 'absent' },
        },
      },
    },

    // ─── Exam / Academics ────────────────────────────────────────────────────────
    ExamBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string', example: 'Mid-Term Examination' },
        classId: { $ref: '#/components/schemas/ObjectId' },
        subject: { type: 'string', example: 'Mathematics' },
        date: { type: 'string', format: 'date', example: '2024-11-20' },
        maxMarks: { type: 'number', example: 100 },
        passingMarks: { type: 'number', example: 35 },
        status: { type: 'string', enum: ['draft', 'published', 'completed'], example: 'draft' },
        academicYear: { $ref: '#/components/schemas/AcademicYear' },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    ResultBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        examId: { $ref: '#/components/schemas/ObjectId' },
        studentId: { $ref: '#/components/schemas/ObjectId' },
        classId: { $ref: '#/components/schemas/ObjectId' },
        marksObtained: { type: 'number', example: 85 },
        percentage: { type: 'number', example: 85 },
        grade: { type: 'string', example: 'A' },
        rank: { type: 'integer', example: 3 },
        status: { type: 'string', enum: ['pass', 'fail', 'absent'], example: 'pass' },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
      },
    },

    // ─── Webhooks ────────────────────────────────────────────────────────────────
    WebhookBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string', example: 'Fee Payment Notifier' },
        url: { type: 'string', format: 'uri', example: 'https://your-server.com/hooks/ems' },
        events: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'student.created',
              'student.updated',
              'fee.paid',
              'attendance.marked',
              'exam.published',
              'result.entered',
              'staff.created',
              'announcement.sent',
            ],
          },
          example: ['fee.paid', 'student.created'],
        },
        isActive: { type: 'boolean', example: true },
        failureCount: { type: 'integer', example: 0 },
        lastTriggeredAt: { type: 'string', format: 'date-time', nullable: true },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateWebhookRequest: {
      type: 'object',
      required: ['name', 'url', 'events'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100, example: 'Fee Payment Notifier' },
        url: { type: 'string', format: 'uri', example: 'https://your-server.com/hooks/ems' },
        secret: {
          type: 'string',
          minLength: 8,
          maxLength: 256,
          description: 'Optional HMAC signing secret. Auto-generated if omitted.',
          example: 'my-strong-secret-value',
        },
        events: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            enum: [
              'student.created',
              'student.updated',
              'fee.paid',
              'attendance.marked',
              'exam.published',
              'result.entered',
              'staff.created',
              'announcement.sent',
            ],
          },
        },
        isActive: { type: 'boolean', default: true },
      },
    },
    UpdateWebhookRequest: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        url: { type: 'string', format: 'uri' },
        secret: { type: 'string', minLength: 8, maxLength: 256 },
        events: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            enum: [
              'student.created',
              'student.updated',
              'fee.paid',
              'attendance.marked',
              'exam.published',
              'result.entered',
              'staff.created',
              'announcement.sent',
            ],
          },
        },
        isActive: { type: 'boolean' },
      },
    },
    WebhookDeliveryLog: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        webhookId: { $ref: '#/components/schemas/ObjectId' },
        event: { type: 'string', example: 'fee.paid' },
        statusCode: { type: 'integer', example: 200 },
        success: { type: 'boolean', example: true },
        durationMs: { type: 'integer', example: 142 },
        requestPayload: { type: 'object' },
        responseBody: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },

    // ─── API Keys ─────────────────────────────────────────────────────────────────
    ApiKeyBase: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string', example: 'Tally Integration Key' },
        keyPrefix: {
          type: 'string',
          description: 'First 8 chars of the key for identification',
          example: 'a1b2c3d4',
        },
        scopes: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'read:all',
              'read:students',
              'read:fees',
              'read:attendance',
              'read:academics',
              'read:staff',
              'write:fees',
              'write:attendance',
            ],
          },
          example: ['read:students', 'read:fees'],
        },
        isActive: { type: 'boolean', example: true },
        rateLimitPerHour: { type: 'integer', example: 1000 },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        usageCount: { type: 'integer', example: 42 },
        lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
        lastUsedEndpoint: { type: 'string', example: '/api/v1/students' },
        revokedAt: { type: 'string', format: 'date-time', nullable: true },
        schoolId: { $ref: '#/components/schemas/ObjectId' },
        createdBy: { $ref: '#/components/schemas/ObjectId' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateApiKeyRequest: {
      type: 'object',
      required: ['name', 'scopes'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100, example: 'Tally Integration Key' },
        scopes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            enum: [
              'read:all',
              'read:students',
              'read:fees',
              'read:attendance',
              'read:academics',
              'read:staff',
              'write:fees',
              'write:attendance',
            ],
          },
          example: ['read:students', 'read:fees'],
        },
        rateLimitPerHour: { type: 'integer', minimum: 1, maximum: 100000, default: 1000 },
        expiresAt: {
          type: 'string',
          format: 'date-time',
          description: 'Optional hard expiry (ISO 8601)',
          example: '2027-01-01T00:00:00.000Z',
        },
      },
    },
    CreateApiKeyResponse: {
      type: 'object',
      properties: {
        _id: { $ref: '#/components/schemas/ObjectId' },
        name: { type: 'string' },
        keyPrefix: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        rawKey: {
          type: 'string',
          description:
            'The full API key — shown ONCE. Store it securely; it cannot be retrieved again.',
          example: 'ems_a1b2c3d4e5f6...',
        },
        _warning: { type: 'string', example: 'Save this key now — it will not be shown again.' },
      },
    },
    UpdateApiKeyRequest: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        scopes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            enum: [
              'read:all',
              'read:students',
              'read:fees',
              'read:attendance',
              'read:academics',
              'read:staff',
              'write:fees',
              'write:attendance',
            ],
          },
        },
        rateLimitPerHour: { type: 'integer', minimum: 1, maximum: 100000 },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        isActive: { type: 'boolean' },
      },
    },

    // ─── Fees ────────────────────────────────────────────────────────────────────
    FeePaymentRequest: {
      type: 'object',
      required: ['studentId', 'amount', 'paymentMode'],
      properties: {
        studentId: { $ref: '#/components/schemas/ObjectId' },
        amount: { type: 'number', minimum: 0, example: 5000 },
        paymentMode: {
          type: 'string',
          enum: ['cash', 'cheque', 'online', 'card', 'upi', 'bank_transfer'],
          example: 'cash',
        },
        feeHeadIds: { type: 'array', items: { $ref: '#/components/schemas/ObjectId' } },
        remarks: { type: 'string' },
        receiptDate: { type: 'string', format: 'date' },
        academicYear: { $ref: '#/components/schemas/AcademicYear' },
      },
    },
    FeeReceiptResponse: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        receiptNumber: { type: 'string', example: 'RCP-2024-001' },
        payment: { type: 'object' },
        studentFee: { type: 'object' },
      },
    },
  },
  responses: {
    Unauthorized: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Error' },
          example: { error: 'Unauthorized' },
        },
      },
    },
    Forbidden: {
      description: 'Insufficient permissions',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Error' },
          example: { error: 'Forbidden' },
        },
      },
    },
    NotFound: {
      description: 'Resource not found',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Error' },
          example: { error: 'Not found' },
        },
      },
    },
    ValidationError: {
      description: 'Request validation failed',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
    },
    ServerError: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Error' },
          example: { error: 'Internal server error' },
        },
      },
    },
  },
  parameters: {
    IdParam: {
      name: 'id',
      in: 'path',
      required: true,
      schema: { $ref: '#/components/schemas/ObjectId' },
      description: 'MongoDB ObjectId of the resource',
    },
    AcademicYearQuery: {
      name: 'academicYear',
      in: 'query',
      schema: { $ref: '#/components/schemas/AcademicYear' },
      description: `Filter by academic year (e.g. ${CURRENT_ACADEMIC_YEAR})`,
    },
    PageQuery: {
      name: 'page',
      in: 'query',
      schema: { type: 'integer', minimum: 1, default: 1 },
    },
    LimitQuery: {
      name: 'limit',
      in: 'query',
      schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
    },
    SearchQuery: {
      name: 'search',
      in: 'query',
      schema: { type: 'string' },
      description: 'Full-text search term',
    },
  },
};

const swaggerOptions = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'EMS (Education Management System) API',
      version,
      description: `
## Education Management System — REST API

Multi-tenant school management platform. Every authenticated endpoint is **school-scoped**: the \`schoolId\` is taken from the JWT, never from the request body.

### Authentication
Use **Bearer token** (JWT) in the \`Authorization\` header:
\`\`\`
Authorization: Bearer <token>
\`\`\`
Or send the token as an httpOnly **cookie** (set \`X-Auth-Mode: cookie\` on login).

### Base URL
\`/api/v1\` (versioned — recommended)
\`/api\` (legacy — deprecated, still works, adds \`Deprecation\` response headers)

### Validation
All write endpoints validate via **Zod** schemas. Validation errors return HTTP 422 with a structured \`details\` array.

### Error format
\`\`\`json
{ "error": "Human-readable message" }
\`\`\`
      `,
      contact: {
        name: 'EMS Engineering',
      },
      license: {
        name: 'Private',
      },
    },
    servers: [
      { url: '/api/v1', description: 'v1 (current)' },
      { url: 'http://localhost:3001/api/v1', description: 'Local development (v1)' },
      { url: '/api', description: 'Legacy (deprecated — will sunset 2029-01-01)' },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication & session management' },
      { name: 'Students', description: 'Student CRUD & profile management' },
      { name: 'Classes', description: 'Class & section management' },
      { name: 'Staff', description: 'Staff members & roles' },
      { name: 'Attendance', description: 'Student attendance tracking' },
      { name: 'Academics', description: 'Exams, results & grading' },
      { name: 'Fees', description: 'Fee collection & receipts' },
      { name: 'Fee Heads', description: 'Fee head configuration' },
      { name: 'Fee Structure', description: 'Per-student fee structures' },
      { name: 'Fee Templates', description: 'Reusable fee templates' },
      { name: 'Announcements', description: 'School-wide announcements' },
      { name: 'Messages', description: 'Direct messaging' },
      { name: 'Notifications', description: 'Push & in-app notifications' },
      { name: 'Timetable', description: 'Class timetable management' },
      { name: 'Homework', description: 'Homework assignments' },
      { name: 'Remarks', description: 'Student remarks' },
      { name: 'Payroll', description: 'Staff payroll' },
      { name: 'Front Desk', description: 'Visitor & gate pass management' },
      { name: 'Reports', description: 'Analytics & export' },
      { name: 'Settings', description: 'School configuration' },
      { name: 'Super Admin', description: 'Platform-level administration (super-admin only)' },
      { name: 'Parent', description: 'Parent portal endpoints' },
      { name: 'Mobile', description: 'Staff mobile app endpoints' },
      {
        name: 'Webhooks',
        description: 'Outbound webhook subscriptions for third-party integrations',
      },
      { name: 'API Keys', description: 'Machine-to-machine API key management' },
    ],
    security: [{ BearerAuth: [] }],
    components: commonComponents,
  },
  apis: [path.join(__dirname, '../routes/*.js')],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export default swaggerSpec;
