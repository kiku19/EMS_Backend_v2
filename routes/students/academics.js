import express from 'express';
import { Student, Result, Remark, Parent } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { sanitizeQueryStr, sanitizeString, objectIdParamHandler } from '../../middleware/validation.js';
import { validateZod } from '../../validators/index.js';
import { EVENTS, emitEvent } from '../../utils/socketEvents.js';
import { scopeBySchool, createRemarkSchema, updateRemarkSchema } from './helpers.js';

const router = express.Router();
router.use(authenticate);
router.param('id', objectIdParamHandler);
router.param('remarkId', objectIdParamHandler);

router.get('/:id/results', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const student = await Student.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    const query = {
      studentId: req.params.id,
      schoolId: req.user.schoolId,
      isPublished: true,
    };

    const academicYear = sanitizeQueryStr(req.query.academicYear);
    if (academicYear) {
      query.academicYear = academicYear;
    }

    const results = await Result.find(query)
      .populate('examId', 'name type startDate endDate subjectName subject')
      .populate('marks.subjectId', 'name')
      .sort({ createdAt: -1 });

    res.json(results);
  } catch (error) {
    console.error('Error fetching student results:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/remarks', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const student = await Student.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    const query = {
      schoolId: req.user?.schoolId,
      studentId: req.params.id,
      isDeleted: { $ne: true },
    };
    const category = sanitizeQueryStr(req.query.category);
    if (category && category !== 'all') {
      query.category = category;
    }

    const remarks = await Remark.find(query).populate('authorId', 'name email').sort({ date: -1 });

    res.json(remarks);
  } catch (error) {
    console.error('Error fetching student remarks:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/:id/remarks',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(createRemarkSchema),
  async (req, res) => {
    try {
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      const remark = new Remark({
        schoolId: req.user?.schoolId,
        studentId: req.params.id,
        classId: student.classId,
        title: sanitizeString(req.body.title),
        description: sanitizeString(req.body.description),
        category: req.body.category || 'general',
        authorId: req.user.userId,
        authorName: req.user.name || 'Unknown',
        sentToParent: req.body.sentToParent || false,
        sentDate: req.body.sentToParent ? new Date() : null,
      });

      await remark.save();
      await remark.populate('authorId', 'name email');

      // If sent to parent, emit socket event and create notification
      if (req.body.sentToParent) {
        const io = req.app.get('io');
        emitEvent(io, EVENTS.REMARK_SENT_TO_PARENT, {
          schoolId: req.user.schoolId?.toString(),
          studentId: req.params.id?.toString(),
          remarkId: remark._id.toString(),
          title: remark.title,
          studentName: student.name,
          category: remark.category,
        });

        // Send in-app notification to linked parent(s)
        try {
          const { sendNotification } = await import('../notifications.js');
          const parents = await Parent.find({ 'children.studentId': req.params.id }).select('_id');
          for (const parent of parents) {
            await sendNotification(
              parent._id,
              'Parent',
              'remarks',
              `New remark for ${student.name}`,
              remark.title || remark.description,
              {
                relatedId: remark._id,
                relatedType: 'Remark',
                priority: 'normal',
              }
            );
          }
        } catch (notifError) {
          console.error('Error sending remark notification to parent:', notifError);
          // Don't fail the request if notification fails
        }
      }

      res.status(201).json(remark);
    } catch (error) {
      console.error('Error creating student remark:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// PUT /:id/remarks/:remarkId — Update a remark
router.put(
  '/:id/remarks/:remarkId',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(updateRemarkSchema),
  async (req, res) => {
    try {
      // Verify student belongs to this school
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      // Find the remark scoped to this school and student
      const remark = await Remark.findOne({
        _id: req.params.remarkId,
        studentId: req.params.id,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!remark) {
        return res.status(404).json({ error: 'Remark not found' });
      }

      // Update fields
      remark.title = sanitizeString(req.body.title);
      remark.description = sanitizeString(req.body.description);
      remark.category = req.body.category || 'general';

      // If sentToParent changed from false to true, set sentDate and trigger notification
      const wasSentToParent = remark.sentToParent;
      remark.sentToParent = req.body.sentToParent || false;
      if (!wasSentToParent && remark.sentToParent) {
        remark.sentDate = new Date();
      }

      await remark.save();
      await remark.populate('authorId', 'name email');

      // If newly sent to parent, emit socket event and notify
      if (!wasSentToParent && remark.sentToParent) {
        const io = req.app.get('io');
        emitEvent(io, EVENTS.REMARK_SENT_TO_PARENT, {
          schoolId: req.user.schoolId?.toString(),
          studentId: req.params.id?.toString(),
          remarkId: remark._id.toString(),
          title: remark.title,
          studentName: student.name,
          category: remark.category,
        });

        try {
          const { sendNotification } = await import('../notifications.js');
          const parents = await Parent.find({ 'children.studentId': req.params.id }).select('_id');
          for (const parent of parents) {
            await sendNotification(
              parent._id,
              'Parent',
              'remarks',
              `New remark for ${student.name}`,
              remark.title || remark.description,
              {
                relatedId: remark._id,
                relatedType: 'Remark',
                priority: 'normal',
              }
            );
          }
        } catch (notifError) {
          console.error('Error sending remark notification to parent:', notifError);
        }
      }

      res.json(remark);
    } catch (error) {
      console.error('Error updating student remark:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /:id/remarks/:remarkId — Soft delete a remark
router.delete(
  '/:id/remarks/:remarkId',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    try {
      // Verify student belongs to this school
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      // Find the remark scoped to this school and student
      const remark = await Remark.findOne({
        _id: req.params.remarkId,
        studentId: req.params.id,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!remark) {
        return res.status(404).json({ error: 'Remark not found' });
      }

      // Soft delete
      remark.isDeleted = true;
      await remark.save();

      res.json({ message: 'Remark deleted successfully' });
    } catch (error) {
      console.error('Error deleting student remark:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /:id/remarks/:remarkId/resend — Resend remark notification to parent
router.post(
  '/:id/remarks/:remarkId/resend',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    try {
      // Verify student belongs to this school
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      // Find the remark scoped to this school and student
      const remark = await Remark.findOne({
        _id: req.params.remarkId,
        studentId: req.params.id,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!remark) {
        return res.status(404).json({ error: 'Remark not found' });
      }

      // Mark as sent to parent
      remark.sentToParent = true;
      remark.sentDate = new Date();
      await remark.save();

      // Emit socket event
      const io = req.app.get('io');
      emitEvent(io, EVENTS.REMARK_SENT_TO_PARENT, {
        schoolId: req.user.schoolId?.toString(),
        studentId: req.params.id?.toString(),
        remarkId: remark._id.toString(),
        title: remark.title,
        studentName: student.name,
        category: remark.category,
      });

      // Send in-app notification to linked parent(s)
      try {
        const { sendNotification } = await import('../notifications.js');
        const parents = await Parent.find({ 'children.studentId': req.params.id }).select('_id');
        for (const parent of parents) {
          await sendNotification(
            parent._id,
            'Parent',
            'remarks',
            `New remark for ${student.name}`,
            remark.title || remark.description,
            {
              relatedId: remark._id,
              relatedType: 'Remark',
              priority: 'normal',
            }
          );
        }
      } catch (notifError) {
        console.error('Error sending remark notification to parent:', notifError);
      }

      res.json({ message: 'Remark resent to parent successfully' });
    } catch (error) {
      console.error('Error resending student remark:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
