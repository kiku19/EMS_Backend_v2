import Parent from '../models/Parent.js';
import { Student } from '../database.js';
import { ensureDefaultSchool } from './schoolContext.js';
import { piiMatch } from './encryption.js';

/**
 * Generate parent password from student's DOB and admission ID
 * DOB "2010-05-15" becomes "15052010", then appended with admissionId
 * e.g. "15052010ADM2024001"
 */
export function generateParentPassword(dateOfBirth, admissionId) {
  if (!dateOfBirth || !admissionId) return null;

  // Parse DOB - handle formats like "2010-05-15" or "15/05/2010"
  let day, month, year;
  if (dateOfBirth.includes('-')) {
    const parts = dateOfBirth.split('-');
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      [year, month, day] = parts;
    } else {
      // DD-MM-YYYY
      [day, month, year] = parts;
    }
  } else if (dateOfBirth.includes('/')) {
    const parts = dateOfBirth.split('/');
    [day, month, year] = parts;
  } else {
    return null;
  }

  // Format as DDMMYYYY + admissionId
  const dobPart = `${day.padStart(2, '0')}${month.padStart(2, '0')}${year}`;
  return `${dobPart}${admissionId}`;
}

function normalizePhone(phone) {
  return typeof phone === 'string' ? phone.trim() : '';
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

function normalizeRelationship(rel) {
  if (!rel) return 'guardian';
  const lower = rel.toLowerCase();
  if (lower.includes('father') || lower === 'dad') return 'father';
  if (lower.includes('mother') || lower === 'mom') return 'mother';
  if (lower.includes('guardian')) return 'guardian';
  return 'other';
}

function collectStudentParents(studentDoc) {
  const parentMap = new Map();

  const upsertParent = (parentInfo = {}) => {
    const phone = normalizePhone(parentInfo.phone);
    if (!phone) return;

    const normalized = {
      parentId: parentInfo.parentId || null,
      name: typeof parentInfo.name === 'string' ? parentInfo.name.trim() : '',
      phone,
      email: normalizeEmail(parentInfo.email),
      relationship: normalizeRelationship(parentInfo.relationship),
      isWhatsapp: parentInfo.isWhatsapp ?? true,
      occupation: parentInfo.occupation || undefined,
    };

    const existing = parentMap.get(phone);
    if (!existing) {
      parentMap.set(phone, normalized);
      return;
    }

    parentMap.set(phone, {
      ...existing,
      name: existing.name || normalized.name,
      email: existing.email || normalized.email,
      relationship:
        existing.relationship !== 'guardian' ? existing.relationship : normalized.relationship,
    });
  };

  if (Array.isArray(studentDoc.parents)) {
    for (const parent of studentDoc.parents) {
      upsertParent(parent);
    }
  }

  return Array.from(parentMap.values());
}

/**
 * Sync core parent fields from a Parent document into the matching embedded
 * entry inside Student.parents. Keeps the two systems consistent when the
 * authoritative Parent record is the source of truth.
 */
export async function syncParentToStudent(parentDoc) {
  if (!parentDoc?._id || !parentDoc.children?.length) return;

  const parentId = parentDoc._id;
  const source = {
    name: parentDoc.name,
    phone: parentDoc.phone,
    email: parentDoc.email,
  };

  // Remove undefined values so we don't overwrite existing data with nulls
  Object.keys(source).forEach((key) => {
    if (source[key] === undefined) delete source[key];
  });

  if (Object.keys(source).length === 0) return;

  for (const child of parentDoc.children) {
    const studentId = child.studentId;
    if (!studentId) continue;

    try {
      // Load the student and mutate the embedded parents array so the PII
      // encryption pre-save hook runs. updateOne would leave nested PII in
      // plaintext and break consistency with the rest of the codebase.
      const student = await Student.findById(studentId);
      if (!student || !Array.isArray(student.parents)) continue;

      let changed = false;
      for (const entry of student.parents) {
        if (entry.parentId?.toString?.() !== parentId.toString()) continue;

        for (const key of Object.keys(source)) {
          if (entry[key] !== source[key]) {
            entry[key] = source[key];
            changed = true;
          }
        }
      }

      if (changed) {
        student.markModified('parents');
        await student.save({ validateBeforeSave: false });
      }
    } catch (err) {
      console.error(`⚠️ Error syncing Parent ${parentId} to Student ${studentId}:`, err.message);
    }
  }
}

/**
 * Create or update parent accounts for a student.
 * For each parent in the student's parents array,
 * find or create a Parent record, link the child, and set password.
 * Also writes the matching parentId back into Student.parents so the
 * embedded cache and the canonical Parent collection are reconciled.
 */
export async function createOrUpdateParentAccount(studentDoc, options = {}) {
  if (!studentDoc?._id) return;

  const { session } = options;
  const parentsToProcess = collectStudentParents(studentDoc);
  const defaultSchool =
    studentDoc.schoolId || parentsToProcess.length === 0 ? null : await ensureDefaultSchool();
  const targetSchoolId = studentDoc.schoolId || defaultSchool?._id || null;
  const currentPhones = new Set(parentsToProcess.map((parent) => parent.phone));

  const previouslyLinkedParents = await Parent.find({
    'children.studentId': studentDoc._id,
    ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
  }).session(session);

  // Unlink parents that are no longer associated with this student
  for (const linkedParent of previouslyLinkedParents) {
    const linkedPhone = normalizePhone(linkedParent.phone);
    if (currentPhones.has(linkedPhone)) {
      continue;
    }

    linkedParent.children = linkedParent.children.filter(
      (child) => child.studentId.toString() !== studentDoc._id.toString()
    );
    await linkedParent.save({ session });

    // Clear parentId from the detached Student.parents entry on a best-effort basis
    try {
      await Student.updateOne(
        { _id: studentDoc._id, 'parents.parentId': linkedParent._id },
        { $set: { 'parents.$[elem].parentId': null } },
        { arrayFilters: [{ 'elem.parentId': linkedParent._id }], session }
      );
    } catch (err) {
      console.error(
        `⚠️ Error clearing parentId for detached parent ${linkedParent._id}:`,
        err.message
      );
    }
  }

  if (parentsToProcess.length === 0) return;

  // Generate password from student DOB + admission ID
  const plainPassword = generateParentPassword(studentDoc.dateOfBirth, studentDoc.admissionId);
  const linkedParentIds = [];

  for (const parentInfo of parentsToProcess) {
    try {
      const relationship = parentInfo.relationship || 'guardian';

      // Prefer an existing link by parentId, otherwise fall back to phone match
      let parent = null;
      if (parentInfo.parentId) {
        parent = await Parent.findOne({
          _id: parentInfo.parentId,
          ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
        }).session(session);
      }

      if (!parent) {
        parent = await Parent.findOne({
          ...piiMatch('phone', parentInfo.phone),
          ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
        }).session(session);
      }

      if (parent) {
        // Check if this child is already linked
        const alreadyLinked = parent.children.some(
          (c) => c.studentId.toString() === studentDoc._id.toString()
        );

        if (!alreadyLinked) {
          parent.children.push({
            studentId: studentDoc._id,
            relationship,
            isPrimary: parent.children.length === 0,
          });
        }

        if (parentInfo.name && parent.name !== parentInfo.name) {
          parent.name = parentInfo.name;
        }

        if (parentInfo.email && parent.email !== parentInfo.email) {
          parent.email = parentInfo.email;
        }

        // Set password if not already set and we have one
        if (!parent.password && plainPassword) {
          parent.password = plainPassword;
        }

        if (!parent.schoolId && targetSchoolId) {
          parent.schoolId = targetSchoolId;
        }

        await parent.save({ session });
      } else {
        // Create new parent
        parent = new Parent({
          schoolId: targetSchoolId,
          name: parentInfo.name,
          phone: parentInfo.phone,
          email: parentInfo.email,
          password: plainPassword,
          status: 'active',
          children: [
            {
              studentId: studentDoc._id,
              relationship,
              isPrimary: true,
            },
          ],
        });
        await parent.save({ session });
      }

      linkedParentIds.push({
        phone: parentInfo.phone,
        parentId: parent._id,
      });
    } catch (err) {
      console.error(
        `⚠️ Error creating/updating parent account for ${parentInfo.phone}:`,
        err.message
      );
    }
  }

  // Write the linked parentId(s) back into the Student.parents array so the
  // two parent data systems are explicitly reconciled.
  if (linkedParentIds.length > 0) {
    try {
      const student = await Student.findById(studentDoc._id).session(session);
      if (student && Array.isArray(student.parents)) {
        let changed = false;
        for (const link of linkedParentIds) {
          const entry = student.parents.find((p) => normalizePhone(p.phone) === link.phone);
          if (entry) {
            const currentId = entry.parentId?.toString?.();
            const newId = link.parentId.toString();
            if (currentId !== newId) {
              entry.parentId = link.parentId;
              changed = true;
            }
          }
        }
        if (changed) {
          student.markModified('parents');
          await student.save({ validateBeforeSave: false, session });
        }
      }
    } catch {
      console.error(`⚠️ Error writing parentId back to Student ${studentDoc._id}:`);
    }
  }
}
