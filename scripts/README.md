# Database Diagnostic and Fix Scripts

This directory contains comprehensive scripts to diagnose and fix common database issues in the EMS application.

## Scripts Overview

### 1. `check-pagination-issues.js` - Comprehensive Diagnostic Tool

**Purpose**: Scans the entire database for common issues including:
- Pagination problems (data beyond API limits)
- Missing or undefined fields
- Orphaned references
- Status field inconsistencies
- Class-student count mismatches
- Soft-delete issues

**Usage**:
```bash
node backend/scripts/check-pagination-issues.js
```

**What it checks**:
- ✅ Pagination limits across all collections
- ✅ Student-class relationship consistency
- ✅ Missing/undefined critical fields
- ✅ Status field distribution
- ✅ isDeleted field consistency
- ✅ Class-wise student counts
- ✅ API limit recommendations

**Output**: Detailed report with color-coded issues (🔴 Critical, ⚠️ Warning, ✓ OK)

---

### 2. `fix-database-issues.js` - Automated Fix Tool

**Purpose**: Fixes common database issues found by the diagnostic tool

**Usage**:
```bash
node backend/scripts/fix-database-issues.js
```

**What it fixes**:
1. **isDeleted Field**: Sets `isDeleted=false` for all students missing this field
2. **Class Strength**: Updates class strength to match actual active student count
3. **Invalid Status**: Converts "transferred" status to "alumni" or "inactive"
4. **Database Indexes**: Creates missing indexes for better performance

**Safety Features**:
- ⚠️ Prompts for confirmation before each fix
- 📊 Shows what will be changed before applying
- ✅ Provides post-fix verification report

---

### 3. `check-5a-data.js` - Class-Specific Diagnostic

**Purpose**: Detailed analysis of a specific class (originally created for Class 5A)

**Usage**:
```bash
node backend/scripts/check-5a-data.js
```

**Modify for other classes**: Edit line 48 to change the class:
```javascript
const class5A = await Class.findOne({ name: 'Class 5', section: 'A' });
// Change to:
const class5A = await Class.findOne({ name: 'Class 10', section: 'B' });
```

---

## Common Issues and Solutions

### Issue 1: Students Not Showing in Dashboard

**Symptoms**:
- School dashboard shows fewer students than expected
- Staff app shows correct count but dashboard doesn't

**Diagnosis**:
```bash
node backend/scripts/check-pagination-issues.js
```

Look for:
```
🔴 CRITICAL: 204 documents exceed common pagination limits!
   → Frontend may not fetch all data
```

**Solution**:
Already fixed in `school-dashboard/src/services/api.js` by increasing limit to 1000.

**Verification**:
1. Restart backend server
2. Clear browser cache (Ctrl+Shift+R)
3. Check student counts in dashboard

---

### Issue 2: Class Strength Mismatch

**Symptoms**:
- Class shows wrong student count
- Strength field doesn't match actual students

**Diagnosis**:
```bash
node backend/scripts/check-pagination-issues.js
```

Look for:
```
⚠️ Class 5-A: 10 students (stored: 0)
   → Mismatch: Actual count (10) != Stored strength (0)
```

**Solution**:
```bash
node backend/scripts/fix-database-issues.js
```

Select "yes" when prompted to fix class strengths.

---

### Issue 3: Missing isDeleted Field

**Symptoms**:
- Inconsistent student filtering
- Some students appear/disappear randomly

**Diagnosis**:
```bash
node backend/scripts/check-pagination-issues.js
```

Look for:
```
🔴 isDeleted: 198/204 missing (97.1%)
   → These students will be treated as 'not deleted' by default
```

**Solution**:
```bash
node backend/scripts/fix-database-issues.js
```

Select "yes" when prompted to fix isDeleted field.

---

## Best Practices

### Regular Maintenance

Run the diagnostic script monthly:
```bash
node backend/scripts/check-pagination-issues.js > reports/db-check-$(date +%Y%m%d).txt
```

### Before Major Updates

Always run diagnostics before:
- Database migrations
- Schema changes
- Major feature releases

### After Data Import

Run both scripts after importing data:
```bash
# 1. Check for issues
node backend/scripts/check-pagination-issues.js

# 2. Fix issues
node backend/scripts/fix-database-issues.js
```

---

## Troubleshooting

### Connection Issues

If you see:
```
❌ MongoDB connection error: connect ECONNREFUSED
```

**Solution**:
1. Check if MongoDB is running
2. Verify `MONGO_URI` in `backend/.env`
3. Check network connectivity

### Permission Issues

If you see:
```
❌ Error: not authorized
```

**Solution**:
1. Check MongoDB user permissions
2. Verify credentials in `.env` file

### Timeout Issues

If queries timeout:
```
❌ Operation buffering timed out
```

**Solution**:
1. Increase `serverSelectionTimeoutMS` in script
2. Check MongoDB server load
3. Verify network latency

---

## Script Customization

### Adding New Checks

To add a new check to `check-pagination-issues.js`:

```javascript
async function checkMyNewIssue() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔍 MY NEW CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Your check logic here
  const Model = models.YourModel;
  const issues = await Model.find({ /* your query */ });
  
  if (issues.length > 0) {
    console.log(`🔴 Found ${issues.length} issues`);
  } else {
    console.log('✓ No issues found');
  }
}

// Add to main() function
async function main() {
  // ... existing code ...
  await checkMyNewIssue();
  // ... rest of code ...
}
```

### Adding New Fixes

To add a new fix to `fix-database-issues.js`:

```javascript
async function fixMyNewIssue() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔧 FIX X: Description of fix');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check for issues
  const issues = await Model.find({ /* query */ });
  
  if (issues.length === 0) {
    console.log('✓ No issues to fix');
    return;
  }

  // Prompt for confirmation
  const answer = await question(`Fix ${issues.length} issues? (yes/no): `);
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('Skipped.');
    return;
  }

  // Apply fix
  const result = await Model.updateMany(
    { /* query */ },
    { $set: { /* update */ } }
  );

  console.log(`✅ Fixed ${result.modifiedCount} issues`);
}
```

---

## Support

For issues or questions:
1. Check the diagnostic output first
2. Review this README
3. Check application logs
4. Contact the development team

---

## Change Log

### 2024-01-XX
- ✅ Created comprehensive diagnostic script
- ✅ Created automated fix script
- ✅ Fixed pagination issue (limit 50 → 1000)
- ✅ Added class-specific diagnostic tool
- ✅ Added documentation

---

## Future Enhancements

Planned improvements:
- [ ] Automated backup before fixes
- [ ] Email reports for scheduled checks
- [ ] Web UI for diagnostics
- [ ] Real-time monitoring dashboard
- [ ] Automated fix scheduling
