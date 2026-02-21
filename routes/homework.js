import express from 'express';
import Homework from '../models/Homework.js';
import { authenticate } from '../middleware/auth.js';
import { Student } from '../database.js';

const router = express.Router();

// Get all homework for a teacher
router.get('/teacher/:teacherId', authenticate, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status, classId } = req.query;

    const query = { teacherId };
    if (status) query.status = status;
    if (classId) query.classId = classId;

    const homework = await Homework.find(query)
      .populate('classId', 'name section')
      .sort({ dueDate: -1 });

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all homework for a class (for students/parents)
router.get('/class/:classId', authenticate, async (req, res) => {
  try {
    const { classId } = req.params;
    const { status = 'active' } = req.query;

    const homework = await Homework.find({
      classId,
      status,
      dueDate: { $gte: new Date() }
    })
      .populate('teacherId', 'name')
      .populate('classId', 'name section')
      .sort({ dueDate: 1 });

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get homework by ID
router.get('/:id', async (req, res) => {
  try {
    const homework = await Homework.findById(req.params.id)
      .populate('teacherId', 'name email')
      .populate('classId', 'name section')
      .populate('submissions.studentId', 'name rollNo admissionId');

    if (!homework) {
      return res.status(404).json({ error: 'Homework not found' });
    }

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create homework (teacher)
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, subject, classId, teacherId, dueDate, attachments, sentToParents } = req.body;

    // Validation
    if (!title || !description || !subject) {
      return res.status(400).json({ error: 'Title, description, and subject are required' });
    }

    if (!classId) {
      return res.status(400).json({ error: 'Class ID is required. Please ensure you are assigned to a class.' });
    }

    if (!teacherId) {
      return res.status(400).json({ error: 'Teacher ID is required' });
    }

    // Validate and parse dueDate
    let parsedDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default to 7 days from now
    if (isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ error: 'Invalid due date format. Use YYYY-MM-DD or ISO format.' });
    }

    const homework = new Homework({
      title,
      description,
      subject,
      classId,
      teacherId,
      dueDate: parsedDueDate,
      attachments: attachments || [],
      sentToParents: sentToParents !== false
    });

    await homework.save();

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    io.emit('homework_created', {
      homeworkId: homework._id,
      classId,
      teacherId,
      title,
      subject,
      dueDate,
      timestamp: new Date()
    });

    // Send push notification to students' parents
    try {
      const pushNotificationService = require('../services/pushNotificationService');
      const PushToken = require('../models/PushToken');

      // Get students in this class
      // FIXED: Filter by isDeleted for consistency
      const students = await Student.find({ classId, status: 'active', isDeleted: { $ne: true } });

      // Get parents of these students (you may need to adjust based on your parent linking)
      // For now, we'll send to all staff as an example
      await pushNotificationService.sendToMultipleUsers(
        [teacherId], // Send to teacher as confirmation
        'Homework Created',
        `${title} has been assigned for ${subject}`,
        {
          type: 'homework',
          homeworkId: homework._id,
          classId,
          subject,
          dueDate,
        }
      );
    } catch (error) {
      console.error('Error sending push notification:', error);
    }

    const populatedHomework = await Homework.findById(homework._id)
      .populate('classId', 'name section')
      .populate('teacherId', 'name');

    res.status(201).json(populatedHomework);
  } catch (error) {
    console.error('Error creating homework:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.name === 'ValidationError' ? error.errors : undefined
    });
  }
});

// Update homework
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, description, subject, dueDate, attachments, status } = req.body;

    const homework = await Homework.findByIdAndUpdate(
      req.params.id,
      {
        title,
        description,
        subject,
        dueDate,
        attachments,
        status,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('classId', 'name section').populate('teacherId', 'name');

    if (!homework) {
      return res.status(404).json({ error: 'Homework not found' });
    }

    res.json(homework);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit homework (student)
router.post('/:id/submit', async (req, res) => {
  try {
    const { studentId, attachments, remarks } = req.body;

    const homework = await Homework.findById(req.params.id);

    if (!homework) {
      return res.status(404).json({ error: 'Homework not found' });
    }

    // Check if already submitted
    const existingSubmission = homework.submissions.find(
      s => s.studentId.toString() === studentId
    );

    if (existingSubmission) {
      // Update existing submission
      existingSubmission.attachments = attachments;
      existingSubmission.remarks = remarks;
      existingSubmission.submittedAt = new Date();
    } else {
      // Add new submission
      homework.submissions.push({
        studentId,
        attachments,
        remarks,
        submittedAt: new Date()
      });
    }

    await homework.save();

    res.json({ success: true, message: 'Homework submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Grade homework submission (teacher)
router.post('/:id/grade', authenticate, async (req, res) => {
  try {
    const { studentId, marks, remarks } = req.body;

    const homework = await Homework.findById(req.params.id);

    if (!homework) {
      return res.status(404).json({ error: 'Homework not found' });
    }

    const submission = homework.submissions.find(
      s => s.studentId.toString() === studentId
    );

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    submission.marks = marks;
    if (remarks) submission.remarks = remarks;

    await homework.save();

    res.json({ success: true, message: 'Homework graded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete homework
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const homework = await Homework.findByIdAndDelete(req.params.id);

    if (!homework) {
      return res.status(404).json({ error: 'Homework not found' });
    }

    res.json({ success: true, message: 'Homework deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
