import express from 'express';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { getDefaultSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const getSettingsQuery = (req) => buildSchoolScopedQuery(req.user?.schoolId);
const findSchoolSettings = (req) => SchoolSettings.findOne(getSettingsQuery(req));

// Get subjects
router.get('/subjects', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    res.json(settings?.subjects || []);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// Add subject
router.post('/subjects', authenticate, checkPermission('settings', 'create'), async (req, res) => {
  try {
    let settings = await findSchoolSettings(req);

    if (!settings) {
      settings = await SchoolSettings.create({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        subjects: [req.body],
      });
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
router.put('/subjects/:id', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    const subjectIndex = settings.subjects.findIndex((s) => s._id.toString() === req.params.id);

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
router.delete(
  '/subjects/:id',
  authenticate,
  checkPermission('settings', 'delete'),
  async (req, res) => {
    try {
      const settings = await findSchoolSettings(req);

      if (!settings) {
        return res.status(404).json({ error: 'Settings not found' });
      }

      settings.subjects = settings.subjects.filter((s) => s._id.toString() !== req.params.id);
      await settings.save();

      res.json(settings.subjects);
    } catch (error) {
      console.error('Error deleting subject:', error);
      res.status(500).json({ error: 'Failed to delete subject' });
    }
  }
);

export default router;
