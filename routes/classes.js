import express from 'express';
import { Class, Staff, Student, getNextRollNumber } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import resolveClassId from '../utils/resolveClassId.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { countActiveStudents, checkClassCapacity } from '../utils/classCapacity.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) return { ...query };
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

/**
 * Sync Staff document when class teacher assignment changes.
 * Clears the old teacher's fields and sets the new teacher's fields.
 */
async function syncClassTeacherStaff({ oldTeacherId, newTeacherId, classDoc }) {
  if (oldTeacherId && String(oldTeacherId) !== String(newTeacherId)) {
    await Staff.findByIdAndUpdate(oldTeacherId, {
      classTeacherOf: null,
      isClassTeacher: false
    });
  }

  if (newTeacherId) {
    await Staff.findByIdAndUpdate(newTeacherId, {
      classTeacherOf: `${classDoc.name}-${classDoc.section}`,
      isClassTeacher: true
    });
  }
}

async function ensureTeacherAvailable(classTeacherId, currentClassId = null) {
  if (classTeacherId === null || classTeacherId === undefined || classTeacherId === '') {
    return null;
  }

  const teacher = await Staff.findById(classTeacherId);
  if (!teacher) {
    return { error: { status: 404, body: { error: 'Teacher not found' } } };
  }

  const query = { classTeacherId };
  if (currentClassId) {
    query._id = { $ne: currentClassId };
  }

  const existingClass = await Class.findOne(query);
  if (existingClass) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Teacher is already assigned as class teacher to another class',
          teacherName: teacher.name,
          teacherCode: teacher.code,
          existingClass: {
            id: existingClass._id,
            name: existingClass.name,
            section: existingClass.section
          },
          message: `${teacher.name} (${teacher.code}) is already assigned to ${existingClass.name} ${existingClass.section}. Please unassign them first.`
        }
      }
    };
  }

  return { teacher };
}

router.get('/public', authenticate, async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const classes = await Class.find(scopeBySchool(schoolId, {})).sort({ name: 1, section: 1 });
    const formatted = classes.map((cls) => ({
      id: cls._id,
      name: cls.name,
      section: cls.section,
      displayName: cls.section ? `${cls.name}-${cls.section}` : cls.name
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const baseQuery = req.query.teacherId ? { classTeacherId: req.query.teacherId } : {};
    const query = scopeBySchool(req.user?.schoolId, baseQuery);
    const classes = await Class.find(query)
      .populate('classTeacherId', 'name')
      .sort({ name: 1, section: 1 });

    const formatted = await Promise.all(classes.map(async (cls) => {
      const studentCount = await countActiveStudents(cls._id, req.user?.schoolId);

      return {
        id: cls._id.toString(),
        name: cls.name,
        section: cls.section,
        subjects: cls.subjects,
        classTeacherId: cls.classTeacherId?._id?.toString(),
        classTeacherName: cls.classTeacherId?.name,
        studentCount,
        academicYear: cls.academicYear,
      };
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, checkPermission('classes', 'create'), async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;
    const validation = await ensureTeacherAvailable(classTeacherId);
    if (validation?.error) {
      return res.status(validation.error.status).json(validation.error.body);
    }

    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;
    const classDoc = new Class({ name, section, classTeacherId, subjects, academicYear, ...(schoolId ? { schoolId } : {}) });
    await classDoc.save();

    // Sync Staff record if a class teacher was assigned at creation
    if (classTeacherId) {
      await syncClassTeacherStaff({ oldTeacherId: null, newTeacherId: classTeacherId, classDoc });
    }

    res.status(201).json({ id: classDoc._id, ...classDoc.toObject() });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        error: 'A class with this name, section, and academic year already exists'
      });
    }

    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/class-teacher', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classTeacherId } = req.body;
    const classDoc = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const validation = await ensureTeacherAvailable(classTeacherId, req.params.id);
    if (validation?.error) {
      return res.status(validation.error.status).json(validation.error.body);
    }

    const oldTeacherId = classDoc.classTeacherId;
    classDoc.classTeacherId = classTeacherId || null;
    await classDoc.save();

    await syncClassTeacherStaff({ oldTeacherId, newTeacherId: classTeacherId, classDoc });

    const io = req.app.get('io');
    if (io) {
      io.emit('class_updated', {
        classId: classDoc._id.toString(),
        name: classDoc.name,
        section: classDoc.section,
        classTeacherId: classDoc.classTeacherId,
        teacher: validation?.teacher?.name || null,
        teacherPhoto: validation?.teacher?.picture || validation?.teacher?.photoURL || validation?.teacher?.photo || null,
        timestamp: new Date()
      });
    }

    res.json({
      id: classDoc._id,
      ...classDoc.toObject(),
      teacherName: validation?.teacher?.name || null,
      teacherPhoto: validation?.teacher?.picture || validation?.teacher?.photoURL || validation?.teacher?.photo || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/settings', authenticate, async (req, res) => {
  try {
    const classDoc = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({
      classId: classDoc._id,
      classTag: classDoc.classTag || '',
      assignedSubjects: classDoc.assignedSubjects || [],
      name: classDoc.name,
      section: classDoc.section
    });
  } catch (error) {
    console.error('Error fetching class settings:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/tag', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classTag } = req.body;
    if (classTag === undefined) {
      return res.status(400).json({ error: 'classTag field is required' });
    }

    const scopedClass = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!scopedClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const classDoc = await Class.findByIdAndUpdate(
      req.params.id,
      { classTag },
      { new: true, runValidators: true }
    );

    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({
      success: true,
      classId: classDoc._id,
      classTag: classDoc.classTag
    });
  } catch (error) {
    console.error('Error updating class tag:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/subjects', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { assignedSubjects } = req.body;
    if (!Array.isArray(assignedSubjects)) {
      return res.status(400).json({ error: 'assignedSubjects must be an array' });
    }

    const scopedClass = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!scopedClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const classDoc = await Class.findByIdAndUpdate(
      req.params.id,
      { assignedSubjects },
      { new: true, runValidators: true }
    );

    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({
      success: true,
      classId: classDoc._id,
      assignedSubjects: classDoc.assignedSubjects
    });
  } catch (error) {
    console.error('Error updating class subjects:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/students', authenticate, async (req, res) => {
  try {
    const resolved = await resolveClassId(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const scopedClass = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: resolved.classId }));
    if (!scopedClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const students = await Student.find(
      scopeBySchool(req.user?.schoolId, { classId: resolved.classId, status: 'active', isDeleted: { $ne: true } })
    ).sort({ rollNo: 1 });

    res.json(students.map((student) => ({ id: student._id, ...student.toObject() })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/next-roll-number', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const rollNumber = await getNextRollNumber(req.params.id);
    res.json({ rollNumber });
  } catch (error) {
    console.error('Error getting next roll number:', error);
    res.status(500).json({ error: 'Failed to get next roll number' });
  }
});

router.get('/:id/capacity', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const result = await checkClassCapacity(req.params.id, req.user?.schoolId);
    if (!result) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({
      classId: result.classData._id,
      name: result.classData.name,
      section: result.classData.section,
      current: result.currentCount,
      capacity: result.capacity,
      available: result.available,
      isFull: result.isFull
    });
  } catch (error) {
    console.error('Error checking class capacity:', error);
    res.status(500).json({ error: 'Failed to check capacity' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const resolved = await resolveClassId(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const classDoc = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { _id: resolved.classId })
    ).populate('classTeacherId', 'name');
    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const studentCount = await countActiveStudents(classDoc._id, req.user?.schoolId);
    res.json({
      id: classDoc._id,
      name: classDoc.name,
      section: classDoc.section,
      subjects: classDoc.subjects,
      classTeacherId: classDoc.classTeacherId?._id,
      classTeacherName: classDoc.classTeacherId?.name,
      studentCount,
      academicYear: classDoc.academicYear,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;
    const validation = await ensureTeacherAvailable(classTeacherId, req.params.id);
    if (validation?.error) {
      return res.status(validation.error.status).json(validation.error.body);
    }

    const scopedCheck = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!scopedCheck) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const oldTeacherId = scopedCheck.classTeacherId;

    const classDoc = await Class.findByIdAndUpdate(
      req.params.id,
      { name, section, classTeacherId, subjects, academicYear },
      { new: true }
    );

    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Sync Staff records when classTeacherId changes via general update
    if (String(oldTeacherId || '') !== String(classTeacherId || '')) {
      await syncClassTeacherStaff({ oldTeacherId, newTeacherId: classTeacherId, classDoc });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('class_updated', {
        classId: classDoc._id.toString(),
        name: classDoc.name,
        section: classDoc.section,
        classTeacherId: classDoc.classTeacherId,
        timestamp: new Date()
      });
    }

    res.json({ id: classDoc._id.toString(), ...classDoc.toObject() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const scopedCheck = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));
    if (!scopedCheck) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const studentCount = await countActiveStudents(req.params.id, req.user?.schoolId);
    if (studentCount > 0) {
      return res.status(400).json({ error: 'Cannot delete class with active students' });
    }

    // Clear the teacher's staff record before deleting the class
    if (scopedCheck.classTeacherId) {
      await syncClassTeacherStaff({ oldTeacherId: scopedCheck.classTeacherId, newTeacherId: null, classDoc: scopedCheck });
    }

    const classDoc = await Class.findByIdAndDelete(req.params.id);
    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
