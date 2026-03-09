import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

// Calendar Event Schema
const calendarEventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD format
  type: { type: String, default: 'event' }, // event, meeting, exam, holiday
  startTime: { type: String, default: '' },
  endTime: { type: String, default: '' },
  allDay: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Transform function to convert MongoDB document to plain object with `id`
const transformEvent = (doc) => {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id.toString(),
    title: obj.title,
    date: obj.date,
    type: obj.type || 'event',
    startTime: obj.startTime || '',
    endTime: obj.endTime || '',
    allDay: obj.allDay || false
  };
};

const CalendarEvent = mongoose.models.CalendarEvent || mongoose.model('CalendarEvent', calendarEventSchema);

// GET all calendar events
router.get('/calendar/events', authenticate, checkPermission('timetable', 'view'), async (req, res) => {
  try {
    const events = await CalendarEvent.find().sort({ date: 1, startTime: 1 });
    res.json(events.map(transformEvent));
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// POST create a new calendar event
router.post('/calendar/events', authenticate, checkPermission('timetable', 'create'), async (req, res) => {
  try {
    const { title, date, type, startTime, endTime, allDay } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const event = new CalendarEvent({
      title,
      date,
      type: type || 'event',
      startTime: startTime || '',
      endTime: endTime || '',
      allDay: allDay || false
    });

    await event.save();
    res.json(transformEvent(event));
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

// PUT update a calendar event
router.put('/calendar/events/:id', authenticate, checkPermission('timetable', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const event = await CalendarEvent.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(transformEvent(event));
  } catch (error) {
    console.error('Error updating calendar event:', error);
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

// DELETE a calendar event
router.delete('/calendar/events/:id', authenticate, checkPermission('timetable', 'delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const event = await CalendarEvent.findByIdAndDelete(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

export default router;
