import express from 'express';
import { School, Staff } from '../database.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import {
  onboardSchool,
  provisionSchoolResources,
  serializeProvisionedAdmin,
  serializeProvisioningResult,
} from '../services/schoolProvisioningService.js';
import { normalizeSchoolCode, serializeSchool } from '../utils/schoolContext.js';

const router = express.Router();

async function loadSchoolSummary(schools) {
  const schoolIds = schools.map((school) => school._id);
  const [staffCounts, admins] = await Promise.all([
    Staff.aggregate([
      { $match: { schoolId: { $in: schoolIds } } },
      { $group: { _id: '$schoolId', total: { $sum: 1 } } },
    ]),
    Staff.find({ schoolId: { $in: schoolIds }, role: 'Admin' })
      .select('schoolId name email phone status createdAt')
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const countsBySchoolId = new Map(
    staffCounts.map((entry) => [String(entry._id), entry.total])
  );
  const adminBySchoolId = new Map();

  admins.forEach((admin) => {
    const schoolId = String(admin.schoolId);
    if (!adminBySchoolId.has(schoolId)) {
      adminBySchoolId.set(schoolId, admin);
    }
  });

  return schools.map((school) => ({
    ...serializeSchool(school),
    counts: {
      staff: countsBySchoolId.get(String(school._id)) || 0,
    },
    admin: serializeProvisionedAdmin(adminBySchoolId.get(String(school._id))),
  }));
}

function buildOverview(schools) {
  return schools.reduce(
    (summary, school) => {
      summary.totalSchools += 1;

      if (school.status === 'active') {
        summary.activeSchools += 1;
      }

      if (school.planStatus === 'trialing') {
        summary.trialingSchools += 1;
      }

      if (school.planStatus === 'cancelled' || school.status === 'inactive') {
        summary.attentionNeeded += 1;
      }

      return summary;
    },
    {
      totalSchools: 0,
      activeSchools: 0,
      trialingSchools: 0,
      attentionNeeded: 0,
    }
  );
}

router.use(authenticate, requireSuperAdmin);

router.get('/overview', async (_req, res) => {
  try {
    const schools = await School.find().lean();
    res.json(buildOverview(schools));
  } catch (error) {
    console.error('Error loading super admin overview:', error);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

router.get('/schools', async (_req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 });
    res.json(await loadSchoolSummary(schools));
  } catch (error) {
    console.error('Error loading schools:', error);
    res.status(500).json({ error: 'Failed to load schools' });
  }
});

router.post('/schools', validate(schemas.superAdminCreateSchool), async (req, res) => {
  try {
    const result = await onboardSchool({
      ...req.body,
      provisionedBy: req.user.email || req.user.name || 'super-admin',
      source: 'super-admin-dashboard',
    });

    res.status(201).json(serializeProvisioningResult(result));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'A school with these details already exists' });
    }

    console.error('Error onboarding school:', error);
    res.status(500).json({ error: 'Failed to onboard school' });
  }
});

router.patch(
  '/schools/:id',
  validate(schemas.mongoIdParam, 'params'),
  validate(schemas.superAdminUpdateSchool),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id);

      if (!school) {
        return res.status(404).json({ error: 'School not found' });
      }

      if (req.body.schoolName) {
        school.name = req.body.schoolName.trim();
      }

      if (req.body.schoolCode) {
        school.code = normalizeSchoolCode(req.body.schoolCode);
      }

      Object.assign(school, {
        ...(req.body.status ? { status: req.body.status } : {}),
        ...(req.body.plan ? { plan: req.body.plan } : {}),
        ...(req.body.planStatus ? { planStatus: req.body.planStatus } : {}),
        ...(req.body.trialEndsAt !== undefined ? { trialEndsAt: req.body.trialEndsAt || null } : {}),
        ...(req.body.contactEmail !== undefined ? { contactEmail: req.body.contactEmail || null } : {}),
        ...(req.body.contactPhone !== undefined ? { contactPhone: req.body.contactPhone || null } : {}),
        ...(req.body.frontendUrl !== undefined ? { frontendUrl: req.body.frontendUrl || null } : {}),
        ...(req.body.backendUrl !== undefined ? { backendUrl: req.body.backendUrl || null } : {}),
      });

      await school.save();
      res.json({ school: serializeSchool(school) });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: 'School code is already in use' });
      }

      console.error('Error updating school:', error);
      res.status(500).json({ error: 'Failed to update school' });
    }
  }
);

router.post(
  '/schools/:id/provision',
  validate(schemas.mongoIdParam, 'params'),
  validate(schemas.superAdminProvisionSchool),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id);

      if (!school) {
        return res.status(404).json({ error: 'School not found' });
      }

      const result = await provisionSchoolResources({
        school,
        adminName: req.body.adminName,
        adminEmail: req.body.adminEmail || school.contactEmail,
        adminPassword: req.body.adminPassword,
        contactPhone: req.body.contactPhone || school.contactPhone,
        schoolSettings: req.body.schoolSettings,
        provisionedBy: req.user.email || req.user.name || 'super-admin',
        source: 'super-admin-reprovision',
      });

      res.json(serializeProvisioningResult(result));
    } catch (error) {
      console.error('Error provisioning school:', error);
      res.status(500).json({ error: 'Failed to provision school' });
    }
  }
);

export default router;
