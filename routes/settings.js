import express from 'express';
import { SchoolSettings } from '../database.js';
import { authenticate } from '../middleware/auth.js';

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

export default router;
