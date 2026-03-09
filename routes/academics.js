import express from 'express';
import { Class, Exam, Result, SchoolSettings, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import resolveClassId from '../utils/resolveClassId.js';
import { resolveAcademicYear } from '../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();

router.get('/exams/class/:classId', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const resolved = await resolveClassId(req.params.classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const exams = await Exam.find({ classId: resolved.classId }).sort({ startDate: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/exams/staff/:staffId', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const assignedClassIds = staff.assignedClasses || [];
    const teacherAssignmentClasses = (staff.teacherAssignments || []).flatMap((assignment) => assignment.classes || []);
    const allClassIds = [...new Set([...assignedClassIds, ...teacherAssignmentClasses])];

    const resolvedClassIds = [];
    for (const classId of allClassIds) {
      const resolved = await resolveClassId(classId.toString());
      if (resolved) {
        resolvedClassIds.push(resolved.classId);
      }
    }

    const exams = await Exam.find({ classId: { $in: resolvedClassIds } }).sort({ startDate: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/exams', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const query = {};

    if (academicYear) {
      query.academicYear = academicYear;
    }
    if (classId) {
      const resolved = await resolveClassId(classId);
      if (resolved) {
        query.classId = resolved.classId;
      }
    }
    if (status) {
      query.status = status;
    }

    const exams = await Exam.find(query).sort({ startDate: -1, createdAt: -1 });
    const classIds = [...new Set(exams.map((exam) => exam.classId).filter(Boolean))];
    const classMap = new Map();

    for (const classIdValue of classIds) {
      try {
        const classDoc = await Class.findById(classIdValue);
        if (classDoc) {
          classMap.set(classIdValue.toString(), classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name);
        }
      } catch {
        // Keep original classId if lookup fails.
      }
    }

    const formattedExams = exams.map((exam) => ({
      ...exam.toObject(),
      id: exam._id,
      className: exam.classId ? classMap.get(exam.classId.toString()) : exam.classId
    }));

    res.json(formattedExams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/exams/:id', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    let className = exam.classId;
    if (exam.classId) {
      try {
        const classDoc = await Class.findById(exam.classId);
        if (classDoc) {
          className = classDoc.section ? `${classDoc.name}-${classDoc.section}` : classDoc.name;
        }
      } catch {
        // Keep original classId if lookup fails.
      }
    }

    res.json({
      ...exam.toObject(),
      id: exam._id,
      className
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/exams', authenticate, checkPermission('academics', 'create'), async (req, res) => {
  try {
    const {
      name,
      type,
      classId,
      subjectId,
      subjectName,
      academicYear,
      startDate,
      endDate,
      maxMarks,
      passingMarks,
      weightage,
      gradingType,
      instructions,
      createdBy
    } = req.body;

    let resolvedClassId = classId;
    if (classId) {
      const resolved = await resolveClassId(classId);
      if (resolved) {
        resolvedClassId = resolved.classId;
      }
    }

    const exam = new Exam({
      name,
      type,
      classId: resolvedClassId,
      subjectId,
      subjectName,
      academicYear: await resolveAcademicYear(academicYear),
      startDate,
      endDate,
      maxMarks: maxMarks || 100,
      passingMarks: passingMarks || 35,
      weightage: weightage || 10,
      gradingType: gradingType || 'numerical',
      instructions,
      createdBy,
      status: 'scheduled'
    });

    await exam.save();
    res.status(201).json(exam);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/exams/:id', authenticate, checkPermission('academics', 'edit'), async (req, res) => {
  try {
    const {
      name,
      type,
      classId,
      subjectId,
      subjectName,
      academicYear,
      startDate,
      endDate,
      maxMarks,
      passingMarks,
      weightage,
      gradingType,
      instructions,
      status
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (classId !== undefined) {
      const resolved = await resolveClassId(classId);
      updateData.classId = resolved ? resolved.classId : classId;
    }
    if (subjectId !== undefined) updateData.subjectId = subjectId;
    if (subjectName !== undefined) updateData.subjectName = subjectName;
    if (academicYear !== undefined) updateData.academicYear = academicYear;
    if (startDate !== undefined) updateData.startDate = startDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (maxMarks !== undefined) updateData.maxMarks = maxMarks;
    if (passingMarks !== undefined) updateData.passingMarks = passingMarks;
    if (weightage !== undefined) updateData.weightage = weightage;
    if (gradingType !== undefined) updateData.gradingType = gradingType;
    if (instructions !== undefined) updateData.instructions = instructions;
    if (status !== undefined) updateData.status = status;

    const exam = await Exam.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/exams/:id', authenticate, checkPermission('academics', 'delete'), async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    await Result.deleteMany({ examId: req.params.id });
    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/exams/:id/publish', authenticate, checkPermission('academics', 'publish'), async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(
      req.params.id,
      { status: 'results_published', isPublished: true, publishedAt: new Date() },
      { new: true }
    );

    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/results/class/:classId/exam/:examId', authenticate, checkPermission('academics', 'view'), async (req, res) => {
  try {
    const { classId, examId } = req.params;

    let resolvedClassId = classId;
    const resolved = await resolveClassId(classId);
    if (resolved) {
      resolvedClassId = resolved.classId;
    }

    let results = await Result.find({ classId: resolvedClassId, examId });
    if (results.length === 0 && resolvedClassId !== classId) {
      results = await Result.find({ classId, examId });
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/results/bulk', authenticate, checkPermission('academics', 'edit'), async (req, res) => {
  try {
    const { results, examId, classId } = req.body;

    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    let resolvedClassId = classId;
    if (classId) {
      const resolved = await resolveClassId(classId);
      if (resolved) {
        resolvedClassId = resolved.classId;
      }
    }

    const bulkOps = results.map((result) => ({
      updateOne: {
        filter: { studentId: result.studentId, examId },
        update: {
          $set: {
            studentId: result.studentId,
            examId,
            classId: resolvedClassId,
            marksObtained: result.marksObtained || 0,
            remarks: result.remarks || '',
            enteredBy: result.enteredBy,
            enteredAt: new Date()
          }
        },
        upsert: true
      }
    }));

    await Result.bulkWrite(bulkOps);
    res.json({ message: 'Results saved successfully', count: results.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/subjects', async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne(buildSchoolScopedQuery(req.user?.schoolId));
    if (settings?.subjects?.length) {
      return res.json(settings.subjects.map((subject, index) => ({
        id: subject._id || index.toString(),
        name: subject.name,
        code: subject.code,
        description: subject.description
      })));
    }

    const classes = await Class.find({}, 'subjects');
    const subjectSet = new Set();
    classes.forEach((classDoc) => {
      if (!Array.isArray(classDoc.subjects)) {
        return;
      }

      classDoc.subjects.forEach((subject) => {
        if (typeof subject === 'string') {
          subjectSet.add(subject);
        } else if (subject?.name) {
          subjectSet.add(subject.name);
        }
      });
    });

    if (subjectSet.size > 0) {
      return res.json(Array.from(subjectSet).map((name, index) => ({
        id: index.toString(),
        name
      })));
    }

    const defaultSubjects = [
      'Mathematics', 'English', 'Science', 'Social Studies', 'Hindi',
      'Physics', 'Chemistry', 'Biology', 'Computer Science', 'History',
      'Geography', 'Economics', 'Accountancy', 'Business Studies'
    ];

    res.json(defaultSubjects.map((name, index) => ({ id: index.toString(), name })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

