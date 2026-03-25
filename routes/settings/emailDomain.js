import express from 'express';
import { z } from 'zod';
import { SchoolSettings } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';
import {
  generateDkimKeyPair,
  getDnsRecords,
  verifyDomainDns,
} from '../../services/emailDomainService.js';

const router = express.Router();
router.use(authenticate);

const getSettingsQuery = (req) => buildSchoolScopedQuery(req.user?.schoolId);
const findSchoolSettings = (req) => SchoolSettings.findOne(getSettingsQuery(req));

const emailDomainSchema = z.object({
  sendingDomain: z
    .string()
    .min(1, 'Domain is required')
    .max(253)
    .regex(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/,
      'Invalid domain format'
    ),
  senderEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  senderName: z.string().max(100).optional().or(z.literal('')),
  dmarcPolicy: z.enum(['none', 'quarantine', 'reject']).default('none'),
  dmarcReportingEmail: z.string().email('Invalid reporting email').optional().or(z.literal('')),
});

// GET /settings/email-domain — return current config + required DNS records
router.get('/email-domain', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    if (!settings?.emailDomain?.sendingDomain) {
      return res.json({ configured: false });
    }

    const ed = settings.emailDomain;
    const dnsRecords = getDnsRecords({
      sendingDomain: ed.sendingDomain,
      dkimSelector: ed.dkimSelector || 'ems',
      dkimPublicKey: ed.dkimPublicKey,
      dmarcPolicy: ed.dmarcPolicy,
      dmarcReportingEmail: ed.dmarcReportingEmail,
    });

    res.json({
      configured: true,
      sendingDomain: ed.sendingDomain,
      senderEmail: ed.senderEmail,
      senderName: ed.senderName,
      dkimSelector: ed.dkimSelector,
      dmarcPolicy: ed.dmarcPolicy,
      dmarcReportingEmail: ed.dmarcReportingEmail,
      spfVerified: ed.spfVerified,
      dkimVerified: ed.dkimVerified,
      dmarcVerified: ed.dmarcVerified,
      verificationStatus: ed.verificationStatus,
      lastVerifiedAt: ed.lastVerifiedAt,
      dnsRecords,
    });
  } catch (error) {
    console.error('Error fetching email domain:', error);
    res.status(500).json({ error: 'Failed to fetch email domain configuration' });
  }
});

// POST /settings/email-domain — configure domain and generate DKIM keys
router.post('/email-domain', authenticate, async (req, res) => {
  try {
    const parsed = emailDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { sendingDomain, senderEmail, senderName, dmarcPolicy, dmarcReportingEmail } =
      parsed.data;
    const schoolId = req.user.schoolId;

    let settings = await findSchoolSettings(req);
    if (!settings) {
      settings = new SchoolSettings({ schoolId });
    }

    // Only regenerate DKIM keys if the domain has changed
    const domainChanged = settings.emailDomain?.sendingDomain !== sendingDomain;
    let dkimPrivateKey = settings.emailDomain?.dkimPrivateKey || '';
    let dkimPublicKey = settings.emailDomain?.dkimPublicKey || '';

    if (domainChanged || !dkimPrivateKey) {
      const keyPair = generateDkimKeyPair();
      dkimPrivateKey = keyPair.privateKey;
      dkimPublicKey = keyPair.publicKeyForDns;
    }

    settings.emailDomain = {
      sendingDomain,
      senderEmail: senderEmail || `noreply@${sendingDomain}`,
      senderName: senderName || '',
      dkimSelector: 'ems',
      dkimPrivateKey,
      dkimPublicKey,
      dmarcPolicy: dmarcPolicy || 'none',
      dmarcReportingEmail: dmarcReportingEmail || '',
      spfVerified: domainChanged ? false : settings.emailDomain?.spfVerified || false,
      dkimVerified: domainChanged ? false : settings.emailDomain?.dkimVerified || false,
      dmarcVerified: domainChanged ? false : settings.emailDomain?.dmarcVerified || false,
      verificationStatus: domainChanged
        ? 'unverified'
        : settings.emailDomain?.verificationStatus || 'unverified',
      lastVerifiedAt: domainChanged ? null : settings.emailDomain?.lastVerifiedAt || null,
    };

    await settings.save();

    const dnsRecords = getDnsRecords({
      sendingDomain,
      dkimSelector: 'ems',
      dkimPublicKey,
      dmarcPolicy: dmarcPolicy || 'none',
      dmarcReportingEmail: dmarcReportingEmail || '',
    });

    res.json({
      configured: true,
      sendingDomain,
      senderEmail: settings.emailDomain.senderEmail,
      senderName: settings.emailDomain.senderName,
      dkimSelector: 'ems',
      dmarcPolicy: dmarcPolicy || 'none',
      dmarcReportingEmail: dmarcReportingEmail || '',
      spfVerified: settings.emailDomain.spfVerified,
      dkimVerified: settings.emailDomain.dkimVerified,
      dmarcVerified: settings.emailDomain.dmarcVerified,
      verificationStatus: settings.emailDomain.verificationStatus,
      lastVerifiedAt: settings.emailDomain.lastVerifiedAt,
      dnsRecords,
    });
  } catch (error) {
    console.error('Error configuring email domain:', error);
    res.status(500).json({ error: 'Failed to configure email domain' });
  }
});

// POST /settings/email-domain/verify — check DNS records are live
router.post('/email-domain/verify', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    if (!settings?.emailDomain?.sendingDomain) {
      return res.status(400).json({ error: 'No email domain configured' });
    }

    const ed = settings.emailDomain;
    const verifyResult = await verifyDomainDns({
      sendingDomain: ed.sendingDomain,
      dkimSelector: ed.dkimSelector || 'ems',
      dkimPublicKey: ed.dkimPublicKey,
    });

    settings.emailDomain.spfVerified = verifyResult.spf;
    settings.emailDomain.dkimVerified = verifyResult.dkim;
    settings.emailDomain.dmarcVerified = verifyResult.dmarc;
    settings.emailDomain.verificationStatus = verifyResult.verificationStatus;
    settings.emailDomain.lastVerifiedAt = new Date();
    await settings.save();

    res.json({
      spfVerified: verifyResult.spf,
      dkimVerified: verifyResult.dkim,
      dmarcVerified: verifyResult.dmarc,
      verificationStatus: verifyResult.verificationStatus,
      lastVerifiedAt: settings.emailDomain.lastVerifiedAt,
      errors: verifyResult.errors,
    });
  } catch (error) {
    console.error('Error verifying email domain:', error);
    res.status(500).json({ error: 'Failed to verify email domain' });
  }
});

// DELETE /settings/email-domain — remove custom domain configuration
router.delete('/email-domain', authenticate, async (req, res) => {
  try {
    const settings = await findSchoolSettings(req);
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    settings.emailDomain = {
      sendingDomain: '',
      senderEmail: '',
      senderName: '',
      dkimSelector: 'ems',
      dkimPrivateKey: '',
      dkimPublicKey: '',
      dmarcPolicy: 'none',
      dmarcReportingEmail: '',
      spfVerified: false,
      dkimVerified: false,
      dmarcVerified: false,
      verificationStatus: 'unverified',
      lastVerifiedAt: null,
    };
    await settings.save();

    res.json({ success: true, message: 'Email domain configuration removed' });
  } catch (error) {
    console.error('Error removing email domain:', error);
    res.status(500).json({ error: 'Failed to remove email domain configuration' });
  }
});

export default router;
