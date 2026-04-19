import express from 'express';
import { SchoolSettings, Class } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { getDefaultSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';
import { validateZod } from '../../validators/zodHelpers.js';
import {
  createSubjectSchema,
  updateSubjectSchema,
} from '../../validators/settingsSubjectSchema.js';

const router = express.Router();
router.use(authenticate);

const getSettingsQuery = (req) => buildSchoolScopedQuery(req.user?.schoolId);
const findSchoolSettings = (req) => SchoolSettings.findOne(getSettingsQuery(req));

// ── Sync helper: push master subjects into Class.subjects[] ─────────────────
async function syncSubjectsToClasses(schoolId) {
  const settings = await SchoolSettings.findOne(buildSchoolScopedQuery(schoolId));
  if (!settings?.subjects) return { classesUpdated: 0 };

  // Build map: classNumber → [subject names]
  const classSubjectMap = {};
  for (const subject of settings.subjects) {
    for (const classNum of subject.assignedClasses || []) {
      const key = String(classNum);
      if (!classSubjectMap[key]) classSubjectMap[key] = [];
      classSubjectMap[key].push(subject.name);
    }
  }

  const classes = await Class.find(buildSchoolScopedQuery(schoolId, { isDeleted: { $ne: true } }));

  let classesUpdated = 0;
  for (const classDoc of classes) {
    // Extract numeric class level from name (e.g., "Class 5" → "5", "10" → "10")
    const match = classDoc.name.match(/\d+/);
    if (!match) continue;
    const classNum = match[0];
    const masterSubjects = classSubjectMap[classNum] || [];
    if (masterSubjects.length === 0) continue;

    // Merge: master list subjects + any locally-added subjects not in master list
    const allMasterNames = new Set(settings.subjects.map((s) => s.name));
    const localOnly = (classDoc.subjects || []).filter((s) => !allMasterNames.has(s));
    const merged = [...new Set([...masterSubjects, ...localOnly])];

    classDoc.subjects = merged;
    classDoc.assignedSubjects = merged;
    await classDoc.save();
    classesUpdated++;
  }

  return { classesUpdated };
}

// ── GET /subjects ───────────────────────────────────────────────
router.get('/subjects', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    res.json(settings?.subjects || []);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// ── POST /subjects ──────────────────────────────────────────────
router.post(
  '/subjects',
  authenticate,
  checkPermission('settings', 'create'),
  validateZod(createSubjectSchema),
  async (req, res) => {
    try {
      let settings = await findSchoolSettings(req);

      if (!settings) {
        settings = await SchoolSettings.create({
          ...getDefaultSchoolSettings(req.user?.schoolId),
          subjects: [req.body],
        });
      } else {
        settings.subjects = settings.subjects || [];

        // Duplicate code check
        if (req.body.code) {
          const codeUpper = req.body.code.toUpperCase();
          if (settings.subjects.some(s => s.code && s.code.toUpperCase() === codeUpper)) {
            return res.status(409).json({ message: `Subject code "${req.body.code}" is already in use` });
          }
        }
        // Duplicate name check
        const nameLower = req.body.name.toLowerCase();
        if (settings.subjects.some(s => s.name.toLowerCase() === nameLower)) {
          return res.status(409).json({ message: `A subject named "${req.body.name}" already exists` });
        }

        settings.subjects.push(req.body);
        await settings.save();
      }

      // Sync to class documents
      const { classesUpdated } = await syncSubjectsToClasses(req.user?.schoolId);

      res.json({ subjects: settings.subjects, classesUpdated });
    } catch (error) {
      console.error('Error adding subject:', error);
      res.status(500).json({ error: 'Failed to add subject' });
    }
  }
);

// ── PUT /subjects/:id ───────────────────────────────────────────
router.put(
  '/subjects/:id',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(updateSubjectSchema),
  async (req, res) => {
    try {
      const settings = await findSchoolSettings(req);

      if (!settings) {
        return res.status(404).json({ error: 'Settings not found' });
      }

      const subjectIndex = settings.subjects.findIndex((s) => s._id.toString() === req.params.id);

      if (subjectIndex === -1) {
        return res.status(404).json({ error: 'Subject not found' });
      }

      // Duplicate code check (excluding the subject being updated)
      if (req.body.code) {
        const codeUpper = req.body.code.toUpperCase();
        if (settings.subjects.some((s, i) => i !== subjectIndex && s.code && s.code.toUpperCase() === codeUpper)) {
          return res.status(409).json({ message: `Subject code "${req.body.code}" is already in use` });
        }
      }
      // Duplicate name check (excluding the subject being updated)
      if (req.body.name) {
        const nameLower = req.body.name.toLowerCase();
        if (settings.subjects.some((s, i) => i !== subjectIndex && s.name.toLowerCase() === nameLower)) {
          return res.status(409).json({ message: `A subject named "${req.body.name}" already exists` });
        }
      }

      // Merge update into existing subdocument (preserve _id)
      const existing = settings.subjects[subjectIndex].toObject();
      Object.assign(existing, req.body);
      settings.subjects[subjectIndex] = existing;
      await settings.save();

      // Sync to class documents
      const { classesUpdated } = await syncSubjectsToClasses(req.user?.schoolId);

      res.json({ subjects: settings.subjects, classesUpdated });
    } catch (error) {
      console.error('Error updating subject:', error);
      res.status(500).json({ error: 'Failed to update subject' });
    }
  }
);

// ── DELETE /subjects/:id ────────────────────────────────────────
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

      // Find the subject being deleted to remove from classes
      const deletedSubject = settings.subjects.find((s) => s._id.toString() === req.params.id);

      settings.subjects = settings.subjects.filter((s) => s._id.toString() !== req.params.id);
      await settings.save();

      // Remove the deleted subject name from all class documents
      let classesUpdated = 0;
      if (deletedSubject) {
        const classes = await Class.find(
          buildSchoolScopedQuery(req.user?.schoolId, { isDeleted: { $ne: true } })
        );
        for (const classDoc of classes) {
          const hadSubject =
            classDoc.subjects.includes(deletedSubject.name) ||
            classDoc.assignedSubjects.includes(deletedSubject.name);
          if (hadSubject) {
            classDoc.subjects = classDoc.subjects.filter((s) => s !== deletedSubject.name);
            classDoc.assignedSubjects = classDoc.assignedSubjects.filter(
              (s) => s !== deletedSubject.name
            );
            await classDoc.save();
            classesUpdated++;
          }
        }
      }

      res.json({ subjects: settings.subjects, classesUpdated });
    } catch (error) {
      console.error('Error deleting subject:', error);
      res.status(500).json({ error: 'Failed to delete subject' });
    }
  }
);

// ── POST /subjects/sync — manual full resync ────────────────────
router.post(
  '/subjects/sync',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { classesUpdated } = await syncSubjectsToClasses(req.user?.schoolId);
      res.json({ message: 'Subjects synced to classes', classesUpdated });
    } catch (error) {
      console.error('Error syncing subjects:', error);
      res.status(500).json({ error: 'Failed to sync subjects to classes' });
    }
  }
);

export default router;
