/**
 * Staff Schema Consolidation
 *
 * Resolves 6 deferred schema issues from the staff module audit:
 *   1.9  - assignedClasses: String[] → resolved to ObjectId refs
 *   1.10 - classTeacherOf: String → ObjectId ref to Class
 *   1.12 - experience/totalExperience redundancy → consolidate to experience (Number)
 *   1.13 - joinDate/dob: String → Date type (stored as *Parsed fields)
 *   1.14 - emergencyContact/emergencyPhone → consolidate to emergencyContacts array
 *   1.15 - staffType/role duplication → consolidate to role only
 *
 * IMPORTANT: Run this migration AFTER deploying the code changes that add
 * both old and new fields to the schema (so the app works during migration).
 */

export const description =
  'Consolidate staff schema: classTeacherOf, experience, dates, emergencyContacts, roles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStringDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    return isNaN(d.getTime()) ? null : d;
  }
  const dmyMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const d = new Date(
      `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}T00:00:00.000Z`
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

const STAFF_TYPE_TO_ROLE = {
  Teaching: 'Teacher',
  'Non-Teaching': 'Administrative',
  Administrative: 'Administrative',
  Admin: 'Admin',
  Teacher: 'Teacher',
  Accountant: 'Accountant',
  Librarian: 'Librarian',
  Principal: 'Principal',
  Receptionist: 'Receptionist',
};

// ---------------------------------------------------------------------------
// up
// ---------------------------------------------------------------------------

export async function up(db, { dryRun }) {
  const staffCollection = db.collection('staffs');
  const classCollection = db.collection('classes');

  const stats = {
    total: 0,
    classTeacherOfMigrated: 0,
    experienceMigrated: 0,
    datesMigrated: 0,
    emergencyContactMigrated: 0,
    staffTypeMigrated: 0,
    assignedClassesMigrated: 0,
    errors: [],
  };

  // Build class lookup: "schoolId:name-section" → ObjectId
  const allClasses = await classCollection
    .find(
      { isDeleted: { $ne: true } },
      { projection: { _id: 1, name: 1, section: 1, schoolId: 1 } }
    )
    .toArray();

  const classLookup = new Map();
  for (const cls of allClasses) {
    const key = `${cls.schoolId}:${cls.name}-${cls.section}`;
    classLookup.set(key, cls._id);
    classLookup.set(`${cls.schoolId}:${cls.name}`, cls._id);
  }

  // Drop old global unique indexes (non-school-scoped)
  const indexesToDrop = ['code_1', 'username_1'];
  for (const indexName of indexesToDrop) {
    try {
      if (!dryRun) await staffCollection.dropIndex(indexName);
      console.log(`    Dropped old index: ${indexName}`);
    } catch (err) {
      if (err.codeName === 'IndexNotFound' || err.code === 27) {
        console.log(`    Index ${indexName} already dropped (OK)`);
      } else {
        console.error(`    Error dropping index ${indexName}: ${err.message}`);
      }
    }
  }

  const cursor = staffCollection.find({});
  let batch = [];
  const BATCH_SIZE = 100;

  const flush = async () => {
    if (batch.length > 0 && !dryRun) {
      await staffCollection.bulkWrite(batch);
    }
    batch = [];
  };

  while (await cursor.hasNext()) {
    const staff = await cursor.next();
    stats.total++;

    const $set = {};
    let changed = false;

    // 1.10: classTeacherOf String → ObjectId
    if (staff.classTeacherOf && typeof staff.classTeacherOf === 'string') {
      const schoolId = staff.schoolId?.toString();
      if (schoolId) {
        let classId = classLookup.get(`${schoolId}:${staff.classTeacherOf}`);
        if (!classId) {
          const parts = staff.classTeacherOf.split('-');
          if (parts.length >= 2) {
            classId = classLookup.get(`${schoolId}:${parts[0]}-${parts[1].toUpperCase()}`);
          }
        }
        if (classId) {
          $set.classTeacherOf = classId;
          stats.classTeacherOfMigrated++;
          changed = true;
        } else {
          stats.errors.push(
            `Staff ${staff._id} (${staff.name}): classTeacherOf "${staff.classTeacherOf}" — no matching class`
          );
        }
      }
    }

    // 1.12: totalExperience → experience
    if (staff.totalExperience && typeof staff.totalExperience === 'string') {
      const parsed = parseFloat(staff.totalExperience);
      if (!isNaN(parsed) && (staff.experience === 0 || staff.experience == null)) {
        $set.experience = parsed;
        stats.experienceMigrated++;
        changed = true;
      }
    }

    // 1.13: joinDate/dob String → Date (stored in *Parsed fields)
    if (staff.joinDate && typeof staff.joinDate === 'string') {
      const parsed = parseStringDate(staff.joinDate);
      if (parsed) {
        $set.joinDateParsed = parsed;
        stats.datesMigrated++;
        changed = true;
      } else {
        stats.errors.push(
          `Staff ${staff._id} (${staff.name}): joinDate "${staff.joinDate}" — unparseable`
        );
      }
    }
    if (staff.dob && typeof staff.dob === 'string') {
      const parsed = parseStringDate(staff.dob);
      if (parsed) {
        $set.dobParsed = parsed;
        changed = true;
      } else {
        stats.errors.push(`Staff ${staff._id} (${staff.name}): dob "${staff.dob}" — unparseable`);
      }
    }

    // 1.14: emergencyContact/emergencyPhone → emergencyContacts array
    if (
      (staff.emergencyContact || staff.emergencyPhone) &&
      (!staff.emergencyContacts || staff.emergencyContacts.length === 0)
    ) {
      $set.emergencyContacts = [
        { name: staff.emergencyContact || '', relationship: '', phone: staff.emergencyPhone || '' },
      ];
      stats.emergencyContactMigrated++;
      changed = true;
    }

    // 1.15: staffType → role
    if (staff.staffType && staff.staffType.length > 0) {
      const currentRoles = Array.isArray(staff.role) ? staff.role : [staff.role].filter(Boolean);
      const staffTypes = Array.isArray(staff.staffType)
        ? staff.staffType
        : [staff.staffType].filter(Boolean);
      const mergedRoles = [...currentRoles];
      for (const st of staffTypes) {
        const mapped = STAFF_TYPE_TO_ROLE[st] || st;
        if (!mergedRoles.includes(mapped)) mergedRoles.push(mapped);
      }
      if (mergedRoles.length !== currentRoles.length) {
        $set.role = mergedRoles;
        stats.staffTypeMigrated++;
        changed = true;
      }
    }

    // 1.9: assignedClasses String[] → ObjectId[]
    if (staff.assignedClasses?.length > 0) {
      const schoolId = staff.schoolId?.toString();
      const hasStrings = staff.assignedClasses.some(
        (c) => typeof c === 'string' && !/^[a-f\d]{24}$/i.test(c)
      );
      if (hasStrings && schoolId) {
        const resolved = [];
        let allResolved = true;
        for (const cls of staff.assignedClasses) {
          if (/^[a-f\d]{24}$/i.test(cls)) {
            resolved.push(cls);
          } else {
            const classId = classLookup.get(`${schoolId}:${cls}`);
            if (classId) {
              resolved.push(classId.toString());
            } else {
              allResolved = false;
              stats.errors.push(
                `Staff ${staff._id} (${staff.name}): assignedClass "${cls}" — no match`
              );
            }
          }
        }
        if (allResolved && resolved.length > 0) {
          $set.assignedClasses = resolved;
          stats.assignedClassesMigrated++;
          changed = true;
        }
      }
    }

    if (changed) {
      batch.push({ updateOne: { filter: { _id: staff._id }, update: { $set } } });
      if (batch.length >= BATCH_SIZE) await flush();
    }
  }

  await flush();

  console.log(`    Processed: ${stats.total} staff`);
  console.log(`    classTeacherOf migrated : ${stats.classTeacherOfMigrated}`);
  console.log(`    experience consolidated : ${stats.experienceMigrated}`);
  console.log(`    dates parsed            : ${stats.datesMigrated}`);
  console.log(`    emergencyContacts built : ${stats.emergencyContactMigrated}`);
  console.log(`    staffType→role merged   : ${stats.staffTypeMigrated}`);
  console.log(`    assignedClasses resolved: ${stats.assignedClassesMigrated}`);
  if (stats.errors.length > 0) {
    console.warn(`    Warnings (${stats.errors.length}):`);
    stats.errors.forEach((e) => console.warn(`      - ${e}`));
  }
}

// ---------------------------------------------------------------------------
// down — not reversible (data shape change)
// ---------------------------------------------------------------------------

export async function down(_db, { dryRun }) {
  console.log(
    '    Staff schema consolidation is not reversible. ' +
      'Restore from a database backup to undo this migration.'
  );
  if (dryRun) console.log('    (dry-run: no action taken)');
}
