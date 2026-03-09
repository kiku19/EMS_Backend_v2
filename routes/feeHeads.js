import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import FeeHead from '../models/FeeHead.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { Student, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

// Get all fee heads
router.get('/', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear);
    const query = academicYear ? { academicYear } : {};
    const feeHeads = await FeeHead.find(query).sort({ createdAt: -1 });
    res.json(feeHeads);
  } catch (error) {
    console.error('Error fetching fee heads:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get fee head by ID
router.get('/:id', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const feeHead = await FeeHead.findById(req.params.id);
    if (!feeHead) {
      return res.status(404).json({ error: 'Fee head not found' });
    }
    res.json(feeHead);
  } catch (error) {
    console.error('Error fetching fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new fee head
router.post('/', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    const {
      name,
      category,
      amount,
      mandatory,
      description,
      applicableClasses,
      frequency,
      academicYear: requestAcademicYear,
      autoApply
    } = req.body;

    const academicYear = await resolveAcademicYear(requestAcademicYear);

    // Validate required fields
    if (!name || !amount || !applicableClasses || applicableClasses.length === 0) {
      return res.status(400).json({ 
        error: 'Name, amount, and applicable classes are required' 
      });
    }

    // Create fee head
    const feeHead = new FeeHead({
      name,
      category: category || 'Academic',
      amount,
      mandatory: mandatory !== undefined ? mandatory : true,
      description,
      applicableClasses,
      frequency: frequency || 'yearly',
      academicYear,
      autoApply: autoApply !== undefined ? autoApply : true,
    });

    await feeHead.save();
    console.log('✅ Fee head created:', feeHead.name);

    // Auto-apply to existing students if enabled
    if (feeHead.autoApply) {
      await applyFeeHeadToStudents(feeHead);
    }

    res.status(201).json(feeHead);
  } catch (error) {
    console.error('Error creating fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update fee head
router.put('/:id', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const {
      name,
      category,
      amount,
      mandatory,
      description,
      applicableClasses,
      frequency,
      academicYear,
      autoApply,
      isActive
    } = req.body;

    const feeHead = await FeeHead.findByIdAndUpdate(
      req.params.id,
      {
        name,
        category,
        amount,
        mandatory,
        description,
        applicableClasses,
        frequency,
        academicYear,
      autoApply,
        isActive
      },
      { new: true }
    );

    if (!feeHead) {
      return res.status(404).json({ error: 'Fee head not found' });
    }

    console.log('✅ Fee head updated:', feeHead.name);

    // Re-apply to students if autoApply is enabled
    if (feeHead.autoApply && feeHead.isActive) {
      await applyFeeHeadToStudents(feeHead);
    }

    res.json(feeHead);
  } catch (error) {
    console.error('Error updating fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete fee head
router.delete('/:id', authenticate, checkPermission('fees', 'delete'), async (req, res) => {
  try {
    const feeHead = await FeeHead.findByIdAndDelete(req.params.id);
    
    if (!feeHead) {
      return res.status(404).json({ error: 'Fee head not found' });
    }

    // Remove this fee head from all student fee structures
    await StudentFeeStructure.updateMany(
      { 'feeHeads.feeHeadId': req.params.id },
      { $pull: { feeHeads: { feeHeadId: req.params.id } } }
    );

    // Recalculate totals for affected students
    const affectedStructures = await StudentFeeStructure.find({
      'feeHeads.feeHeadId': { $ne: req.params.id }
    });

    for (const structure of affectedStructures) {
      await recalculateStudentFeeStructure(structure._id);
    }

    console.log('✅ Fee head deleted:', feeHead.name);
    res.json({ success: true, message: 'Fee head deleted successfully' });
  } catch (error) {
    console.error('Error deleting fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply fee head to all applicable students
router.post('/:id/apply', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const feeHead = await FeeHead.findById(req.params.id);
    
    if (!feeHead) {
      return res.status(404).json({ error: 'Fee head not found' });
    }

    const result = await applyFeeHeadToStudents(feeHead);
    
    res.json({
      success: true,
      message: `Fee head applied to ${result.studentsUpdated} students`,
      studentsUpdated: result.studentsUpdated
    });
  } catch (error) {
    console.error('Error applying fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to apply fee head to students
async function applyFeeHeadToStudents(feeHead) {
  try {
    console.log(`📋 Applying fee head "${feeHead.name}" to students...`);
    
    // Find all classes that match the applicable classes
    const classes = await Class.find({
      name: { 
        $in: feeHead.applicableClasses.map(c => `Class ${c}`) 
      }
    });

    if (classes.length === 0) {
      console.log('⚠️ No matching classes found');
      return { studentsUpdated: 0 };
    }

    const classIds = classes.map(c => c._id);
    console.log(`📚 Found ${classes.length} matching classes`);

    // Find all students in these classes
    const students = await Student.find({
      classId: { $in: classIds },
      status: 'active'
    });

    console.log(`👥 Found ${students.length} students to update`);

    let studentsUpdated = 0;

    for (const student of students) {
      // Find or create student fee structure
      let feeStructure = await StudentFeeStructure.findOne({
        studentId: student._id,
        academicYear: feeHead.academicYear
      });

      if (!feeStructure) {
        feeStructure = new StudentFeeStructure({
          studentId: student._id,
          classId: student.classId,
          academicYear: feeHead.academicYear,
          feeHeads: []
        });
      }

      // Check if fee head already exists
      const existingIndex = feeStructure.feeHeads.findIndex(
        fh => fh.feeHeadId.toString() === feeHead._id.toString()
      );

      const feeHeadData = {
        feeHeadId: feeHead._id,
        name: feeHead.name,
        category: feeHead.category,
        amount: feeHead.amount,
        mandatory: feeHead.mandatory,
        frequency: feeHead.frequency,
        paidAmount: 0,
        balanceAmount: feeHead.amount,
        status: 'pending'
      };

      if (existingIndex >= 0) {
        // Update existing fee head
        feeStructure.feeHeads[existingIndex] = {
          ...feeStructure.feeHeads[existingIndex].toObject(),
          ...feeHeadData,
          // Preserve payment data
          paidAmount: feeStructure.feeHeads[existingIndex].paidAmount,
          balanceAmount: feeHead.amount - feeStructure.feeHeads[existingIndex].paidAmount,
          status: feeStructure.feeHeads[existingIndex].status
        };
      } else {
        // Add new fee head
        feeStructure.feeHeads.push(feeHeadData);
      }

      // Recalculate totals
      feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
      feeStructure.totalPaid = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
      feeStructure.totalBalance = feeStructure.totalFee - feeStructure.totalPaid - feeStructure.discountApplied;

      // Update overall status
      if (feeStructure.totalBalance <= 0) {
        feeStructure.overallStatus = 'paid';
      } else if (feeStructure.totalPaid > 0) {
        feeStructure.overallStatus = 'partial';
      } else {
        feeStructure.overallStatus = 'pending';
      }

      await feeStructure.save();
      studentsUpdated++;
    }

    console.log(`✅ Updated ${studentsUpdated} students`);
    return { studentsUpdated };
  } catch (error) {
    console.error('Error applying fee head to students:', error);
    throw error;
  }
}

// Helper function to recalculate student fee structure
async function recalculateStudentFeeStructure(structureId) {
  const structure = await StudentFeeStructure.findById(structureId);
  if (!structure) return;

  structure.totalFee = structure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
  structure.totalPaid = structure.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
  structure.totalBalance = structure.totalFee - structure.totalPaid - structure.discountApplied;

  if (structure.totalBalance <= 0) {
    structure.overallStatus = 'paid';
  } else if (structure.totalPaid > 0) {
    structure.overallStatus = 'partial';
  } else {
    structure.overallStatus = 'pending';
  }

  await structure.save();
}

export default router;







