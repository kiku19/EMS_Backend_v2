import Parent from '../models/Parent.js';

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

/**
 * Create or update parent accounts for a student.
 * For each parent in the student's parents array (or top-level parentName/parentPhone),
 * find or create a Parent record, link the child, and set password.
 */
export async function createOrUpdateParentAccount(studentDoc) {
  if (!studentDoc) return;

  const parentsToProcess = [];

  // Collect parents from the student's parents array
  if (studentDoc.parents && studentDoc.parents.length > 0) {
    for (const p of studentDoc.parents) {
      if (p.phone) {
        parentsToProcess.push({
          name: p.name,
          phone: p.phone.trim(),
          email: p.email || null,
          relationship: p.relationship || 'guardian'
        });
      }
    }
  }

  // Also check top-level parentPhone if not already covered
  if (studentDoc.parentPhone) {
    const alreadyIncluded = parentsToProcess.some(
      p => p.phone === studentDoc.parentPhone.trim()
    );
    if (!alreadyIncluded) {
      parentsToProcess.push({
        name: studentDoc.parentName || studentDoc.name + "'s Parent",
        phone: studentDoc.parentPhone.trim(),
        email: studentDoc.parentEmail || null,
        relationship: studentDoc.parentRelationship || 'guardian'
      });
    }
  }

  if (parentsToProcess.length === 0) return;

  // Generate password from student DOB + admission ID
  const plainPassword = generateParentPassword(studentDoc.dateOfBirth, studentDoc.admissionId);

  for (const parentInfo of parentsToProcess) {
    try {
      // Normalize relationship to match enum
      const relationship = normalizeRelationship(parentInfo.relationship);

      // Find existing parent by phone
      let parent = await Parent.findOne({ phone: parentInfo.phone });

      if (parent) {
        // Check if this child is already linked
        const alreadyLinked = parent.children.some(
          c => c.studentId.toString() === studentDoc._id.toString()
        );

        if (!alreadyLinked) {
          parent.children.push({
            studentId: studentDoc._id,
            relationship,
            isPrimary: parent.children.length === 0
          });
        }

        // Update email if not set
        if (!parent.email && parentInfo.email) {
          parent.email = parentInfo.email;
        }

        // Set password if not already set and we have one
        if (!parent.password && plainPassword) {
          parent.password = plainPassword;
        }

        await parent.save();
      } else {
        // Create new parent
        const newParent = new Parent({
          name: parentInfo.name,
          phone: parentInfo.phone,
          email: parentInfo.email,
          password: plainPassword,
          status: 'active',
          children: [{
            studentId: studentDoc._id,
            relationship,
            isPrimary: true
          }]
        });
        await newParent.save();
      }
    } catch (err) {
      console.error(`⚠️ Error creating/updating parent account for ${parentInfo.phone}:`, err.message);
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
