# Timetable Management Migrations

This directory contains database migration scripts for the Timetable Management System.

## Available Migrations

### 001_add_timetable_fields.js

**Purpose:** Initial migration to add timetable management fields and collections.

**What it does:**
- Adds `teacherAssignments` field to Staff collection
- Adds `classTag` and `assignedSubjects` fields to Class collection
- Adds metadata fields (`version`, `lastSyncedAt`, `lastModified`, `modifiedBy`) to Timetable collection
- Creates TeacherTimetable collection
- Creates ConflictLog collection
- Creates necessary database indexes
- Generates teacher timetables from existing class timetables

**Usage:**
```bash
cd backend
node migrations/001_add_timetable_fields.js
```

**Prerequisites:**
- MongoDB connection configured in `.env`
- Backup of database created
- Backend server stopped (recommended)

**Expected Output:**
```
🚀 Starting Timetable Management Migration...

✓ Connected to MongoDB

📝 Adding teacherAssignments field to Staff collection...
✓ Updated X staff records

📝 Adding classTag and assignedSubjects fields to Class collection...
✓ Updated X class records

... (more output)

✅ Migration completed successfully!
```

**Time Required:** 5-15 minutes (depending on data size)

---

### rollback_timetable_migration.js

**Purpose:** Rollback the timetable management migration.

**What it does:**
- Removes `teacherAssignments` from Staff collection
- Removes `classTag` and `assignedSubjects` from Class collection
- Removes metadata fields from Timetable collection
- Drops TeacherTimetable collection (⚠️ ALL DATA LOST)
- Drops ConflictLog collection
- Removes indexes

**Usage:**
```bash
cd backend
node migrations/rollback_timetable_migration.js
```

**⚠️ WARNING:**
- This action cannot be undone
- All teacher timetables will be permanently deleted
- All conflict logs will be permanently deleted
- Make sure you have a backup before proceeding

**Interactive Prompts:**
```
Are you sure you want to rollback? (yes/no): yes
Type "ROLLBACK" to confirm: ROLLBACK
```

**Time Required:** 5-10 minutes

---

## Migration Workflow

### Initial Setup

1. **Backup Database**
   ```bash
   mongodump --db school_db --out backup_$(date +%Y%m%d_%H%M%S)
   ```

2. **Stop Backend Server** (recommended)
   ```bash
   pm2 stop school-backend
   ```

3. **Run Migration**
   ```bash
   node migrations/001_add_timetable_fields.js
   ```

4. **Verify Migration**
   ```bash
   node scripts/verify_timetable_setup.js
   ```

5. **Start Backend Server**
   ```bash
   pm2 start school-backend
   ```

6. **Enable Feature**
   ```bash
   # Add to .env
   ENABLE_TIMETABLE_MANAGEMENT=true
   
   # Restart server
   pm2 restart school-backend
   ```

### Rollback Procedure

1. **Backup Current State**
   ```bash
   mongodump --db school_db --out backup_before_rollback_$(date +%Y%m%d_%H%M%S)
   ```

2. **Stop Backend Server**
   ```bash
   pm2 stop school-backend
   ```

3. **Run Rollback**
   ```bash
   node migrations/rollback_timetable_migration.js
   ```

4. **Disable Feature**
   ```bash
   # Update .env
   ENABLE_TIMETABLE_MANAGEMENT=false
   
   # Start server
   pm2 start school-backend
   ```

5. **Verify Rollback**
   ```bash
   # Check that fields are removed
   mongo school_db --eval "db.staff.findOne()"
   ```

---

## Troubleshooting

### Migration Fails with "Connection Error"

**Problem:** Cannot connect to MongoDB

**Solution:**
1. Check MongoDB is running: `systemctl status mongod`
2. Verify connection string in `.env`
3. Check network connectivity
4. Verify credentials

### Migration Fails with "Duplicate Key Error"

**Problem:** Indexes already exist

**Solution:**
1. This is usually safe to ignore
2. Migration will continue with existing indexes
3. If migration fails completely, drop indexes manually:
   ```javascript
   db.timetables.dropIndexes()
   db.teachertimetables.dropIndexes()
   ```
4. Re-run migration

### Migration Completes but Verification Fails

**Problem:** Some checks fail in verification script

**Solution:**
1. Review specific failed checks
2. Check migration logs for errors
3. Manually verify database state:
   ```javascript
   db.staff.findOne()
   db.classes.findOne()
   db.timetables.findOne()
   ```
4. If needed, restore from backup and retry

### Rollback Fails

**Problem:** Rollback script encounters errors

**Solution:**
1. Check error message
2. If safe to continue, manually remove fields:
   ```javascript
   db.staff.updateMany({}, { $unset: { teacherAssignments: "" } })
   db.classes.updateMany({}, { $unset: { classTag: "", assignedSubjects: "" } })
   ```
3. Drop collections:
   ```javascript
   db.teachertimetables.drop()
   db.conflictlogs.drop()
   ```
4. If all else fails, restore from backup

---

## Best Practices

### Before Migration

1. ✅ Create database backup
2. ✅ Test migration on staging environment
3. ✅ Schedule maintenance window
4. ✅ Notify users of downtime
5. ✅ Have rollback plan ready
6. ✅ Review migration script

### During Migration

1. ✅ Monitor migration progress
2. ✅ Watch for errors in output
3. ✅ Keep backup accessible
4. ✅ Don't interrupt migration process
5. ✅ Document any issues

### After Migration

1. ✅ Run verification script
2. ✅ Test basic functionality
3. ✅ Check application logs
4. ✅ Monitor performance
5. ✅ Keep backup for 7 days
6. ✅ Document completion

---

## Migration Checklist

Use this checklist when running migrations:

### Pre-Migration
- [ ] Database backup created
- [ ] Backup verified and accessible
- [ ] Staging environment tested
- [ ] Maintenance window scheduled
- [ ] Users notified
- [ ] Backend server stopped
- [ ] Migration script reviewed

### Migration
- [ ] Migration script executed
- [ ] No errors in output
- [ ] All collections updated
- [ ] Indexes created
- [ ] Teacher timetables generated

### Post-Migration
- [ ] Verification script passed
- [ ] Backend server started
- [ ] Feature flag enabled
- [ ] Basic functionality tested
- [ ] No errors in logs
- [ ] Performance acceptable
- [ ] Users notified of completion

### Rollback (if needed)
- [ ] Rollback reason documented
- [ ] Backup created before rollback
- [ ] Rollback script executed
- [ ] Feature flag disabled
- [ ] System verified working
- [ ] Users notified

---

## Support

For issues or questions:
- Check troubleshooting section above
- Review migration logs
- Contact: dev@school.edu
- Emergency: +1-XXX-XXX-XXXX

---

**Last Updated:** January 2025
