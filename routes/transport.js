import express from 'express';
import { z } from 'zod';
import Vehicle from '../models/Vehicle.js';
import TransportRoute from '../models/TransportRoute.js';
import { Student } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const driverSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  licenseNumber: z.string().optional(),
  licenseExpiry: z.string().optional(),
  photo: z.string().optional(),
});

const conductorSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  photo: z.string().optional(),
});

const createVehicleSchema = z.object({
  registrationNumber: z.string().min(1),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  capacity: z.number().int().min(1).optional(),
  color: z.string().optional(),
  status: z.enum(['active', 'inactive', 'maintenance']).optional(),
  driver: driverSchema.optional(),
  conductor: conductorSchema.optional(),
  gpsDeviceId: z.string().optional(),
  notes: z.string().optional(),
});

const updateVehicleSchema = createVehicleSchema.partial();

const stopSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  pickupTime: z.string().optional(),
  dropTime: z.string().optional(),
  order: z.number().int().min(0).optional(),
});

const createRouteSchema = z.object({
  routeName: z.string().min(1),
  routeNumber: z.string().min(1),
  academicYear: z.string().min(1),
  vehicleId: z.string().optional(),
  stops: z.array(stopSchema).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().optional(),
});

const updateRouteSchema = createRouteSchema.partial();

const assignStudentSchema = z.object({
  studentId: z.string().min(1),
  stopId: z.string().optional(),
  pickupActive: z.boolean().optional(),
  dropActive: z.boolean().optional(),
});

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

// ─── Vehicle Routes ───────────────────────────────────────────────────────────

/**
 * GET /transport/vehicles
 * List all vehicles for the school
 */
router.get('/vehicles', authenticate, checkPermission('transport', 'view'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const query = { schoolId: req.user.schoolId, isDeleted: { $ne: true } };

    if (status) query.status = status;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { registrationNumber: regex },
        { make: regex },
        { model: regex },
        { 'driver.name': regex },
      ];
    }

    const vehicles = await Vehicle.find(query).sort({ createdAt: -1 });
    res.json({ data: vehicles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /transport/vehicles
 * Create a new vehicle
 */
router.post(
  '/vehicles',
  authenticate,
  checkPermission('transport', 'create'),
  validateBody(createVehicleSchema),
  async (req, res) => {
    try {
      const data = req.validatedBody;

      const existing = await Vehicle.findOne({
        schoolId: req.user.schoolId,
        registrationNumber: data.registrationNumber,
        isDeleted: { $ne: true },
      });
      if (existing) {
        return res
          .status(409)
          .json({ error: 'A vehicle with this registration number already exists.' });
      }

      const vehicle = new Vehicle({ ...data, schoolId: req.user.schoolId });
      await vehicle.save();
      res.status(201).json({ data: vehicle });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /transport/vehicles/:id
 * Get vehicle by ID
 */
router.get(
  '/vehicles/:id',
  authenticate,
  checkPermission('transport', 'view'),
  async (req, res) => {
    try {
      const vehicle = await Vehicle.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
      res.json({ data: vehicle });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PUT /transport/vehicles/:id
 * Update a vehicle
 */
router.put(
  '/vehicles/:id',
  authenticate,
  checkPermission('transport', 'edit'),
  validateBody(updateVehicleSchema),
  async (req, res) => {
    try {
      const data = req.validatedBody;

      if (data.registrationNumber) {
        const conflict = await Vehicle.findOne({
          schoolId: req.user.schoolId,
          registrationNumber: data.registrationNumber,
          isDeleted: { $ne: true },
          _id: { $ne: req.params.id },
        });
        if (conflict) {
          return res
            .status(409)
            .json({ error: 'Another vehicle with this registration number already exists.' });
        }
      }

      const vehicle = await Vehicle.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
        { $set: data },
        { new: true }
      );
      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
      res.json({ data: vehicle });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE /transport/vehicles/:id
 * Soft-delete a vehicle
 */
router.delete(
  '/vehicles/:id',
  authenticate,
  checkPermission('transport', 'delete'),
  async (req, res) => {
    try {
      const vehicle = await Vehicle.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user.id } },
        { new: true }
      );
      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
      res.json({ message: 'Vehicle deleted successfully.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PATCH /transport/vehicles/:id/gps
 * Update GPS location for a vehicle (called by GPS device/integration)
 */
router.patch('/vehicles/:id/gps', authenticate, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng are required numbers.' });
    }

    const vehicle = await Vehicle.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
      { $set: { lastLocation: { lat, lng }, lastGpsUpdate: new Date() } },
      { new: true }
    );
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    res.json({
      data: { lastLocation: vehicle.lastLocation, lastGpsUpdate: vehicle.lastGpsUpdate },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Route Routes ─────────────────────────────────────────────────────────────

/**
 * GET /transport/routes
 * List all transport routes for the school
 */
router.get('/routes', authenticate, checkPermission('transport', 'view'), async (req, res) => {
  try {
    const { status, academicYear, search } = req.query;
    const query = { schoolId: req.user.schoolId, isDeleted: { $ne: true } };

    if (status) query.status = status;
    if (academicYear) query.academicYear = academicYear;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ routeName: regex }, { routeNumber: regex }];
    }

    const routes = await TransportRoute.find(query)
      .populate(
        'vehicleId',
        'registrationNumber make model capacity driver conductor lastLocation lastGpsUpdate'
      )
      .sort({ routeNumber: 1 });

    res.json({ data: routes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /transport/routes
 * Create a new transport route
 */
router.post(
  '/routes',
  authenticate,
  checkPermission('transport', 'create'),
  validateBody(createRouteSchema),
  async (req, res) => {
    try {
      const data = req.validatedBody;

      const existing = await TransportRoute.findOne({
        schoolId: req.user.schoolId,
        routeNumber: data.routeNumber,
        academicYear: data.academicYear,
        isDeleted: { $ne: true },
      });
      if (existing) {
        return res
          .status(409)
          .json({ error: 'A route with this route number already exists for the academic year.' });
      }

      const route = new TransportRoute({ ...data, schoolId: req.user.schoolId, students: [] });
      await route.save();
      res.status(201).json({ data: route });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /transport/routes/:id
 * Get transport route by ID (includes populated students)
 */
router.get('/routes/:id', authenticate, checkPermission('transport', 'view'), async (req, res) => {
  try {
    const route = await TransportRoute.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
      isDeleted: { $ne: true },
    })
      .populate(
        'vehicleId',
        'registrationNumber make model capacity driver conductor lastLocation lastGpsUpdate'
      )
      .populate('students.studentId', 'name admissionId rollNo classId');

    if (!route) return res.status(404).json({ error: 'Route not found.' });
    res.json({ data: route });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /transport/routes/:id
 * Update a transport route (metadata + stops; use student endpoints for assignments)
 */
router.put(
  '/routes/:id',
  authenticate,
  checkPermission('transport', 'edit'),
  validateBody(updateRouteSchema),
  async (req, res) => {
    try {
      const data = req.validatedBody;

      if (data.routeNumber || data.academicYear) {
        const current = await TransportRoute.findOne({
          _id: req.params.id,
          schoolId: req.user.schoolId,
          isDeleted: { $ne: true },
        });
        if (!current) return res.status(404).json({ error: 'Route not found.' });

        const conflict = await TransportRoute.findOne({
          schoolId: req.user.schoolId,
          routeNumber: data.routeNumber || current.routeNumber,
          academicYear: data.academicYear || current.academicYear,
          isDeleted: { $ne: true },
          _id: { $ne: req.params.id },
        });
        if (conflict) {
          return res
            .status(409)
            .json({
              error: 'Another route with this route number already exists for the academic year.',
            });
        }
      }

      const route = await TransportRoute.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
        { $set: data },
        { new: true }
      ).populate('vehicleId', 'registrationNumber make model capacity driver conductor');

      if (!route) return res.status(404).json({ error: 'Route not found.' });
      res.json({ data: route });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE /transport/routes/:id
 * Soft-delete a transport route
 */
router.delete(
  '/routes/:id',
  authenticate,
  checkPermission('transport', 'delete'),
  async (req, res) => {
    try {
      const route = await TransportRoute.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user.id } },
        { new: true }
      );
      if (!route) return res.status(404).json({ error: 'Route not found.' });
      res.json({ message: 'Route deleted successfully.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Student Assignment Routes ────────────────────────────────────────────────

/**
 * POST /transport/routes/:id/students
 * Assign a student to a transport route
 */
router.post(
  '/routes/:id/students',
  authenticate,
  checkPermission('transport', 'edit'),
  validateBody(assignStudentSchema),
  async (req, res) => {
    try {
      const { studentId, stopId, pickupActive = true, dropActive = true } = req.validatedBody;

      const route = await TransportRoute.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!route) return res.status(404).json({ error: 'Route not found.' });

      // Verify student belongs to this school
      const student = await Student.findOne({
        _id: studentId,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!student) return res.status(404).json({ error: 'Student not found.' });

      // Check if already assigned
      const alreadyAssigned = route.students.some((s) => s.studentId.toString() === studentId);
      if (alreadyAssigned) {
        return res.status(409).json({ error: 'Student is already assigned to this route.' });
      }

      route.students.push({ studentId, stopId, pickupActive, dropActive });
      await route.save();

      // Check capacity overflow if route has a vehicle with capacity set
      let capacityWarning = null;
      if (route.vehicleId) {
        const vehicle = await Vehicle.findOne({ _id: route.vehicleId, isDeleted: { $ne: true } });
        if (vehicle?.capacity && route.students.length > vehicle.capacity) {
          capacityWarning = `Route has ${route.students.length} students but vehicle capacity is ${vehicle.capacity} seats.`;
        }
      }

      res.json({
        message: 'Student assigned to route.',
        data: route.students,
        ...(capacityWarning && { warning: capacityWarning }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE /transport/routes/:routeId/students/:studentId
 * Remove a student from a transport route
 */
router.delete(
  '/routes/:routeId/students/:studentId',
  authenticate,
  checkPermission('transport', 'edit'),
  async (req, res) => {
    try {
      const route = await TransportRoute.findOne({
        _id: req.params.routeId,
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
      });
      if (!route) return res.status(404).json({ error: 'Route not found.' });

      const before = route.students.length;
      route.students = route.students.filter(
        (s) => s.studentId.toString() !== req.params.studentId
      );

      if (route.students.length === before) {
        return res.status(404).json({ error: 'Student is not assigned to this route.' });
      }

      await route.save();
      res.json({ message: 'Student removed from route.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /transport/students/:studentId/route
 * Get the transport route assigned to a specific student
 */
router.get(
  '/students/:studentId/route',
  authenticate,
  checkPermission('transport', 'view'),
  async (req, res) => {
    try {
      const route = await TransportRoute.findOne({
        schoolId: req.user.schoolId,
        isDeleted: { $ne: true },
        'students.studentId': req.params.studentId,
      }).populate(
        'vehicleId',
        'registrationNumber make model capacity driver conductor lastLocation lastGpsUpdate'
      );

      if (!route) return res.json({ data: null });
      res.json({ data: route });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Reports ──────────────────────────────────────────────────────────────────

/**
 * GET /transport/reports
 * Route utilization: student count per route and per stop
 */
router.get('/reports', authenticate, checkPermission('transport', 'view'), async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = { schoolId: req.user.schoolId, isDeleted: { $ne: true } };
    if (academicYear) query.academicYear = academicYear;

    const routes = await TransportRoute.find(query).populate(
      'vehicleId',
      'registrationNumber make capacity'
    );

    const report = routes.map((r) => ({
      routeId: r._id,
      routeName: r.routeName,
      routeNumber: r.routeNumber,
      academicYear: r.academicYear,
      status: r.status,
      vehicleRegNo: r.vehicleId?.registrationNumber || null,
      vehicleCapacity: r.vehicleId?.capacity || 0,
      studentCount: r.students?.length || 0,
      utilizationPercent: r.vehicleId?.capacity
        ? Math.round(((r.students?.length || 0) / r.vehicleId.capacity) * 100)
        : null,
      stops: r.stops.map((stop) => ({
        stopId: stop._id,
        name: stop.name,
        pickupTime: stop.pickupTime || null,
        dropTime: stop.dropTime || null,
        studentCount: (r.students || []).filter(
          (s) => s.stopId && s.stopId.toString() === stop._id.toString()
        ).length,
      })),
    }));

    const activeRoutes = report.filter((r) => r.status === 'active');
    const withCapacity = activeRoutes.filter((r) => r.utilizationPercent !== null);

    res.json({
      data: report,
      summary: {
        totalRoutes: report.length,
        activeRoutes: activeRoutes.length,
        totalStudents: report.reduce((sum, r) => sum + r.studentCount, 0),
        avgUtilization: withCapacity.length
          ? Math.round(
              withCapacity.reduce((sum, r) => sum + r.utilizationPercent, 0) / withCapacity.length
            )
          : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
