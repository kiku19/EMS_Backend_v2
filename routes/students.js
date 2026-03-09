import express from 'express';
import mongoose from 'mongoose';
import { Class, Result, Remark, Student, StudentFeeStructure, getNextAdmissionId } from '../database.js';
import TrashItem from '../models/TrashItem.js';
import FeeHead from '../models/FeeHead.js';
import { createOrUpdateParentAccount } from '../utils/parentAccountHelper.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validate, schemas } from '../middleware/validation.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { resolveAcademicYear } from '../utils/academicYear.js';

const router = express.Router();

function processParents(parents = []) {
  return parents.map((parent) => ({
    ...parent,
    isWhatsapp: parent.isWhatsapp || false
  }));
}

function cleanObject(object) {
  Object.keys(object).forEach((key) => {
    if (object[key] === undefined) {
      delete object[key];
      return;
    }

    if (
      typeof object[key] === 'object' &&
      object[key] !== null &&
      !Array.isArray(object[key]) &&
      Object.keys(object[key]).length === 0
    ) {
      delete object[key];
    }
  });
}

function formatStudentClass(student) {
  if (!student.classId || typeof student.classId === 'string') {
    return null;
  }

  const className = student.classId.name.replace('Class ', '');
  return student.classId.section ? `${className}-${student.classId.section}` : className;
}

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getStudentListSort(sortBy = 'name', sortOrder = 'asc') {
  const direction = ['desc', 'descending'].includes(String(sortOrder).toLowerCase()) ? -1 : 1;

  switch (sortBy) {
    case 'rollNo':
      return { isPinned: -1, pinnedAt: -1, rollNo: direction, name: 1 };
    case 'class':
      return { isPinned: -1, pinnedAt: -1, 'classId.name': direction, 'classId.section': direction, rollNo: 1, name: 1 };
    case 'name':
    default:
      return { isPinned: -1, pinnedAt: -1, name: direction, rollNo: 1 };
  }
}

async function buildStudentListQuery({ classId, status, academicYear, search, feeStatus }, resolvedAcademicYear) {
  const conditions = [{ isDeleted: { $ne: true } }];

  if (classId) {
    conditions.push({
      classId: mongoose.Types.ObjectId.isValid(classId)
        ? new mongoose.Types.ObjectId(classId)
        : classId
    });
  }

  if (status && status !== 'all') {
    conditions.push({ status });
  }

  if (academicYear && academicYear !== 'all') {
    conditions.push({ academicYear });
  }

  if (search?.trim()) {
    const trimmedSearch = search.trim();
    const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
    const numericSearch = Number.parseInt(trimmedSearch, 10);
    conditions.push({
      $or: [
        { name: searchRegex },
        { admissionId: searchRegex },
        { email: searchRegex },
        { parentName: searchRegex },
        { parentPhone: searchRegex },
        ...(Number.isNaN(numericSearch) ? [] : [{ rollNo: numericSearch }])
      ]
    });
  }

  if (feeStatus && feeStatus !== 'all') {
    const matchingFeeStudentIds = await StudentFeeStructure.find({
      academicYear: resolvedAcademicYear,
      overallStatus: feeStatus
    }).distinct('studentId');

    conditions.push({
      $or: [
        { _id: { $in: matchingFeeStudentIds } },
        { feeStatus }
      ]
    });
  }

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

async function initializeFeeStructure(student) {
  const existingFeeStructure = await StudentFeeStructure.findOne({
    studentId: student._id,
    academicYear: student.academicYear || CURRENT_ACADEMIC_YEAR
  });

  if (existingFeeStructure) {
    return;
  }

  const classInfo = await Class.findById(student.classId);
  if (!classInfo) {
    return;
  }

  const classNumber = classInfo.name.replace('Class ', '');
  const applicableFeeHeads = await FeeHead.find({
    applicableClasses: classNumber,
    academicYear: student.academicYear || CURRENT_ACADEMIC_YEAR,
    isActive: true
  });

  const feeStructure = new StudentFeeStructure({
    studentId: student._id,
    classId: student.classId,
    academicYear: student.academicYear || CURRENT_ACADEMIC_YEAR,
    feeHeads: applicableFeeHeads.map((feeHead) => ({
      feeHeadId: feeHead._id,
      name: feeHead.name,
      category: feeHead.category,
      amount: feeHead.amount,
      mandatory: feeHead.mandatory,
      frequency: feeHead.frequency,
      paidAmount: 0,
      balanceAmount: feeHead.amount,
      status: 'pending'
    }))
  });

  feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, feeHead) => sum + feeHead.amount, 0);
  feeStructure.totalPaid = 0;
  feeStructure.totalBalance = feeStructure.totalFee;
  feeStructure.overallStatus = 'pending';

  await feeStructure.save();
}

router.post('/:id/documents', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { name, type, url, uploadDate, category, front, back } = req.body;

    const newDocument = {
      id: new mongoose.Types.ObjectId().toString(),
      name,
      type,
      category: category || type,
      uploadDate: uploadDate || new Date().toISOString(),
      size: req.body.size || 'Unknown',
      date: new Date().toLocaleDateString()
    };

    if (front && back) {
      newDocument.front = { url: front.url, uploadDate: front.uploadDate || new Date().toISOString() };
      newDocument.back = { url: back.url, uploadDate: back.uploadDate || new Date().toISOString() };
    } else if (url) {
      newDocument.url = url;
      newDocument.uploadDate = uploadDate || new Date().toISOString();
    }

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $push: { documents: newDocument } },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ success: true, documents: student.documents || [] });
  } catch (error) {
    console.error('Error adding document:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id/documents/:docId', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $pull: { documents: { id: req.params.docId } } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ success: true, documents: student.documents || [] });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/photo', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { photo: req.body.photo },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ success: true, photo: student.photo });
  } catch (error) {
    console.error('Error updating photo:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/fix-documents', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const fixedDocuments = (student.documents || [])
      .filter((document) => document.url && document.name)
      .map((document) => ({
        ...document,
        id: document.id || new mongoose.Types.ObjectId().toString(),
        date: document.date || new Date(document.uploadDate || Date.now()).toLocaleDateString(),
        size: document.size || 'Unknown'
      }));

    const updatedStudent = await Student.findByIdAndUpdate(
      req.params.id,
      { documents: fixedDocuments },
      { new: true }
    );

    console.log('Documents field fixed:', fixedDocuments.length, 'valid documents');
    res.json({
      success: true,
      message: 'Documents field fixed',
      documents: updatedStudent?.documents || []
    });
  } catch (error) {
    console.error('Error fixing documents:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/class/:classId/fee-status', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear);
    const feeStructures = await StudentFeeStructure.find({
      classId: req.params.classId,
      academicYear
    }).populate('studentId', 'name admissionId rollNo');

    const result = feeStructures.map((feeStructure) => ({
      studentId: feeStructure.studentId._id,
      studentName: feeStructure.studentId.name,
      admissionId: feeStructure.studentId.admissionId,
      rollNo: feeStructure.studentId.rollNo,
      totalFee: feeStructure.totalFee,
      totalPaid: feeStructure.totalPaid,
      totalBalance: feeStructure.totalBalance,
      overallStatus: feeStructure.overallStatus
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const {
      classId,
      page = 1,
      limit = 50,
      search = '',
      status = 'all',
      feeStatus = 'all',
      academicYear = 'all',
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (pageNum - 1) * limitNum;
    const resolvedAcademicYear = await resolveAcademicYear(academicYear);
    const query = await buildStudentListQuery({
      classId,
      status,
      academicYear,
      search,
      feeStatus
    }, resolvedAcademicYear);
    const sort = getStudentListSort(sortBy, sortOrder);

    const total = await Student.countDocuments(query);
    let students;

    if (sortBy === 'class') {
      students = await Student.aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'classes',
            localField: 'classId',
            foreignField: '_id',
            as: 'classId'
          }
        },
        {
          $unwind: {
            path: '$classId',
            preserveNullAndEmptyArrays: true
          }
        },
        { $sort: sort },
        { $skip: skip },
        { $limit: limitNum }
      ]);
    } else {
      students = await Student.find(query)
        .populate('classId', 'name section')
        .sort(sort)
        .limit(limitNum)
        .skip(skip)
        .lean();
    }

    const studentIds = students.map((student) => student._id);
    const feeStructures = await StudentFeeStructure.find({
      studentId: { $in: studentIds },
      academicYear: resolvedAcademicYear
    });

    const feeStatusMap = {};
    feeStructures.forEach((feeStructure) => {
      feeStatusMap[feeStructure.studentId.toString()] = feeStructure.overallStatus || 'pending';
    });

    const formatted = students.map((student) => {
      const classInfo = formatStudentClass(student);
      const currentFeeStatus = feeStatusMap[student._id.toString()] || student.feeStatus;

      return {
        id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        academicYear: student.academicYear,
        rollNo: student.rollNo,
        classId: student.classId?._id?.toString() || student.classId?.toString(),
        class: classInfo,
        className: student.classId ? `${student.classId.name} ${student.classId.section}` : null,
        gender: student.gender,
        dateOfBirth: student.dateOfBirth,
        bloodGroup: student.bloodGroup,
        nationality: student.nationality,
        religion: student.religion,
        category: student.category,
        motherTongue: student.motherTongue,
        phone: student.phone,
        email: student.email,
        address: student.address,
        parentName: student.parentName,
        parentPhone: student.parentPhone,
        parentEmail: student.parentEmail,
        parentRelationship: student.parentRelationship,
        parentOccupation: student.parentOccupation,
        alternatePhone: student.alternatePhone,
        parents: student.parents,
        siblings: student.siblings,
        previousSchool: student.previousSchool,
        tcNumber: student.tcNumber,
        medicalConditions: student.medicalConditions,
        emergencyContactName: student.emergencyContactName,
        emergencyContactPhone: student.emergencyContactPhone,
        transportRequired: student.transportRequired,
        hostelRequired: student.hostelRequired,
        feeStatus: currentFeeStatus,
        status: student.status,
        isPinned: student.isPinned,
        pinnedAt: student.pinnedAt,
        documents: student.documents,
        photo: student.photo,
      };
    });

    res.json({
      data: formatted,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/next-admission-id', authenticate, async (req, res) => {
  try {
    const admissionId = await getNextAdmissionId();
    res.json({ admissionId });
  } catch (error) {
    console.error('Error generating admission ID:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/fee-summary', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const year = await resolveAcademicYear(req.query.academicYear);
    const feeStructure = await StudentFeeStructure.findOne({
      studentId: req.params.id,
      academicYear: year
    }).populate('feeHeads.feeHeadId');

    if (!feeStructure) {
      return res.json({
        totalFee: 0,
        totalPaid: 0,
        totalPending: 0,
        totalDiscount: 0,
        collectionMode: 'term',
        nextDueDate: null,
        pendingDuesByPeriod: {},
        feeHeads: [],
        overallStatus: 'pending'
      });
    }

    const pendingDuesByPeriod = {};
    feeStructure.feeHeads.forEach((feeHead) => {
      if (feeHead.balanceAmount > 0) {
        const period = feeHead.frequency || 'onetime';
        pendingDuesByPeriod[period] = (pendingDuesByPeriod[period] || 0) + feeHead.balanceAmount;
      }
    });

    res.json({
      totalFee: feeStructure.totalFee,
      totalPaid: feeStructure.totalPaid,
      totalPending: feeStructure.totalBalance,
      totalDiscount: feeStructure.discountApplied || 0,
      collectionMode: 'term',
      nextDueDate: feeStructure.nextDueDate || null,
      pendingDuesByPeriod,
      feeHeads: feeStructure.feeHeads,
      overallStatus: feeStructure.overallStatus
    });
  } catch (error) {
    console.error('Error fetching fee summary:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/results', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const query = {
      studentId: req.params.id,
      isPublished: true
    };

    if (req.query.academicYear) {
      query.academicYear = req.query.academicYear;
    }

    const results = await Result.find(query)
      .populate('examId', 'name type startDate endDate')
      .populate('marks.subjectId', 'name')
      .sort({ createdAt: -1 });

    console.log(`Found ${results.length} results for student ${req.params.id}`);
    res.json(results);
  } catch (error) {
    console.error('Error fetching student results:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/remarks', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const query = { studentId: req.params.id };
    if (req.query.category && req.query.category !== 'all') {
      query.category = req.query.category;
    }

    const remarks = await Remark.find(query)
      .populate('authorId', 'name email')
      .sort({ date: -1 });

    console.log(`Found ${remarks.length} remarks for student ${req.params.id}`);
    res.json(remarks);
  } catch (error) {
    console.error('Error fetching student remarks:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/remarks', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const remark = new Remark({
      studentId: req.params.id,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category || 'general',
      authorId: req.user.userId,
      authorName: req.user.name || 'Unknown',
      sentToParent: req.body.sentToParent || false,
      sentDate: req.body.sentToParent ? new Date() : null
    });

    await remark.save();
    await remark.populate('authorId', 'name email');

    console.log(`Remark created for student ${req.params.id}`);
    res.status(201).json(remark);
  } catch (error) {
    console.error('Error creating student remark:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).populate('classId', 'name section');
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const classInfo = student.classId ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}` : null;
    const className = student.classId ? `${student.classId.name} ${student.classId.section}` : null;

    res.json({
      id: student._id,
      ...student.toObject(),
      class: classInfo,
      className,
    });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, checkPermission('students', 'create'), validate(schemas.createStudent), async (req, res) => {
  try {
    const existingAdmission = await Student.findOne({ admissionId: req.body.admissionId });
    if (existingAdmission) {
      return res.status(409).json({
        error: 'Admission ID already exists',
        field: 'admissionId',
        value: req.body.admissionId
      });
    }

    const classExists = await Class.findById(req.body.classId);
    if (!classExists) {
      return res.status(400).json({
        error: 'Class does not exist',
        field: 'classId',
        value: req.body.classId
      });
    }

    const existingRollNo = await Student.findOne({
      rollNo: req.body.rollNo,
      classId: req.body.classId,
      academicYear: req.body.academicYear
    });

    if (existingRollNo) {
      return res.status(409).json({
        error: 'Roll number already exists in this class for the academic year',
        field: 'rollNo',
        value: req.body.rollNo
      });
    }

    const studentData = {
      name: req.body.name,
      admissionId: req.body.admissionId,
      academicYear: req.body.academicYear,
      rollNo: req.body.rollNo,
      classId: req.body.classId,
      gender: req.body.gender,
      dateOfBirth: req.body.dateOfBirth,
      bloodGroup: req.body.bloodGroup,
      nationality: req.body.nationality,
      religion: req.body.religion,
      category: req.body.category,
      motherTongue: req.body.motherTongue,
      aadhaarNumber: req.body.aadhaarNumber,
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      zipCode: req.body.zipCode,
      parentName: req.body.parentName,
      parentPhone: req.body.parentPhone,
      parentEmail: req.body.parentEmail,
      parentRelationship: req.body.parentRelationship,
      parentOccupation: req.body.parentOccupation,
      alternatePhone: req.body.alternatePhone,
      parents: processParents(req.body.parents || []),
      siblings: req.body.siblings,
      previousSchool: req.body.previousSchool,
      tcNumber: req.body.tcNumber,
      medicalConditions: req.body.medicalConditions,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,
      transportRequired: req.body.transportRequired || false,
      hostelRequired: req.body.hostelRequired || false,
      isWhatsapp: req.body.isWhatsapp || false,
      whatsappNumber: req.body.whatsappNumber,
      feeStatus: req.body.feeStatus || 'pending',
      status: req.body.status || 'active',
      photo: req.body.photo,
      documents: req.body.documents || []
    };

    cleanObject(studentData);

    const student = new Student(studentData);
    await student.save();

    try {
      await createOrUpdateParentAccount(student);
    } catch (parentError) {
      console.error('Error auto-creating parent accounts:', parentError);
    }

    try {
      await initializeFeeStructure(student);
    } catch (feeError) {
      console.error('Error auto-initializing fee structure:', feeError);
    }

    const populatedStudent = await Student.findById(student._id).populate('classId', 'name section');
    const classInfo = formatStudentClass(populatedStudent);

    const io = req.app.get('io');
    if (io) {
      io.emit('student_created', {
        id: populatedStudent._id,
        name: populatedStudent.name,
        admissionId: populatedStudent.admissionId,
        class: classInfo,
        timestamp: new Date()
      });
    }

    res.status(201).json({
      id: populatedStudent._id,
      name: populatedStudent.name,
      admissionId: populatedStudent.admissionId,
      academicYear: populatedStudent.academicYear,
      rollNo: populatedStudent.rollNo,
      classId: populatedStudent.classId?._id,
      class: classInfo,
      status: populatedStudent.status || 'active',
      feeStatus: populatedStudent.feeStatus || 'pending',
      photo: populatedStudent.photo,
      documents: populatedStudent.documents || [],
      ...populatedStudent.toObject()
    });
  } catch (error) {
    console.error('Error creating student:', error);

    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern)[0];
      const fieldLabels = {
        admissionId: 'Admission ID',
        rollNo: 'Roll Number'
      };

      return res.status(409).json({
        error: `${fieldLabels[duplicateField] || duplicateField} already exists`,
        field: duplicateField,
        code: 11000
      });
    }

    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const updateData = {
      name: req.body.name,
      admissionId: req.body.admissionId,
      academicYear: req.body.academicYear,
      rollNo: req.body.rollNo,
      classId: req.body.classId,
      gender: req.body.gender,
      dateOfBirth: req.body.dateOfBirth,
      bloodGroup: req.body.bloodGroup,
      nationality: req.body.nationality,
      religion: req.body.religion,
      category: req.body.category,
      motherTongue: req.body.motherTongue,
      aadhaarNumber: req.body.aadhaarNumber,
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      zipCode: req.body.zipCode,
      parentName: req.body.parentName,
      parentPhone: req.body.parentPhone,
      parentEmail: req.body.parentEmail,
      parentRelationship: req.body.parentRelationship,
      parentOccupation: req.body.parentOccupation,
      alternatePhone: req.body.alternatePhone,
      parents: req.body.parents ? processParents(req.body.parents) : undefined,
      siblings: req.body.siblings,
      previousSchool: req.body.previousSchool,
      tcNumber: req.body.tcNumber,
      medicalConditions: req.body.medicalConditions,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,
      transportRequired: req.body.transportRequired,
      hostelRequired: req.body.hostelRequired,
      isWhatsapp: req.body.isWhatsapp,
      whatsappNumber: req.body.whatsappNumber,
      feeStatus: req.body.feeStatus,
      status: req.body.status,
      photo: req.body.photo,
      documents: Array.isArray(req.body.documents) ? req.body.documents : undefined
    };

    cleanObject(updateData);

    const originalStudent = await Student.findById(req.params.id);
    if (!originalStudent) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = await Student.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate('classId', 'name section');
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    try {
      const classChanged = updateData.classId && updateData.classId !== originalStudent.classId?.toString();
      const academicYearChanged = updateData.academicYear && updateData.academicYear !== originalStudent.academicYear;

      if (classChanged || academicYearChanged) {
        await StudentFeeStructure.deleteMany({ studentId: student._id });
        await initializeFeeStructure(student);
      }

      if (updateData.feeStatus && updateData.feeStatus !== originalStudent.feeStatus) {
        const feeStructure = await StudentFeeStructure.findOne({
          studentId: student._id,
          academicYear: student.academicYear || CURRENT_ACADEMIC_YEAR
        });

        if (feeStructure) {
          feeStructure.overallStatus = updateData.feeStatus;
          await feeStructure.save();
        }
      }
    } catch (feeError) {
      console.error('Error syncing fee structure:', feeError);
    }

    const classFormatted = student.classId
      ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}`
      : student.class || null;

    res.json({
      id: student._id,
      ...student.toObject(),
      class: classFormatted
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, checkPermission('students', 'delete'), async (req, res) => {
  try {
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user.id
      },
      { new: true }
    ).lean();

    if (!student) {
      return res.status(404).json({ error: 'Student not found or already deleted' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const trashItem = await TrashItem.create({
      itemType: 'Student',
      itemId: student._id,
      itemName: student.name,
      deletedBy: req.user.id,
      deletedAt: new Date(),
      expiresAt,
      originalData: {
        _id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        classId: student.classId,
        status: student.status,
      },
      deletionContext: {
        classId: student.classId
      }
    });

    res.json({
      success: true,
      message: 'Student moved to trash',
      expiresAt,
      trashItemId: trashItem._id
    });
  } catch (error) {
    console.error('Error soft deleting student:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/pin', authenticate, async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { isPinned: true, pinnedAt: new Date() },
      { new: true }
    ).populate('classId', 'name section');

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      success: true,
      isPinned: student.isPinned,
      pinnedAt: student.pinnedAt
    });
  } catch (error) {
    console.error('Error pinning student:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/unpin', authenticate, async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { isPinned: false, pinnedAt: null },
      { new: true }
    ).populate('classId', 'name section');

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      success: true,
      isPinned: student.isPinned,
      pinnedAt: student.pinnedAt
    });
  } catch (error) {
    console.error('Error unpinning student:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
