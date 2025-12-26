# Reporter-Reportee Hierarchy Backend Implementation

## Overview
Backend support for organizational reporting structure and approval workflows has been successfully implemented.

## Database Changes

### Staff Schema Update (`database.js`)
Added `reporterId` field to Staff schema:
```javascript
reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
```

This field:
- References another Staff document (self-referential)
- Can be null (for top-level staff)
- Enables building hierarchical reporting structures

## API Endpoints Updated

### 1. GET `/api/staff`
**Changes:**
- Now populates `reporterId` with reporter's name
- Returns `reporterId` and `reporterName` in response

**Response includes:**
```json
{
  "id": "...",
  "name": "John Doe",
  "reporterId": "...",
  "reporterName": "Jane Smith"
}
```

### 2. GET `/api/staff/:id`
**Changes:**
- Populates `reporterId` with reporter details
- Returns `reporterId` and `reporterName`

### 3. POST `/api/staff`
**Changes:**
- Accepts `reporterId` in request body
- Validates that reporter exists
- Sets `reporterId` to null if not provided

**Request body:**
```json
{
  "name": "John Doe",
  "role": "Teacher",
  "reporterId": "..." // Optional
}
```

### 4. PUT `/api/staff/:id`
**Changes:**
- Accepts `reporterId` in request body
- Validates circular reference prevention
- Updates `reporterId` (can be set to null)
- Populates reporter details in response

**Circular Reference Validation:**
- Prevents staff from reporting to themselves
- Prevents circular chains (A → B → C → A)
- Returns 400 error if circular reference detected

## Validation Logic

### Circular Reference Check
The backend implements recursive validation to prevent circular references:

```javascript
const checkCircular = async (currentId, targetId, visited = new Set()) => {
  if (currentId === targetId) return true;
  if (visited.has(currentId)) return false;
  visited.add(currentId);
  
  const current = await Staff.findById(currentId);
  if (!current || !current.reporterId) return false;
  
  return checkCircular(current.reporterId.toString(), targetId, visited);
};
```

This ensures:
- No self-reporting (A → A)
- No circular chains (A → B → A)
- No deep circular chains (A → B → C → A)

## Frontend Integration

The frontend (`HierarchySettings.jsx`) already implements:
- Individual reporter assignment
- Bulk reporter assignment
- Circular reference validation (client-side)
- Reporting chain visualization
- Direct reportees count
- Toast notifications for success/error

## Testing

To test the implementation:

1. **Start the backend:**
   ```bash
   cd backend
   npm start
   ```

2. **Test individual assignment:**
   - Navigate to Settings → Hierarchy
   - Select a reporter for any staff member
   - Verify the assignment is saved

3. **Test bulk assignment:**
   - Select multiple staff members
   - Assign a reporter to all selected
   - Verify all assignments are saved

4. **Test circular reference prevention:**
   - Try to create A → B → A
   - Should show error toast and prevent assignment

5. **Test API directly:**
   ```bash
   # Get all staff with reporters
   curl http://localhost:3001/api/staff

   # Update staff reporter
   curl -X PUT http://localhost:3001/api/staff/:id \
     -H "Content-Type: application/json" \
     -d '{"reporterId": "..."}'
   ```

## Migration Notes

For existing databases:
- The `reporterId` field will be `null` for all existing staff
- No migration script needed
- Staff can be assigned reporters through the UI

## Future Enhancements

Potential improvements:
1. Add hierarchy depth limits
2. Add approval workflow based on hierarchy
3. Add hierarchy visualization (org chart)
4. Add bulk operations (move entire teams)
5. Add hierarchy-based permissions
6. Add reporting analytics

## Status
✅ Backend implementation complete
✅ Frontend integration complete
✅ Circular reference validation implemented
✅ Toast notifications added
✅ Ready for production use
