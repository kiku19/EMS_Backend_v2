import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Student } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { scopeBySchool } from './helpers.js';
import { validateZod } from '../../validators/zodHelpers.js';
import { addDocumentSchema } from '../../validators/studentSchema.js';

const router = express.Router();
router.use(authenticate);

router.post(
  '/:id/documents',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(addDocumentSchema),
  async (req, res) => {
    try {
      const { name, type, url, uploadDate, category, front, back } = req.body;

      const scopedStudent = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!scopedStudent) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      const newDocument = {
        id: new mongoose.Types.ObjectId().toString(),
        name,
        type,
        category: category || type,
        uploadDate: uploadDate || new Date().toISOString(),
        size: req.body.size || 'Unknown',
        date: new Date().toLocaleDateString(),
      };

      if (front && back) {
        newDocument.front = {
          url: front.url,
          uploadDate: front.uploadDate || new Date().toISOString(),
        };
        newDocument.back = {
          url: back.url,
          uploadDate: back.uploadDate || new Date().toISOString(),
        };
      } else if (url) {
        newDocument.url = url;
        newDocument.uploadDate = uploadDate || new Date().toISOString();
      }

      const student = await Student.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        { $push: { documents: newDocument } },
        { new: true, runValidators: true }
      );

      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      res.json({ success: true, documents: student.documents || [] });
    } catch (error) {
      console.error('Error adding document:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.delete(
  '/:id/documents/:docId',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    try {
      const scopedStudent = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!scopedStudent) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      const student = await Student.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        { $pull: { documents: { id: req.params.docId } } },
        { new: true }
      );

      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      res.json({ success: true, documents: student.documents || [] });
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

const updatePhotoSchema = z.object({ photo: z.string().url('Photo must be a valid URL').nullable() }).strip();

router.put('/:id/photo', authenticate, checkPermission('students', 'edit'), validateZod(updatePhotoSchema), async (req, res) => {
  try {
    const scopedStudent = await Student.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!scopedStudent) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    const student = await Student.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
      { photo: req.body.photo },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    res.json({ success: true, photo: student.photo });
  } catch (error) {
    console.error('Error updating photo:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/:id/fix-documents',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    try {
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      const fixedDocuments = (student.documents || [])
        .filter((document) => document.name && (document.url || (document.front && document.back)))
        .map((document) => ({
          ...document,
          id: document.id || new mongoose.Types.ObjectId().toString(),
          date: document.date || new Date(document.uploadDate || Date.now()).toLocaleDateString(),
          size: document.size || 'Unknown',
        }));

      const updatedStudent = await Student.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        { documents: fixedDocuments },
        { new: true }
      );

      res.json({
        success: true,
        message: req.t('common:routes.documentsFieldFixed'),
        documents: updatedStudent?.documents || [],
      });
    } catch (error) {
      console.error('Error fixing documents:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
