import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateURI } from 'otplib';

const _totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
const authenticator = {
  generateSecret: () => _totp.generateSecret(),
  keyuri: (account, issuer, secret) => _totp.toURI({ label: account, issuer, secret }),
  verify: async ({ token, secret }) => {
    const result = await _totp.verify(token, { secret });
    return result.valid;
  },
};
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Staff } from '../database.js';
import {
  authenticate,
  generateToken,
  setAuthCookie,
  setRefreshCookie,
} from '../middleware/auth.js';
import { validateZod, zodSchemas } from '../middleware/validation.js';
import { getRequiredSecret } from '../config/environment.js';
import { createLogger } from '../utils/logger.js';
import { buildStaffAuthPayload, generateStaffRefreshToken } from './authHelpers.js';
import { createStaffSessionRecord } from '../utils/sessions.js';

const logger = createLogger('TwoFactor');
const router = express.Router();

/**
 * POST /auth/2fa/verify
 * Called after successful password login when 2FA is required.
 * Body: { twoFactorToken, code?, backupCode?, rememberDevice? }
 * Returns full auth token on success.
 */
router.post('/verify', validateZod(zodSchemas.twoFactorVerifyLogin), async (req, res) => {
  try {
    const { twoFactorToken, code, backupCode, rememberDevice } = req.body;

    const payload = verifyTwoFactorToken(twoFactorToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired 2FA session. Please login again.' });
    }

    const staff = await Staff.findById(payload.staffId).select(
      '+twoFactorSecret +twoFactorBackupCodes'
    );
    if (!staff || !staff.twoFactorEnabled) {
      return res.status(401).json({ error: 'Invalid 2FA session' });
    }

    let verified = false;

    if (code) {
      const secret = decryptSecret(staff.twoFactorSecret);
      verified = await authenticator.verify({ token: code, secret });
    }

    if (!verified && backupCode) {
      const idx = await matchBackupCode(backupCode.toUpperCase(), staff.twoFactorBackupCodes);
      if (idx >= 0) {
        // Consume the used backup code
        const updatedCodes = [...staff.twoFactorBackupCodes];
        updatedCodes.splice(idx, 1);
        await Staff.findByIdAndUpdate(staff._id, { twoFactorBackupCodes: updatedCodes });
        verified = true;
      }
    }

    if (!verified) {
      return res.status(401).json({ error: 'Invalid verification code' });
    }

    const authPayload = await buildStaffAuthPayload(staff);
    // Mint a sessionId and persist a Session row so the 2FA-verified login
    // is revocable via /auth/sessions (same guarantee as password login).
    // Before this fix the 2FA path skipped session tracking entirely — any
    // admin who enabled 2FA could never be kicked via logout-everywhere.
    const sessionId = randomUUID();
    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: authPayload.schoolId,
      userType: 'staff',
      sessionId,
    });
    const refreshToken = generateStaffRefreshToken(
      staff._id.toString(),
      authPayload.schoolId,
      staff.tokenVersion || 1,
      sessionId
    );
    await createStaffSessionRecord({ staff, sessionId, req });

    if (rememberDevice) {
      await addTrustedDevice(res, staff, req.headers['user-agent']);
    }

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    const TOKEN_EXPIRES_IN_MS = 8 * 60 * 60 * 1000;
    res.json({
      ...authPayload,
      token,
      refreshToken,
      tokenExpiresAt: Date.now() + TOKEN_EXPIRES_IN_MS,
    });
  } catch (err) {
    logger.error({ err }, '2FA verify error');
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});
router.use(authenticate);

const TWO_FACTOR_TOKEN_EXPIRY = '10m';
const DEVICE_COOKIE_NAME = 'ems_2fa_device';
const DEVICE_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BACKUP_CODE_COUNT = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEncryptionKey() {
  const raw = process.env.TOTP_ENCRYPTION_KEY || getRequiredSecret('JWT_SECRET');
  // SHA-256 the key so we always get a 32-byte buffer regardless of source length
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

function decryptSecret(ciphertext) {
  const [ivHex, tagHex, dataHex] = ciphertext.split('.');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function generateBackupCodes() {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );
}

async function hashBackupCodes(codes) {
  return Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
}

async function matchBackupCode(provided, hashes) {
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(provided, hashes[i])) return i;
  }
  return -1;
}

function issueTwoFactorToken(staffId, schoolId) {
  return jwt.sign(
    { purpose: '2fa-challenge', staffId, schoolId },
    getRequiredSecret('JWT_SECRET'),
    { expiresIn: TWO_FACTOR_TOKEN_EXPIRY }
  );
}

function verifyTwoFactorToken(token) {
  try {
    const payload = jwt.verify(token, getRequiredSecret('JWT_SECRET'));
    if (payload.purpose !== '2fa-challenge') return null;
    return payload;
  } catch {
    return null;
  }
}

function getDeviceCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

function parseCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

async function isTrustedDevice(req, staff) {
  const rawToken = parseCookieValue(req.headers.cookie, DEVICE_COOKIE_NAME);
  if (!rawToken) return false;

  const fullStaff = await Staff.findById(staff._id).select('+trustedDevices');
  if (!fullStaff?.trustedDevices?.length) return false;

  const now = new Date();
  for (const device of fullStaff.trustedDevices) {
    if (device.expiresAt < now) continue;
    if (await bcrypt.compare(rawToken, device.token)) return true;
  }
  return false;
}

async function addTrustedDevice(res, staff, userAgent) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashed = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date(Date.now() + DEVICE_COOKIE_MAX_AGE_MS);

  // Prune expired devices and limit to 5 stored devices
  const fullStaff = await Staff.findById(staff._id).select('+trustedDevices');
  const now = new Date();
  const active = (fullStaff.trustedDevices || []).filter((d) => d.expiresAt > now).slice(-4); // keep last 4, making room for this new one

  await Staff.findByIdAndUpdate(staff._id, {
    trustedDevices: [...active, { token: hashed, expiresAt, userAgent: userAgent || '' }],
  });

  res.cookie(DEVICE_COOKIE_NAME, rawToken, getDeviceCookieOptions());
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /auth/2fa/setup
 * Generate a new TOTP secret and return QR code for enrollment.
 * Requires authentication. Does NOT yet enable 2FA — call /confirm after verifying.
 */
router.get('/setup', async (req, res) => {
  try {
    const staff = await Staff.findById(req.user.id);
    if (!staff) return res.status(404).json({ error: req.t('common:errors.staffNotFound') });

    const secret = authenticator.generateSecret();
    const encryptedSecret = encryptSecret(secret);

    // Save pending secret (not yet enabled)
    await Staff.findByIdAndUpdate(staff._id, { twoFactorSecret: encryptedSecret });

    const otpauthUrl = authenticator.keyuri(
      staff.email || staff.phone || staff._id.toString(),
      'SchoolSync',
      secret
    );

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    res.json({
      success: true,
      qrCode: qrCodeDataUrl,
      secret, // shown once so user can manually enter in authenticator app
      otpauthUrl,
    });
  } catch (err) {
    logger.error({ err }, '2FA setup error');
    res.status(500).json({ error: 'Failed to generate 2FA setup' });
  }
});

/**
 * POST /auth/2fa/confirm
 * Confirm enrollment by verifying a TOTP code from the authenticator app.
 * Enables 2FA and returns backup codes.
 */
router.post('/confirm', validateZod(zodSchemas.twoFactorConfirmSetup), async (req, res) => {
  try {
    const { code } = req.body;
    const staff = await Staff.findById(req.user.id).select('+twoFactorSecret');
    if (!staff) return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
    if (!staff.twoFactorSecret) {
      return res.status(400).json({ error: 'Run 2FA setup first before confirming' });
    }

    const secret = decryptSecret(staff.twoFactorSecret);
    const isValid = await authenticator.verify({ token: code, secret });
    if (!isValid) {
      return res
        .status(400)
        .json({ error: 'Invalid verification code. Please check your authenticator app.' });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await hashBackupCodes(backupCodes);

    await Staff.findByIdAndUpdate(staff._id, {
      twoFactorEnabled: true,
      twoFactorEnrolledAt: new Date(),
      twoFactorBackupCodes: hashedCodes,
    });

    res.json({
      success: true,
      message: '2FA enabled successfully',
      backupCodes, // shown only once — user must save these
    });
  } catch (err) {
    logger.error({ err }, '2FA confirm error');
    res.status(500).json({ error: 'Failed to confirm 2FA setup' });
  }
});

/**
 * POST /auth/2fa/disable
 * Disable 2FA. Requires current password confirmation.
 */
router.post('/disable', validateZod(zodSchemas.twoFactorDisable), async (req, res) => {
  try {
    const { password } = req.body;
    const staff = await Staff.findById(req.user.id);
    if (!staff) return res.status(404).json({ error: req.t('common:errors.staffNotFound') });

    const passwordValid = await staff.comparePassword(password);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    await Staff.findByIdAndUpdate(staff._id, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorEnrolledAt: null,
      twoFactorBackupCodes: [],
      trustedDevices: [],
    });

    res.clearCookie(DEVICE_COOKIE_NAME, { ...getDeviceCookieOptions(), maxAge: undefined });
    res.json({ success: true, message: '2FA has been disabled' });
  } catch (err) {
    logger.error({ err }, '2FA disable error');
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

/**
 * GET /auth/2fa/status
 * Returns the 2FA enrollment status for the current user.
 */
router.get('/status', async (req, res) => {
  try {
    const staff = await Staff.findById(req.user.id).select('twoFactorEnabled twoFactorEnrolledAt');
    if (!staff) return res.status(404).json({ error: req.t('common:errors.staffNotFound') });

    res.json({
      success: true,
      twoFactorEnabled: staff.twoFactorEnabled || false,
      enrolledAt: staff.twoFactorEnrolledAt || null,
    });
  } catch (err) {
    logger.error({ err }, '2FA status error');
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});

/**
 * POST /auth/2fa/regenerate-backup-codes
 * Regenerate backup codes (requires authenticated 2FA session).
 */
router.post('/regenerate-backup-codes', async (req, res) => {
  try {
    const staff = await Staff.findById(req.user.id).select('+twoFactorBackupCodes');
    if (!staff) return res.status(404).json({ error: req.t('common:errors.staffNotFound') });
    if (!staff.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await hashBackupCodes(backupCodes);
    await Staff.findByIdAndUpdate(staff._id, { twoFactorBackupCodes: hashedCodes });

    res.json({ success: true, backupCodes });
  } catch (err) {
    logger.error({ err }, '2FA regenerate backup codes error');
    res.status(500).json({ error: 'Failed to regenerate backup codes' });
  }
});

export { issueTwoFactorToken, isTrustedDevice };
export default router;
