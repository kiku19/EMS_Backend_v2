import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { ensureSchoolSettings } from '../../utils/academicYear.js';

const router = express.Router();
router.use(authenticate);

const DATA_RESIDENCY_REGIONS = {
  IN: {
    label: 'India',
    dataCenter: 'Mumbai, India',
    complianceFrameworks: ['DPDP'],
    description:
      "Data stored in Mumbai, India. Compliant with India's Digital Personal Data Protection (DPDP) Act.",
  },
  US: {
    label: 'United States',
    dataCenter: 'Virginia, USA',
    complianceFrameworks: ['FERPA'],
    description: 'Data stored in Virginia, USA. Compliant with FERPA for educational institutions.',
  },
  EU: {
    label: 'European Union',
    dataCenter: 'Frankfurt, Germany',
    complianceFrameworks: ['GDPR'],
    description: 'Data stored in Frankfurt, Germany. Compliant with GDPR.',
  },
  AP: {
    label: 'Asia-Pacific',
    dataCenter: 'Singapore',
    complianceFrameworks: ['PDPA'],
    description: 'Data stored in Singapore. Compliant with PDPA.',
  },
};

const dataResidencySchema = z.object({
  region: z.enum(['IN', 'US', 'EU', 'AP']),
});

// GET /settings/data-residency
router.get('/data-residency', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);
    const dr = settings.dataResidency || {};
    const region = dr.region || 'IN';
    const meta = DATA_RESIDENCY_REGIONS[region];
    res.json({
      region,
      dataCenter: meta.dataCenter,
      label: meta.label,
      complianceFrameworks: dr.complianceFrameworks?.length
        ? dr.complianceFrameworks
        : meta.complianceFrameworks,
      description: meta.description,
      selectedAt: dr.selectedAt || null,
      lockedAt: dr.lockedAt || null,
      isLocked: !!dr.lockedAt,
      availableRegions: Object.entries(DATA_RESIDENCY_REGIONS).map(([code, info]) => ({
        code,
        label: info.label,
        dataCenter: info.dataCenter,
        complianceFrameworks: info.complianceFrameworks,
        description: info.description,
      })),
    });
  } catch (error) {
    console.error('Error fetching data residency settings:', error);
    res.status(500).json({ error: 'Failed to fetch data residency settings' });
  }
});

// PUT /settings/data-residency
router.put('/data-residency', authenticate, async (req, res) => {
  try {
    const parsed = dataResidencySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const settings = await ensureSchoolSettings(req.user?.schoolId);

    // Prevent changing region once locked
    if (settings.dataResidency?.lockedAt) {
      return res
        .status(400)
        .json({ error: 'Data residency region is locked and cannot be changed.' });
    }

    const { region } = parsed.data;
    const meta = DATA_RESIDENCY_REGIONS[region];

    settings.dataResidency = {
      region,
      selectedAt: new Date(),
      lockedAt: settings.dataResidency?.lockedAt || null,
      complianceFrameworks: meta.complianceFrameworks,
    };

    await settings.save();

    res.json({
      region,
      dataCenter: meta.dataCenter,
      label: meta.label,
      complianceFrameworks: settings.dataResidency.complianceFrameworks,
      description: meta.description,
      selectedAt: settings.dataResidency.selectedAt,
      lockedAt: settings.dataResidency.lockedAt,
      isLocked: false,
    });
  } catch (error) {
    console.error('Error updating data residency settings:', error);
    res.status(500).json({ error: 'Failed to update data residency settings' });
  }
});

export default router;
