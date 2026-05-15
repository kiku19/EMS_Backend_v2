import Parent from '../models/Parent.js';
import { ensureDefaultSchool } from './schoolContext.js';
import { piiMatch } from './encryption.js';

/**
 * Generate parent password from student's DOB and admission ID
 * DOB "2010-05-15" becomes "15052010", then appended with admissionId
 * e.g., "15052010ADM2024001"
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

function collectStudentParents(studentDoc) {
  const parentMap = new Map();

  const upsertParent = (parentInfo = {}) => {
    const phone = normalizePhone(parentInfo.phone);
    if (!phone) return;

    const normalized = {
      name: typeof parentInfo.name === 'string' ? parentInfo.name.trim() : '',
      phone,
      email: normalizeEmail(parentInfo.email),
      relationship: normalizeRelationship(parentInfo.relationship),
    };

    const existing = parentMap.get(phone);
    if (!existing) {
      parentMap.set(phone, normalized);
      return;
    }

    parentMap.set(phone, {
      name: existing.name || normalized.name,
      phone,
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
 * Create or update parent accounts for a student.
 * For each parent in the student's parents array,
 * find or create a Parent record, link the child, and set password.
 */
export async function createOrUpdateParentAccount(studentDoc) {
  if (!studentDoc?._id) return;

  const parentsToProcess = collectStudentParents(studentDoc);
  const defaultSchool =
    studentDoc.schoolId || parentsToProcess.length === 0 ? null : await ensureDefaultSchool();
  const targetSchoolId = studentDoc.schoolId || defaultSchool?._id || null;
  const currentPhones = new Set(parentsToProcess.map((parent) => parent.phone));

  const previouslyLinkedParents = await Parent.find({
    'children.studentId': studentDoc._id,
    ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
  });

  for (const linkedParent of previouslyLinkedParents) {
    const linkedPhone = normalizePhone(linkedParent.phone);
    if (currentPhones.has(linkedPhone)) {
      continue;
    }

    linkedParent.children = linkedParent.children.filter(
      (child) => child.studentId.toString() !== studentDoc._id.toString()
    );
    await linkedParent.save();
  }

  if (parentsToProcess.length === 0) return;

  // Generate password from student DOB + admission ID
  const plainPassword = generateParentPassword(studentDoc.dateOfBirth, studentDoc.admissionId);

  for (const parentInfo of parentsToProcess) {
    try {
      const relationship = parentInfo.relationship || 'guardian';

      // Find existing parent by phone (use piiMatch for encrypted phone lookup)
      const parent = await Parent.findOne({
        ...piiMatch('phone', parentInfo.phone),
        ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
      });

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

        await parent.save();
      } else {
        // Create new parent
        const newParent = new Parent({
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
        await newParent.save();
      }
    } catch (err) {
      console.error(
        `⚠️ Error creating/updating parent account for ${parentInfo.phone}:`,
        err.message
      );
    }
  }
}

function normalizeRelationship(rel) {
  if (!rel) return 'guardian';
  const lower = rel.toLowerCase();
  if (lower.includes('father') || lower === 'dad') return 'father';
  if (lower.includes('mother') || lower === 'mom') return 'mother';
  if (lower.includes('guardian')) return 'guardian';
  return 'other';
}
