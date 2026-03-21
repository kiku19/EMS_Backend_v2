import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import { tallyConfigUpdateSchema, tallyExportQuerySchema } from '../validators/tallySchema.js';
import TallyConfig from '../models/TallyConfig.js';
import { generateExport, generateChartOfAccounts } from '../services/tallyExportService.js';

const router = express.Router();
router.use(authenticate);

// GET /tally/config — Get Tally integration config for the school
router.get('/config', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) return res.status(403).json({ error: 'School context required' });

    let config = await TallyConfig.findOne({ schoolId }).lean();
    if (!config) {
      // Return a default config shape without persisting
      config = {
        gstin: '',
        companyName: '',
        defaultCashLedger: 'Cash',
        defaultBankLedger: 'Bank',
        defaultOnlineLedger: 'Online Payment Gateway',
        defaultChequeLedger: 'Cheque Clearing',
        ledgerMappings: [],
        autoExport: {
          enabled: false,
          schedule: 'daily',
          time: '06:00',
          lastExportAt: null,
          lastExportStatus: null,
        },
        syncHistory: [],
        _initialized: false,
      };
    }

    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /tally/config — Create or update Tally config for the school
router.put('/config', validateZod(tallyConfigUpdateSchema), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) return res.status(403).json({ error: 'School context required' });

    const update = req.body;

    const config = await TallyConfig.findOneAndUpdate(
      { schoolId },
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tally/export — Export fee data in Tally-compatible XML (or JSON summary)
router.get('/export', validateZod(tallyExportQuerySchema, 'query'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) return res.status(403).json({ error: 'School context required' });

    const { dateFrom, dateTo, academicYear, format } = req.query;

    const result = await generateExport({ schoolId, dateFrom, dateTo, academicYear, format });

    if (format === 'xml') {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tally-export-${dateFrom}-to-${dateTo}.xml"`
      );
      return res.send(result.xml);
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tally/chart-of-accounts — Export ledger masters XML for Tally
router.get('/chart-of-accounts', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) return res.status(403).json({ error: 'School context required' });

    const result = await generateChartOfAccounts(schoolId);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="tally-chart-of-accounts.xml"');
    res.send(result.xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tally/sync — Manual sync trigger: export and record in history
router.post('/sync', validateZod(tallyExportQuerySchema, 'body'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) return res.status(403).json({ error: 'School context required' });

    const { dateFrom, dateTo, academicYear } = req.body;

    let result;
    let syncStatus = 'success';
    let errorMessage = null;

    try {
      result = await generateExport({ schoolId, dateFrom, dateTo, academicYear, format: 'xml' });
    } catch (exportErr) {
      syncStatus = 'failed';
      errorMessage = exportErr.message;
      result = { recordCount: 0, xml: null };
    }

    // Record sync in history (capped at 50 entries)
    await TallyConfig.findOneAndUpdate(
      { schoolId },
      {
        $set: {
          'autoExport.lastExportAt': new Date(),
          'autoExport.lastExportStatus': syncStatus,
        },
        $push: {
          syncHistory: {
            $each: [
              {
                exportedAt: new Date(),
                dateFrom,
                dateTo,
                recordCount: result.recordCount,
                status: syncStatus,
                triggeredBy: 'manual',
                errorMessage,
              },
            ],
            $slice: -50,
          },
        },
      },
      { upsert: true }
    );

    if (syncStatus === 'failed') {
      return res.status(500).json({ error: 'Sync failed', message: errorMessage });
    }

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tally-sync-${dateFrom}-to-${dateTo}.xml"`
    );
    res.send(result.xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tally/sync-history — Get last 50 sync records
router.get('/sync-history', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) return res.status(403).json({ error: 'School context required' });

    const config = await TallyConfig.findOne({ schoolId }).select('syncHistory autoExport').lean();

    res.json({
      success: true,
      syncHistory: config?.syncHistory || [],
      lastExportAt: config?.autoExport?.lastExportAt || null,
      lastExportStatus: config?.autoExport?.lastExportStatus || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
