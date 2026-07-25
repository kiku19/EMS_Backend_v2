import mongoose from 'mongoose';
import crypto from 'crypto';
import Parent from '../models/Parent.js';
import { Student } from '../database.js';
import { piiMatch } from './encryption.js';

// Unambiguous alphabet (no 0/O/1/I/l) for human-readable random passwords.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Generate a random, unpredictable parent password.
 *
 * NOTE: The (dateOfBirth, admissionId) parameters are accepted for backwards
 * signature compatibility but are intentionally NOT used to derive the
 * password — those values are public student PII and produced a deterministic,
 * guessable password. The password is now generated from cryptographically
 * secure randomness (crypto.randomInt).
 *
 * @param {string} [dateOfBirth] - ignored (kept for signature compatibility)
 * @param {string} [admissionId] - ignored (kept for signature compatibility)
 * @returns {string} a random 10-character alphanumeric password
 */
export function generateParentPassword(dateOfBirth, admissionId) {
  // Parameters are intentionally unused; see JSDoc above.
  void dateOfBirth;
  void admissionId;

  const length = 10;
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[crypto.randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return password;
}

function normalizePhone(phone) {
  return typeof phone === 'string' ? phone.trim() : '';
}

function normalizeEmail(email) {
  // Treat a form's blank optional email as absent. Keeping it as an empty
  // string makes every no-email guardian compete for the same unique value in
  // legacy databases, blocking otherwise valid student admissions.
  return typeof email === 'string' ? email.trim().toLowerCase() || null : null;
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
async function syncParentToStudentInSession(parentDoc, session) {
  if (!parentDoc?._id || !parentDoc.children?.length) return;
  if (!parentDoc.schoolId) {
    throw new Error('schoolId is required to synchronize a parent account');
  }

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

    // Load the student and mutate the embedded parents array so the PII
    // encryption pre-save hook runs. The school predicate is mandatory: even
    // a corrupt/forged Parent.children link cannot update another tenant.
    const student = await Student.findOne({
      _id: studentId,
      schoolId: parentDoc.schoolId,
    }).session(session);
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
      await student.save({ validateBeforeSave: false, session });
    }
  }
}

export async function syncParentToStudent(parentDoc, options = {}) {
  if (options.session) {
    return syncParentToStudentInSession(parentDoc, options.session);
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction((transactionSession) =>
      syncParentToStudentInSession(parentDoc, transactionSession)
    );
  } finally {
    await session.endSession();
  }
}

/**
 * Create or update parent accounts for a student.
 * For each parent in the student's parents array,
 * find or create a Parent record, link the child, and set password.
 * Also writes the matching parentId back into Student.parents so the
 * embedded cache and the canonical Parent collection are reconciled.
 */
async function reconcileParentAccountsInSession(studentDoc, session) {
  if (!studentDoc?._id) return;

  const parentsToProcess = collectStudentParents(studentDoc);
  const targetSchoolId = studentDoc.schoolId;
  if (!targetSchoolId) {
    throw new Error('schoolId is required to synchronize parent accounts');
  }
  const currentPhones = new Set(parentsToProcess.map((parent) => parent.phone));

  const previouslyLinkedParents = await Parent.find({
    'children.studentId': studentDoc._id,
    schoolId: targetSchoolId,
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

    await Student.updateOne(
      {
        _id: studentDoc._id,
        schoolId: targetSchoolId,
        'parents.parentId': linkedParent._id,
      },
      { $set: { 'parents.$[elem].parentId': null } },
      { arrayFilters: [{ 'elem.parentId': linkedParent._id }], session }
    );
  }

  if (parentsToProcess.length === 0) return;

  // Generate password from student DOB + admission ID
  const plainPassword = generateParentPassword(studentDoc.dateOfBirth, studentDoc.admissionId);
  const linkedParentIds = [];

  for (const parentInfo of parentsToProcess) {
    const relationship = parentInfo.relationship || 'guardian';

    // Prefer an existing link by parentId, otherwise fall back to a phone match
    // within the same school. A parent id from another tenant is never reused.
    let parent = null;
    if (parentInfo.parentId) {
      parent = await Parent.findOne({
        _id: parentInfo.parentId,
        schoolId: targetSchoolId,
      }).session(session);
    }

    if (!parent) {
      parent = await Parent.findOne({
        ...piiMatch('phone', parentInfo.phone),
        schoolId: targetSchoolId,
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
  }

  // Write the linked parentId(s) back into the Student.parents array so the
  // two parent data systems are explicitly reconciled.
  if (linkedParentIds.length > 0) {
    const student = await Student.findOne({
      _id: studentDoc._id,
      schoolId: targetSchoolId,
    }).session(session);
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
  }
}

export async function createOrUpdateParentAccount(studentDoc, options = {}) {
  if (options.session) {
    return reconcileParentAccountsInSession(studentDoc, options.session);
  }

  // Standalone callers (bulk parent creation, AI-assisted student creation,
  // maintenance scripts) receive the same all-or-nothing guarantee as the
  // student create/update routes instead of committing one side at a time.
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction((transactionSession) =>
      reconcileParentAccountsInSession(studentDoc, transactionSession)
    );
  } finally {
    await session.endSession();
  }
}
