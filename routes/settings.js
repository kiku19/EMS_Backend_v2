import express from 'express';
import { SchoolSettings } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import FeeHead from '../models/FeeHead.js';
import Reminder from '../models/Reminder.js';

const router = express.Router();

// Get school settings
router.get('/school', authenticate, async (req, res) => {
  try {
    let settings = await SchoolSettings.findOne();
    
    // If no settings exist, create default settings
    if (!settings) {
      settings = await SchoolSettings.create({
        schoolName: 'School Name',
        address: '',
        phone: '',
        email: '',
        website: '',
        logo: '',
        academicYearStart: new Date().getFullYear(),
        academicYearEnd: new Date().getFullYear() + 1
      });
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching school settings:', error);
    res.status(500).json({ error: 'Failed to fetch school settings' });
  }
});

// Update school settings
router.put('/school', authenticate, async (req, res) => {
  try {
    let settings = await SchoolSettings.findOne();
    
    if (!settings) {
      settings = await SchoolSettings.create(req.body);
    } else {
      Object.assign(settings, req.body);
      await settings.save();
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Error updating school settings:', error);
    res.status(500).json({ error: 'Failed to update school settings' });
  }
});

// Get holidays
router.get('/holidays', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    res.json(settings?.holidays || []);
  } catch (error) {
    console.error('Error fetching holidays:', error);
    res.status(500).json({ error: 'Failed to fetch holidays' });
  }
});

// Add holiday
router.post('/holidays', authenticate, async (req, res) => {
  try {
    let settings = await SchoolSettings.findOne();
    
    if (!settings) {
      settings = await SchoolSettings.create({ holidays: [req.body] });
    } else {
      settings.holidays = settings.holidays || [];
      settings.holidays.push(req.body);
      await settings.save();
    }
    
    res.json(settings.holidays);
  } catch (error) {
    console.error('Error adding holiday:', error);
    res.status(500).json({ error: 'Failed to add holiday' });
  }
});

// Update holiday
router.put('/holidays/:id', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    const holidayIndex = settings.holidays.findIndex(h => h._id.toString() === req.params.id);
    
    if (holidayIndex === -1) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    
    settings.holidays[holidayIndex] = { ...settings.holidays[holidayIndex], ...req.body };
    await settings.save();
    
    res.json(settings.holidays);
  } catch (error) {
    console.error('Error updating holiday:', error);
    res.status(500).json({ error: 'Failed to update holiday' });
  }
});

// Delete holiday
router.delete('/holidays/:id', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    settings.holidays = settings.holidays.filter(h => h._id.toString() !== req.params.id);
    await settings.save();
    
    res.json(settings.holidays);
  } catch (error) {
    console.error('Error deleting holiday:', error);
    res.status(500).json({ error: 'Failed to delete holiday' });
  }
});

// Get leave types
router.get('/leave-types', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    res.json(settings?.leaveTypes || []);
  } catch (error) {
    console.error('Error fetching leave types:', error);
    res.status(500).json({ error: 'Failed to fetch leave types' });
  }
});

// Add leave type
router.post('/leave-types', authenticate, async (req, res) => {
  try {
    let settings = await SchoolSettings.findOne();
    
    if (!settings) {
      settings = await SchoolSettings.create({ leaveTypes: [req.body] });
    } else {
      settings.leaveTypes = settings.leaveTypes || [];
      settings.leaveTypes.push(req.body);
      await settings.save();
    }
    
    res.json(settings.leaveTypes);
  } catch (error) {
    console.error('Error adding leave type:', error);
    res.status(500).json({ error: 'Failed to add leave type' });
  }
});

// Update leave type
router.put('/leave-types/:id', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    const leaveTypeIndex = settings.leaveTypes.findIndex(lt => lt._id.toString() === req.params.id);
    
    if (leaveTypeIndex === -1) {
      return res.status(404).json({ error: 'Leave type not found' });
    }
    
    settings.leaveTypes[leaveTypeIndex] = { ...settings.leaveTypes[leaveTypeIndex], ...req.body };
    await settings.save();
    
    res.json(settings.leaveTypes);
  } catch (error) {
    console.error('Error updating leave type:', error);
    res.status(500).json({ error: 'Failed to update leave type' });
  }
});

// Delete leave type
router.delete('/leave-types/:id', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    settings.leaveTypes = settings.leaveTypes.filter(lt => lt._id.toString() !== req.params.id);
    await settings.save();
    
    res.json(settings.leaveTypes);
  } catch (error) {
    console.error('Error deleting leave type:', error);
    res.status(500).json({ error: 'Failed to delete leave type' });
  }
});

// Get subjects
router.get('/subjects', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    res.json(settings?.subjects || []);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// Add subject
router.post('/subjects', authenticate, async (req, res) => {
  try {
    let settings = await SchoolSettings.findOne();
    
    if (!settings) {
      settings = await SchoolSettings.create({ subjects: [req.body] });
    } else {
      settings.subjects = settings.subjects || [];
      settings.subjects.push(req.body);
      await settings.save();
    }
    
    res.json(settings.subjects);
  } catch (error) {
    console.error('Error adding subject:', error);
    res.status(500).json({ error: 'Failed to add subject' });
  }
});

// Update subject
router.put('/subjects/:id', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    const subjectIndex = settings.subjects.findIndex(s => s._id.toString() === req.params.id);
    
    if (subjectIndex === -1) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    
    settings.subjects[subjectIndex] = { ...settings.subjects[subjectIndex], ...req.body };
    await settings.save();
    
    res.json(settings.subjects);
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

// Delete subject
router.delete('/subjects/:id', authenticate, async (req, res) => {
  try {
    const settings = await SchoolSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    settings.subjects = settings.subjects.filter(s => s._id.toString() !== req.params.id);
    await settings.save();
    
    res.json(settings.subjects);
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

// ============================================================
// FEE HEADS ENDPOINTS (Under /api/settings/ for frontend compatibility)
// ============================================================

// Get all fee heads
router.get('/fee-heads', authenticate, async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = academicYear ? { academicYear } : {};
    const feeHeads = await FeeHead.find(query).sort({ createdAt: -1 });
    res.json(feeHeads);
  } catch (error) {
    console.error('Error fetching fee heads:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new fee head
router.post('/fee-heads', authenticate, async (req, res) => {
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
      autoApply
    } = req.body;

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
      academicYear: academicYear || '2024-25',
      autoApply: autoApply !== undefined ? autoApply : true,
    });

    await feeHead.save();
    console.log('✅ Fee head created:', feeHead.name);

    res.status(201).json(feeHead);
  } catch (error) {
    console.error('Error creating fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update fee head
router.put('/fee-heads/:id', authenticate, async (req, res) => {
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
    res.json(feeHead);
  } catch (error) {
    console.error('Error updating fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete fee head
router.delete('/fee-heads/:id', authenticate, async (req, res) => {
  try {
    const feeHead = await FeeHead.findByIdAndDelete(req.params.id);

    if (!feeHead) {
      return res.status(404).json({ error: 'Fee head not found' });
    }

    // Remove this fee head from all student fee structures
    const StudentFeeStructure = (await import('../models/StudentFeeStructure.js')).default;
    await StudentFeeStructure.updateMany(
      { 'feeHeads.feeHeadId': req.params.id },
      { $pull: { feeHeads: { feeHeadId: req.params.id } } }
    );

    console.log('✅ Fee head deleted:', feeHead.name);
    res.json({ success: true, message: 'Fee head deleted successfully' });
  } catch (error) {
    console.error('Error deleting fee head:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PAYROLL REMINDER ENDPOINT
// ============================================================

// Get payroll reminder
router.get('/payroll/reminder', authenticate, async (req, res) => {
  try {
    // Get the most recent payroll reminder
    const reminder = await Reminder.findOne({ type: 'payroll', isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    if (!reminder) {
      return res.json({
        shouldShow: false,
        message: ''
      });
    }

    // Check if reminder should be shown based on triggers
    const today = new Date();
    const startDate = new Date(reminder.startDate);
    const endDate = reminder.endDate ? new Date(reminder.endDate) : null;

    // Check if current date is within reminder period
    const isWithinPeriod =
      today >= startDate &&
      (!endDate || today <= endDate);

    // Check if it's time to show the reminder (e.g., 5 days before)
    const daysUntilStart = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));
    const shouldShow = isWithinPeriod || (daysUntilStart <= 5 && daysUntilStart >= 0);

    if (shouldShow && reminder.message) {
      res.json({
        shouldShow: true,
        message: reminder.message,
        daysUntilStart: Math.max(0, daysUntilStart),
        reminderId: reminder._id
      });
    } else {
      res.json({
        shouldShow: false,
        message: ''
      });
    }
  } catch (error) {
    console.error('Error fetching payroll reminder:', error);
    res.status(500).json({ error: 'Failed to fetch payroll reminder' });
  }
});

export default router;
