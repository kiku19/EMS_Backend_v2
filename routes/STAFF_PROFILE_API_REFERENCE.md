# Staff Profile Update API - Quick Reference

## Base URL
```
http://localhost:3000/api/mobile
```

## Authentication
All endpoints require JWT authentication:
```
Authorization: Bearer <your-jwt-token>
```

---

## Endpoints

### 1. Get Staff Profile

**Endpoint**: `GET /api/mobile/staff/:staffId/profile`

**Description**: Retrieves staff profile with editable fields only

**Authentication**: Required

**Parameters**:
- `staffId` (path parameter) - MongoDB _id of staff member

**Success Response** (200):
```json
{
  "id": "507f1f77bcf86cd799439011",
  "name": "John Doe",
  "code": "STF001",
  "email": "john.doe@example.com",
  "phone": "9876543210",
  "whatsappNumber": "9876543210",
  "bloodGroup": "A+",
  "maritalStatus": "Married",
  "address": "123 Main Street",
  "emergencyContacts": [
    {
      "name": "Jane Doe",
      "relationship": "Spouse",
      "phone": "9876543211"
    }
  ],
  "picture": "https://example.com/photos/john-doe.jpg",
  "role": ["Teacher"],
  "department": "Science",
  "updatedAt": "2025-02-07T10:30:00.000Z"
}
```

**Error Responses**:
- `401` - Authentication required
- `404` - Staff not found
- `500` - Server error

---

### 2. Update Staff Profile

**Endpoint**: `PUT /api/mobile/staff/:staffId/profile`

**Description**: Updates staff profile (self-service)

**Authentication**: Required

**Parameters**:
- `staffId` (path parameter) - MongoDB _id of staff member

**Request Body** (all fields optional):
```json
{
  "phone": "9876543210",
  "email": "john.doe@example.com",
  "whatsappNumber": "9876543210",
  "bloodGroup": "A+",
  "maritalStatus": "Married",
  "address": "123 Main Street",
  "emergencyContacts": [
    {
      "name": "Jane Doe",
      "relationship": "Spouse",
      "phone": "9876543211"
    }
  ],
  "picture": "https://example.com/photos/john-doe.jpg"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "fieldsChanged": ["phone", "email"],
  "profile": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "code": "STF001",
    "email": "john.doe@example.com",
    "phone": "9876543210",
    "whatsappNumber": "9876543210",
    "bloodGroup": "A+",
    "maritalStatus": "Married",
    "address": "123 Main Street",
    "emergencyContacts": [
      {
        "name": "Jane Doe",
        "relationship": "Spouse",
        "phone": "9876543211"
      }
    ],
    "picture": "https://example.com/photos/john-doe.jpg",
    "role": ["Teacher"],
    "department": "Science",
    "updatedAt": "2025-02-07T10:30:00.000Z"
  }
}
```

**No Changes Response** (200):
```json
{
  "success": true,
  "message": "No changes to update",
  "profile": { ... }
}
```

**Error Responses**:
- `400` - Validation failed (see validation rules below)
- `401` - Authentication required
- `403` - Access denied (editing another's profile without admin)
- `404` - Staff not found
- `500` - Server error

---

## Validation Rules

### Phone Numbers
- **Format**: Exactly 10 digits
- **Pattern**: `/^[0-9]{10}$/`
- **Examples**: `9876543210` (valid), `12345` (invalid)

### Email
- **Format**: Valid email address
- **Example**: `user@example.com` (valid), `user@` (invalid)

### Blood Group
- **Valid Values**: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`
- **Case-sensitive**

### Marital Status
- **Valid Values**: `Single`, `Married`, `Divorced`, `Widowed`
- **Case-sensitive**

### Address
- **Max Length**: 200 characters

### Emergency Contacts
- **Min**: 1 contact
- **Max**: 5 contacts
- **Each contact requires**:
  - `name` (string, 2-100 characters)
  - `relationship` (string, max 50 characters)
  - `phone` (string, exactly 10 digits)

### Profile Picture
- **Format**: Valid URL
- **Example**: `https://example.com/photo.jpg` (valid), `not-a-url` (invalid)

---

## Security Features

### Self-Service Enforcement
- Staff can only edit their own profile
- Admins can edit any staff profile
- Attempting to edit another's profile returns `403`

### Admin-Only Fields (Blocked)
The following fields cannot be updated via this endpoint:
- `salary`
- `roles`
- `role`
- `department`
- `employmentStatus`
- `employmentType`
- `status`
- `staffNumber`
- `staffId`
- `qualifications`
- `professionalQualifications`
- `salaryBreakdown`
- `salaryTemplate`
- `accountNumber`
- `ifscCode`
- `bankName`
- `branchName`
- `assignedClasses`
- `isClassTeacher`
- `classTeacherOf`
- `staffType`
- `expertise`
- `assignedClassId`
- `reporterId`
- `joinDate`
- `name`
- `fullName`

Attempting to update these fields returns `403` with:
```json
{
  "error": "Forbidden",
  "message": "Cannot modify admin-only fields",
  "restrictedFields": ["salary"],
  "allowedFields": ["phone", "email", "whatsappNumber", "bloodGroup", "maritalStatus", "address", "emergencyContacts", "picture"]
}
```

---

## Audit Logging

Every profile update creates an audit log entry with:
- **Timestamp**: When the update occurred
- **Staff ID**: Who was updated
- **Action**: Type of change (`profile_update` or `photo_update`)
- **Fields Changed**: Which fields were modified
- **Previous Values**: Values before the update
- **New Values**: Values after the update
- **Source**: Where the update came from (`mobile_app` or `web_dashboard`)
- **IP Address**: Client IP address
- **User Agent**: Client device/browser info

---

## Socket Events

### `staff_updated`
Emitted when a profile is successfully updated.

**Event Data**:
```json
{
  "staffId": "507f1f77bcf86cd799439011",
  "fieldsChanged": ["phone", "email"],
  "timestamp": "2025-02-07T10:30:00.000Z",
  "source": "mobile_app",
  "name": "John Doe",
  "role": ["Teacher"],
  "department": "Science",
  "status": "active",
  "phone": "9876543210",
  "email": "john.doe@example.com",
  "picture": "https://example.com/photo.jpg"
}
```

Use this event to refresh UI components in real-time across all connected clients.

---

## Error Response Format

All errors follow this format:
```json
{
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

Validation errors include additional details:
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    },
    {
      "field": "phone",
      "message": "Phone number must be 10 digits"
    }
  ]
}
```

---

## Usage Examples

### cURL Examples

#### Get Profile
```bash
curl -X GET \
  'http://localhost:3000/api/mobile/staff/507f1f77bcf86cd799439011/profile' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

#### Update Phone
```bash
curl -X PUT \
  'http://localhost:3000/api/mobile/staff/507f1f77bcf86cd799439011/profile' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "phone": "9876543210"
  }'
```

#### Update Multiple Fields
```bash
curl -X PUT \
  'http://localhost:3000/api/mobile/staff/507f1f77bcf86cd799439011/profile' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "phone": "9876543210",
    "email": "newemail@example.com",
    "bloodGroup": "A+",
    "maritalStatus": "Married"
  }'
```

### JavaScript/Fetch Examples

#### Get Profile
```javascript
const response = await fetch('http://localhost:3000/api/mobile/staff/507f1f77bcf86cd799439011/profile', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const profile = await response.json();
console.log(profile);
```

#### Update Profile
```javascript
const updateData = {
  phone: '9876543210',
  email: 'newemail@example.com',
  bloodGroup: 'A+'
};

const response = await fetch('http://localhost:3000/api/mobile/staff/507f1f77bcf86cd799439011/profile', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(updateData)
});

const result = await response.json();
console.log(result);
```

---

## Testing

Use the provided test file `test-staff-profile-endpoints.http` with REST Client extension in VS Code for comprehensive testing.

Alternatively, use Postman, Insomnia, or any HTTP client with the examples above.

---

## Files Modified

- `backend/routes/mobile.js` - Added endpoints and imports

## Dependencies

- `backend/middleware/staffValidation.js` - Validation middleware
- `backend/models/StaffProfileAudit.js` - Audit log model
- `backend/utils/socketEmitter.js` - Socket emitter utility
- `backend/middleware/auth.js` - Authentication middleware

---

## Support

For issues or questions, refer to:
- Implementation Summary: `TASK_1.1_IMPLEMENTATION_SUMMARY.md`
- Test Cases: `test-staff-profile-endpoints.http`
- Code: `backend/routes/mobile.js` (lines 596-798)
