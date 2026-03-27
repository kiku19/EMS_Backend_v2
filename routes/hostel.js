import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import Hostel from '../models/Hostel.js';
import HostelRoom from '../models/HostelRoom.js';
import HostelAllocation from '../models/HostelAllocation.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const hostelSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  type: z.enum(['boys', 'girls', 'mixed']),
  wardenName: z.string().trim().optional(),
  wardenPhone: z.string().trim().optional(),
  wardenEmail: z.string().email().optional().or(z.literal('')),
  address: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

const roomSchema = z.object({
  hostelId: objectId,
  roomNumber: z.string().min(1).max(50).trim(),
  floor: z.number().int().min(0).optional(),
  type: z.enum(['single', 'double', 'triple', 'dormitory']).optional(),
  capacity: z.number().int().min(1),
  monthlyFee: z.number().min(0).optional(),
  amenities: z.array(z.string().trim()).optional(),
  description: z.string().trim().optional(),
});

const allocationSchema = z.object({
  hostelId: objectId,
  roomId: objectId,
  studentId: objectId,
  bedNumber: z.string().trim().optional(),
  startDate: z
    .string()
    .min(1)
    .regex(/^\d{4}-\d{2}-\d{2}/, 'startDate must be YYYY-MM-DD format'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'endDate must be YYYY-MM-DD format')
    .optional(),
  academicYear: z.string().optional(),
  monthlyFee: z.number().min(0).optional(),
  notes: z.string().trim().optional(),
});

const vacateSchema = z.object({
  endDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

// ─── Hostels: CRUD ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/hostel/hostels
 */
router.get('/hostels', authenticate, checkPermission('hostel', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { type, search, page = 1, limit = 50 } = req.query;

    const query = buildSchoolScopedQuery(schoolId, { isActive: true });
    if (type) query.type = type;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [{ name: new RegExp(escaped, 'i') }, { wardenName: new RegExp(escaped, 'i') }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [hostels, total] = await Promise.all([
      Hostel.find(query).sort({ name: 1 }).skip(skip).limit(parseInt(limit)),
      Hostel.countDocuments(query),
    ]);

    const parsedLimit = parseInt(limit);
    res.json({
      hostels,
      total,
      page: parseInt(page),
      limit: parsedLimit,
      pages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/hostel/hostels/:id
 */
router.get('/hostels/:id', authenticate, checkPermission('hostel', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const hostel = await Hostel.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
    if (!hostel) return res.status(404).json({ error: 'Hostel not found' });
    res.json({ hostel });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/hostel/hostels
 */
router.post('/hostels', authenticate, checkPermission('hostel', 'create'), async (req, res) => {
  try {
    const data = hostelSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    // Check for duplicate hostel name within same school
    const existing = await Hostel.findOne(
      buildSchoolScopedQuery(schoolId, { name: data.name, isActive: true })
    );
    if (existing) {
      return res.status(409).json({ error: 'A hostel with this name already exists' });
    }

    const hostel = new Hostel({ ...data, schoolId });
    await hostel.save();
    res.status(201).json({ hostel });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/hostel/hostels/:id
 */
router.put('/hostels/:id', authenticate, checkPermission('hostel', 'edit'), async (req, res) => {
  try {
    const data = hostelSchema.partial().parse(req.body);
    const schoolId = req.user.schoolId;

    const hostel = await Hostel.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
    if (!hostel) return res.status(404).json({ error: 'Hostel not found' });

    Object.assign(hostel, data);
    await hostel.save();
    res.json({ hostel });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/hostel/hostels/:id
 * Soft delete — only if no active allocations
 */
router.delete(
  '/hostels/:id',
  authenticate,
  checkPermission('hostel', 'delete'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const hostel = await Hostel.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
      if (!hostel) return res.status(404).json({ error: 'Hostel not found' });

      const activeAllocations = await HostelAllocation.countDocuments(
        buildSchoolScopedQuery(schoolId, { hostelId: req.params.id, status: 'active' })
      );
      if (activeAllocations > 0) {
        return res.status(400).json({ error: 'Cannot delete hostel with active allocations' });
      }

      hostel.isActive = false;
      await hostel.save();

      // Cascade-deactivate all rooms belonging to this hostel
      await HostelRoom.updateMany(buildSchoolScopedQuery(schoolId, { hostelId: req.params.id }), {
        $set: { isActive: false },
      });

      res.json({ message: 'Hostel and its rooms deactivated' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Rooms: CRUD ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/hostel/rooms
 */
router.get('/rooms', authenticate, checkPermission('hostel', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { hostelId, type, available, search, page = 1, limit = 50 } = req.query;

    const query = buildSchoolScopedQuery(schoolId, { isActive: true });
    if (hostelId) query.hostelId = hostelId;
    if (type) query.type = type;
    if (available === 'true') query.$expr = { $lt: ['$occupiedBeds', '$capacity'] };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { roomNumber: new RegExp(escaped, 'i') },
        { description: new RegExp(escaped, 'i') },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [rooms, total] = await Promise.all([
      HostelRoom.find(query)
        .populate('hostelId', 'name type')
        .sort({ hostelId: 1, floor: 1, roomNumber: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      HostelRoom.countDocuments(query),
    ]);

    const parsedLimit = parseInt(limit);
    res.json({
      rooms,
      total,
      page: parseInt(page),
      limit: parsedLimit,
      pages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/hostel/rooms/:id
 */
router.get('/rooms/:id', authenticate, checkPermission('hostel', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const room = await HostelRoom.findOne(
      buildSchoolScopedQuery(schoolId, { _id: req.params.id })
    ).populate('hostelId', 'name type');
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/hostel/rooms
 */
router.post('/rooms', authenticate, checkPermission('hostel', 'create'), async (req, res) => {
  try {
    const data = roomSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    // Verify hostel belongs to school
    const hostel = await Hostel.findOne(
      buildSchoolScopedQuery(schoolId, { _id: data.hostelId, isActive: true })
    );
    if (!hostel) return res.status(404).json({ error: 'Hostel not found' });

    // Check duplicate room number in same hostel (match unique index filter)
    const existing = await HostelRoom.findOne(
      buildSchoolScopedQuery(schoolId, {
        hostelId: data.hostelId,
        roomNumber: data.roomNumber,
        isDeleted: { $ne: true },
      })
    );
    if (existing)
      return res.status(409).json({ error: 'Room number already exists in this hostel' });

    const room = new HostelRoom({ ...data, schoolId });
    await room.save();

    // Update hostel totals
    await Hostel.findByIdAndUpdate(data.hostelId, {
      $inc: { totalRooms: 1, totalCapacity: data.capacity },
    });

    res.status(201).json({ room });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/hostel/rooms/:id
 */
router.put('/rooms/:id', authenticate, checkPermission('hostel', 'edit'), async (req, res) => {
  try {
    const data = roomSchema.partial().omit({ hostelId: true }).parse(req.body);
    const schoolId = req.user.schoolId;

    const room = await HostelRoom.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Prevent reducing capacity below current occupancy
    if (data.capacity !== undefined && data.capacity < room.occupiedBeds) {
      return res.status(400).json({
        error: `Cannot reduce capacity to ${data.capacity}. Room currently has ${room.occupiedBeds} occupied bed(s).`,
      });
    }

    const oldCapacity = room.capacity;
    Object.assign(room, data);
    await room.save();

    // Update hostel totalCapacity if capacity changed
    if (data.capacity !== undefined && data.capacity !== oldCapacity) {
      await Hostel.findByIdAndUpdate(room.hostelId, {
        $inc: { totalCapacity: data.capacity - oldCapacity },
      });
    }

    res.json({ room });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/hostel/rooms/:id
 * Soft delete — only if no active allocations
 */
router.delete('/rooms/:id', authenticate, checkPermission('hostel', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const room = await HostelRoom.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const activeAllocations = await HostelAllocation.countDocuments(
      buildSchoolScopedQuery(schoolId, { roomId: req.params.id, status: 'active' })
    );
    if (activeAllocations > 0) {
      return res.status(400).json({ error: 'Cannot delete room with active allocations' });
    }

    room.isActive = false;
    await room.save();

    await Hostel.findByIdAndUpdate(room.hostelId, {
      $inc: { totalRooms: -1, totalCapacity: -room.capacity },
    });

    res.json({ message: 'Room deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Allocations ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/hostel/allocations
 */
router.get('/allocations', authenticate, checkPermission('hostel', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const {
      hostelId,
      roomId,
      status,
      studentId,
      academicYear,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const query = buildSchoolScopedQuery(schoolId, {});
    if (hostelId) query.hostelId = hostelId;
    if (roomId) query.roomId = roomId;
    if (status) query.status = status;
    if (studentId) query.studentId = studentId;
    if (academicYear) query.academicYear = academicYear;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { studentName: new RegExp(escaped, 'i') },
        { admissionNo: new RegExp(escaped, 'i') },
        { roomNumber: new RegExp(escaped, 'i') },
        { hostelName: new RegExp(escaped, 'i') },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [allocations, total] = await Promise.all([
      HostelAllocation.find(query)
        .populate('studentId', 'name admissionNo rollNo classId')
        .populate('roomId', 'roomNumber floor type capacity')
        .populate('hostelId', 'name type')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      HostelAllocation.countDocuments(query),
    ]);

    const parsedLimit = parseInt(limit);
    res.json({
      allocations,
      total,
      page: parseInt(page),
      limit: parsedLimit,
      pages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/hostel/allocations/:id
 */
router.get(
  '/allocations/:id',
  authenticate,
  checkPermission('hostel', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const allocation = await HostelAllocation.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.id })
      )
        .populate('studentId', 'name admissionNo rollNo')
        .populate('roomId', 'roomNumber floor type capacity')
        .populate('hostelId', 'name type');

      if (!allocation) return res.status(404).json({ error: 'Allocation not found' });
      res.json({ allocation });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/v1/hostel/allocations
 * Allocate a student to a room
 */
router.post('/allocations', authenticate, checkPermission('hostel', 'create'), async (req, res) => {
  try {
    const data = allocationSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    // Check student doesn't already have an active allocation
    const existing = await HostelAllocation.findOne(
      buildSchoolScopedQuery(schoolId, { studentId: data.studentId, status: 'active' })
    );
    if (existing) {
      return res.status(400).json({ error: 'Student already has an active hostel allocation' });
    }

    // Atomically increment occupiedBeds ONLY if room has capacity.
    // Also verify hostelId matches the room's hostelId to prevent mismatched allocations.
    const room = await HostelRoom.findOneAndUpdate(
      buildSchoolScopedQuery(schoolId, {
        _id: data.roomId,
        hostelId: data.hostelId,
        isActive: true,
        $expr: { $lt: ['$occupiedBeds', '$capacity'] },
      }),
      { $inc: { occupiedBeds: 1 } },
      { new: true }
    );
    if (!room) {
      // Determine whether room doesn't exist, doesn't belong to hostel, or is just full
      const roomExists = await HostelRoom.findOne(
        buildSchoolScopedQuery(schoolId, { _id: data.roomId, isActive: true })
      );
      if (!roomExists) return res.status(404).json({ error: 'Room not found' });
      if (roomExists.hostelId.toString() !== data.hostelId) {
        return res.status(400).json({ error: 'Room does not belong to the specified hostel' });
      }
      return res.status(400).json({ error: 'Room is at full capacity' });
    }

    // Fetch denormalized names
    const [hostel, Student] = await Promise.all([
      Hostel.findById(data.hostelId).select('name'),
      (await import('../models/Student.js')).default,
    ]);
    const student = await Student.findOne(
      buildSchoolScopedQuery(schoolId, { _id: data.studentId })
    ).select('name admissionNo');

    const allocation = new HostelAllocation({
      schoolId,
      hostelId: data.hostelId,
      roomId: data.roomId,
      studentId: data.studentId,
      studentName: student?.name,
      admissionNo: student?.admissionNo,
      roomNumber: room.roomNumber,
      hostelName: hostel?.name,
      bedNumber: data.bedNumber,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      academicYear: data.academicYear || undefined,
      monthlyFee: data.monthlyFee ?? room.monthlyFee,
      notes: data.notes,
      status: 'active',
    });

    try {
      await Promise.all([
        allocation.save(),
        Hostel.findByIdAndUpdate(data.hostelId, { $inc: { occupiedBeds: 1 } }),
      ]);
    } catch (saveError) {
      // Rollback the atomic room increment if allocation save fails
      await HostelRoom.findByIdAndUpdate(data.roomId, { $inc: { occupiedBeds: -1 } });
      throw saveError;
    }

    res.status(201).json({ allocation });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/hostel/allocations/:id/vacate
 * Mark student as vacated
 */
router.put(
  '/allocations/:id/vacate',
  authenticate,
  checkPermission('hostel', 'edit'),
  async (req, res) => {
    try {
      const { endDate, notes } = vacateSchema.parse(req.body);
      const schoolId = req.user.schoolId;

      const allocation = await HostelAllocation.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.id, status: 'active' })
      );
      if (!allocation) return res.status(404).json({ error: 'Active allocation not found' });

      allocation.status = 'vacated';
      allocation.endDate = endDate ? new Date(endDate) : new Date();
      if (notes) allocation.notes = notes;

      await Promise.all([
        allocation.save(),
        HostelRoom.findOneAndUpdate(
          { _id: allocation.roomId, occupiedBeds: { $gt: 0 } },
          { $inc: { occupiedBeds: -1 } }
        ),
        Hostel.findOneAndUpdate(
          { _id: allocation.hostelId, occupiedBeds: { $gt: 0 } },
          { $inc: { occupiedBeds: -1 } }
        ),
      ]);

      res.json({ allocation });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: error.errors });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/v1/hostel/students/:studentId/allocation
 * Get active allocation for a student
 */
router.get(
  '/students/:studentId/allocation',
  authenticate,
  checkPermission('hostel', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const allocation = await HostelAllocation.findOne(
        buildSchoolScopedQuery(schoolId, { studentId: req.params.studentId, status: 'active' })
      )
        .populate('roomId', 'roomNumber floor type capacity amenities')
        .populate('hostelId', 'name type wardenName wardenPhone');

      // Return empty object if not allocated (avoid 404 breaking the frontend)
      res.json({ allocation: allocation || null });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/hostel/stats
 */
router.get('/stats', authenticate, checkPermission('hostel', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const schoolObjectId = new mongoose.Types.ObjectId(String(schoolId));

    const [totalHostels, totalRooms, capacityAgg, activeAllocations, vacatedAllocations] =
      await Promise.all([
        Hostel.countDocuments(buildSchoolScopedQuery(schoolId, { isActive: true })),
        HostelRoom.countDocuments(buildSchoolScopedQuery(schoolId, { isActive: true })),
        HostelRoom.aggregate([
          { $match: { schoolId: schoolObjectId, isActive: true } },
          {
            $group: {
              _id: null,
              totalCapacity: { $sum: '$capacity' },
              occupiedBeds: { $sum: '$occupiedBeds' },
            },
          },
        ]),
        HostelAllocation.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'active' })),
        HostelAllocation.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'vacated' })),
      ]);

    const totalCapacity = capacityAgg[0]?.totalCapacity || 0;
    const occupiedBeds = capacityAgg[0]?.occupiedBeds || 0;

    res.json({
      totalHostels,
      totalRooms,
      totalCapacity,
      occupiedBeds,
      availableBeds: totalCapacity - occupiedBeds,
      activeAllocations,
      vacatedAllocations,
      occupancyRate: totalCapacity > 0 ? Math.round((occupiedBeds / totalCapacity) * 100) : 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
