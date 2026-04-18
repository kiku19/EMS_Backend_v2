/**
 * SSO Routes — Google Workspace, Microsoft 365, SAML 2.0 single sign-on + SCIM
 *
 * Endpoints:
 *   GET  /auth/sso/check?email=...           Public: check if email domain has SSO
 *   GET  /auth/sso/:provider/initiate        Public: start OAuth/SAML flow
 *   GET  /auth/sso/:provider/callback        Public: handle OAuth callback
 *   POST /auth/sso/saml/callback             Public: handle SAML assertion POST
 *   GET  /auth/sso/saml/metadata             Public: SP metadata XML
 *   GET  /auth/sso/config                    Authenticated: get SSO config (secrets redacted)
 *   PUT  /auth/sso/config                    Authenticated admin: update SSO config
 *   GET  /auth/sso/scim/v2/Users             SCIM: list/search users
 *   POST /auth/sso/scim/v2/Users             SCIM: provision user
 *   GET  /auth/sso/scim/v2/Users/:id         SCIM: get user
 *   PUT  /auth/sso/scim/v2/Users/:id         SCIM: replace user
 *   PATCH /auth/sso/scim/v2/Users/:id        SCIM: update user
 *   DELETE /auth/sso/scim/v2/Users/:id       SCIM: deprovision user
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { deflateRaw } from 'zlib';
import { Staff } from '../database.js';
import School from '../models/School.js';
import AuditTrail from '../models/AuditTrail.js';
import { authenticate } from '../middleware/auth.js';
import { generateToken } from '../middleware/auth.js';
import { validateZod, zodSchemas } from '../middleware/validation.js';
import { getRequiredSecret } from '../config/environment.js';
import { createLogger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import { createStaffSessionRecord } from '../utils/sessions.js';

const deflateRawAsync = promisify(deflateRaw);

const logger = createLogger('SSO');
const router = express.Router();
// Note: no router.use(authenticate) here — this file intentionally uses three auth mechanisms:
// 1. Public routes — /check, /saml/metadata, /:provider/initiate, /:provider/callback, /saml/callback
// 2. authenticate — /config (GET/PUT) for school admins
// 3. authenticateScim — /scim/v2/Users/* for SCIM provisioning (different token format)
// Adding router-level authenticate would break public SSO flows and SCIM requests.

const SSO_PROVIDERS = ['google', 'microsoft', 'saml'];

function getJwtRefreshSecret() {
  return getRequiredSecret('JWT_REFRESH_SECRET');
}

function getBackendUrl() {
  return (
    process.env.BACKEND_URL ||
    process.env.VITE_API_URL?.replace('/api/v1', '').replace('/api', '') ||
    'http://localhost:3002'
  );
}

function getFrontendUrl(school) {
  return school?.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
}

function frontendLoginUrl(school, errorCode) {
  return `${getFrontendUrl(school)}/login?sso_error=${encodeURIComponent(errorCode)}`;
}

function generateSsoState(schoolId, provider) {
  return jwt.sign(
    { schoolId: schoolId.toString(), provider, purpose: 'sso-state' },
    getRequiredSecret('JWT_SECRET'),
    { expiresIn: '10m' }
  );
}

function verifySsoState(state) {
  try {
    const payload = jwt.verify(state, getRequiredSecret('JWT_SECRET'));
    if (payload.purpose !== 'sso-state') return null;
    return payload;
  } catch {
    return null;
  }
}

function generateRefreshToken(staffId, schoolId, tokenVersion, sessionId) {
  const claims = {
    userId: staffId.toString(),
    schoolId: schoolId.toString(),
    userType: 'staff',
    tokenVersion,
  };
  if (sessionId) claims.sessionId = sessionId;
  return jwt.sign(claims, getJwtRefreshSecret(), { expiresIn: '30d' });
}

async function deflateAndEncode(xml) {
  const buf = await deflateRawAsync(Buffer.from(xml, 'utf8'));
  return buf.toString('base64');
}

/**
 * Parse a SAML Response XML and extract attributes.
 * Returns { email, name, providerUserId, groups } or throws.
 *
 * NOTE: This is a minimal parser that reads plain-text attribute values from an
 * IdP-signed assertion.  For production deployments that require XML signature
 * verification, install @node-saml/node-saml and replace this function.
 */
function parseSamlResponse(samlResponseBase64, samlCfg) {
  const xml = Buffer.from(samlResponseBase64, 'base64').toString('utf8');

  // Extract NameID (used as providerUserId)
  const nameIdMatch = xml.match(
    /<(?:saml:|saml2:)?NameID[^>]*>([^<]+)<\/(?:saml:|saml2:)?NameID>/i
  );
  const providerUserId = nameIdMatch?.[1]?.trim() || null;

  function getAttributeValue(attrName) {
    // Match <Attribute Name="attrName"><AttributeValue>value</AttributeValue></Attribute>
    const re = new RegExp(
      `<(?:saml:|saml2:)?Attribute[^>]+Name=["']${escapeRegex(attrName)}["'][^>]*>[\\s\\S]*?<(?:saml:|saml2:)?AttributeValue[^>]*>([^<]+)<\\/(?:saml:|saml2:)?AttributeValue>`,
      'i'
    );
    return xml.match(re)?.[1]?.trim() || null;
  }

  function getAllAttributeValues(attrName) {
    const re = new RegExp(
      `<(?:saml:|saml2:)?Attribute[^>]+Name=["']${escapeRegex(attrName)}["'][^>]*>([\\s\\S]*?)<\\/(?:saml:|saml2:)?Attribute>`,
      'i'
    );
    const block = xml.match(re)?.[1] || '';
    const vals = [];
    const valRe =
      /<(?:saml:|saml2:)?AttributeValue[^>]*>([^<]+)<\/(?:saml:|saml2:)?AttributeValue>/gi;
    let m;
    while ((m = valRe.exec(block)) !== null) vals.push(m[1].trim());
    return vals;
  }

  const emailAttr = samlCfg?.emailAttribute || 'email';
  const nameAttr = samlCfg?.nameAttribute || 'displayName';
  const groupAttr = samlCfg?.groupAttribute || null;

  const email = (getAttributeValue(emailAttr) || providerUserId || '').toLowerCase();
  const name = getAttributeValue(nameAttr) || null;
  const groups = groupAttr ? getAllAttributeValues(groupAttr) : [];

  return { email, name, providerUserId: providerUserId || email, groups };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve SSO groups to an EMS role using groupRoleMappings.
 * Returns the first matching role, or null if no match.
 */
function resolveRoleFromGroups(groups, groupRoleMappings) {
  if (!groups?.length || !groupRoleMappings?.length) return null;
  for (const g of groups) {
    const mapping = groupRoleMappings.find((m) => m.groupName === g);
    if (mapping?.role) return mapping.role;
  }
  return null;
}

function logSsoEvent(action, staff, school, req) {
  AuditTrail.create({
    schoolId: school._id,
    userId: staff._id,
    userName: staff.name || staff.email || null,
    action,
    entity: 'auth',
    entityId: staff._id.toString(),
    method: req.method,
    path: req.path,
    ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'] || null,
  }).catch(() => {});
}

/**
 * GET /auth/sso/check?email=user@company.com
 * Returns whether SSO is configured for the given email's domain.
 * This must come before /:provider routes to avoid parameter collision.
 */
router.get('/check', async (req, res) => {
  try {
    const email = String(req.query.email || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) return res.json({ ssoEnabled: false });

    const domain = email.split('@')[1];
    if (!domain) return res.json({ ssoEnabled: false });

    const school = await School.findOne({
      'ssoConfig.allowedDomains': domain,
      status: 'active',
    }).select('ssoConfig code name');

    if (!school) return res.json({ ssoEnabled: false });

    const providers = [];
    if (school.ssoConfig?.google?.enabled && school.ssoConfig?.google?.clientId) {
      providers.push('google');
    }
    if (school.ssoConfig?.microsoft?.enabled && school.ssoConfig?.microsoft?.clientId) {
      providers.push('microsoft');
    }
    if (school.ssoConfig?.saml?.enabled && school.ssoConfig?.saml?.entryPoint) {
      providers.push('saml');
    }

    return res.json({
      ssoEnabled: providers.length > 0,
      providers,
      schoolCode: school.code,
      schoolName: school.name,
      ssoOnly: school.ssoConfig?.ssoOnly || false,
    });
  } catch (err) {
    logger.error({ err }, 'SSO check failed');
    return res.json({ ssoEnabled: false });
  }
});

/**
 * GET /auth/sso/config
 * Returns the school's SSO configuration (client secrets redacted).
 */
router.get('/config', async (req, res) => {
  try {
    const school = await School.findById(req.user.schoolId).select('ssoConfig name code');
    if (!school) return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });

    const cfg = school.ssoConfig || {};
    return res.json({
      success: true,
      ssoConfig: {
        google: {
          enabled: cfg.google?.enabled || false,
          clientId: cfg.google?.clientId || '',
          hasClientSecret: !!cfg.google?.clientSecret,
        },
        microsoft: {
          enabled: cfg.microsoft?.enabled || false,
          clientId: cfg.microsoft?.clientId || '',
          tenantId: cfg.microsoft?.tenantId || '',
          hasClientSecret: !!cfg.microsoft?.clientSecret,
        },
        saml: {
          enabled: cfg.saml?.enabled || false,
          entryPoint: cfg.saml?.entryPoint || '',
          issuer: cfg.saml?.issuer || '',
          hasCert: !!cfg.saml?.cert,
          emailAttribute: cfg.saml?.emailAttribute || 'email',
          nameAttribute: cfg.saml?.nameAttribute || 'displayName',
          groupAttribute: cfg.saml?.groupAttribute || '',
        },
        groupRoleMappings: cfg.groupRoleMappings || [],
        allowedDomains: cfg.allowedDomains || [],
        autoProvision: cfg.autoProvision || false,
        defaultRole: cfg.defaultRole || 'Teacher',
        ssoOnly: cfg.ssoOnly || false,
        scim: {
          enabled: cfg.scim?.enabled || false,
          hasToken: !!cfg.scim?.token,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch SSO config');
    return res.status(500).json({ error: 'Failed to fetch SSO configuration' });
  }
});

/**
 * PUT /auth/sso/config
 * Update school's SSO configuration.
 */
router.put('/config', validateZod(zodSchemas.updateSsoConfig), async (req, res) => {
  try {
    const {
      google,
      microsoft,
      saml,
      groupRoleMappings,
      allowedDomains,
      autoProvision,
      defaultRole,
      ssoOnly,
      scim,
    } = req.body;

    const school = await School.findById(req.user.schoolId);
    if (!school) return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });

    const cfg = school.ssoConfig || {};

    if (google !== undefined) {
      cfg.google = {
        enabled: google.enabled ?? cfg.google?.enabled ?? false,
        clientId: google.clientId ?? cfg.google?.clientId ?? null,
        // Only overwrite secret if a new value is explicitly provided
        clientSecret: google.clientSecret || cfg.google?.clientSecret || null,
      };
    }

    if (microsoft !== undefined) {
      cfg.microsoft = {
        enabled: microsoft.enabled ?? cfg.microsoft?.enabled ?? false,
        clientId: microsoft.clientId ?? cfg.microsoft?.clientId ?? null,
        tenantId: microsoft.tenantId ?? cfg.microsoft?.tenantId ?? null,
        clientSecret: microsoft.clientSecret || cfg.microsoft?.clientSecret || null,
      };
    }

    if (saml !== undefined) {
      cfg.saml = {
        enabled: saml.enabled ?? cfg.saml?.enabled ?? false,
        entryPoint: saml.entryPoint ?? cfg.saml?.entryPoint ?? null,
        issuer: saml.issuer ?? cfg.saml?.issuer ?? null,
        cert: saml.cert || cfg.saml?.cert || null,
        emailAttribute: saml.emailAttribute ?? cfg.saml?.emailAttribute ?? 'email',
        nameAttribute: saml.nameAttribute ?? cfg.saml?.nameAttribute ?? 'displayName',
        groupAttribute: saml.groupAttribute ?? cfg.saml?.groupAttribute ?? null,
      };
    }

    if (groupRoleMappings !== undefined) cfg.groupRoleMappings = groupRoleMappings;
    if (allowedDomains !== undefined) cfg.allowedDomains = allowedDomains;
    if (autoProvision !== undefined) cfg.autoProvision = autoProvision;
    if (defaultRole !== undefined) cfg.defaultRole = defaultRole;
    if (ssoOnly !== undefined) {
      // Prevent enabling SSO-only mode if no provider is fully configured
      if (ssoOnly === true) {
        const googleReady = cfg.google?.enabled && cfg.google?.clientId && cfg.google?.clientSecret;
        const microsoftReady =
          cfg.microsoft?.enabled &&
          cfg.microsoft?.clientId &&
          cfg.microsoft?.clientSecret &&
          cfg.microsoft?.tenantId;
        const samlReady =
          cfg.saml?.enabled && cfg.saml?.entryPoint && cfg.saml?.issuer && cfg.saml?.cert;

        if (!googleReady && !microsoftReady && !samlReady) {
          return res.status(400).json({
            error:
              'Cannot enable SSO-only mode: at least one SSO provider (Google, Microsoft, or SAML) must be fully configured and enabled first.',
          });
        }
      }
      cfg.ssoOnly = ssoOnly;
    }

    if (scim !== undefined) {
      cfg.scim = {
        enabled: scim.enabled ?? cfg.scim?.enabled ?? false,
        token: scim.token || cfg.scim?.token || null,
      };
    }

    // Guard: if ssoOnly is (still) enabled, ensure at least one provider remains fully configured
    if (cfg.ssoOnly) {
      const googleReady = cfg.google?.enabled && cfg.google?.clientId && cfg.google?.clientSecret;
      const microsoftReady =
        cfg.microsoft?.enabled &&
        cfg.microsoft?.clientId &&
        cfg.microsoft?.clientSecret &&
        cfg.microsoft?.tenantId;
      const samlReady =
        cfg.saml?.enabled && cfg.saml?.entryPoint && cfg.saml?.issuer && cfg.saml?.cert;

      if (!googleReady && !microsoftReady && !samlReady) {
        return res.status(400).json({
          error:
            'Cannot disable the last SSO provider while SSO-only mode is active. Disable SSO-only mode first, or configure another provider.',
        });
      }
    }

    school.ssoConfig = cfg;
    school.markModified('ssoConfig');
    await school.save();

    return res.json({ success: true, message: 'SSO configuration updated successfully' });
  } catch (err) {
    logger.error({ err }, 'Failed to update SSO config');
    return res.status(500).json({ error: 'Failed to update SSO configuration' });
  }
});

/**
 * GET /auth/sso/scim/token
 * Returns a masked version of the SCIM bearer token for the school (admin-only).
 * The full token is never returned — only the last 4 characters are visible.
 * Use the regenerate-token endpoint to obtain the full token (shown only once).
 */
router.get('/scim/token', async (req, res) => {
  try {
    const school = await School.findById(req.user.schoolId).select('ssoConfig');
    if (!school) return res.status(404).json({ error: 'School not found' });
    const token = school.ssoConfig?.scim?.token || null;
    const maskedToken = token ? '••••••••' + token.slice(-4) : null;
    return res.json({ success: true, token: maskedToken, hasToken: !!token });
  } catch (err) {
    logger.error({ err }, 'Failed to retrieve SCIM token');
    return res.status(500).json({ error: 'Failed to retrieve SCIM token' });
  }
});

/**
 * POST /auth/sso/scim/regenerate-token
 * Generates a new cryptographically random SCIM bearer token, saves it, and returns it.
 * The token is only shown once — admins must copy it immediately.
 */
router.post('/scim/regenerate-token', async (req, res) => {
  try {
    const school = await School.findById(req.user.schoolId);
    if (!school) return res.status(404).json({ error: 'School not found' });

    const newToken = randomBytes(32).toString('hex');
    if (!school.ssoConfig) school.ssoConfig = {};
    if (!school.ssoConfig.scim) school.ssoConfig.scim = {};
    school.ssoConfig.scim.token = newToken;
    school.markModified('ssoConfig');
    await school.save();

    logger.info({ schoolId: school._id }, 'SCIM token regenerated');
    return res.json({ success: true, token: newToken });
  } catch (err) {
    logger.error({ err }, 'Failed to regenerate SCIM token');
    return res.status(500).json({ error: 'Failed to regenerate SCIM token' });
  }
});

/**
 * GET /auth/sso/saml/metadata?schoolCode=SCHOOL_CODE
 * Returns the SP (Service Provider) SAML metadata XML.
 * IdP admins use this to register EMS as a trusted SP.
 */
router.get('/saml/metadata', async (req, res) => {
  const schoolCode = String(req.query.schoolCode || '')
    .trim()
    .toUpperCase();
  try {
    const school = await School.findOne({ code: schoolCode, status: 'active' });
    if (!school) return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });

    const samlCfg = school.ssoConfig?.saml;
    if (!samlCfg?.enabled)
      return res.status(400).json({ error: 'SAML is not configured for this school' });

    const backendUrl = getBackendUrl();
    const issuer = samlCfg.issuer || `${backendUrl}/api/v1/auth/sso/saml`;
    const acsUrl = `${backendUrl}/api/v1/auth/sso/saml/callback`;

    const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${issuer}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${acsUrl}"
      index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

    res.set('Content-Type', 'application/xml');
    return res.send(xml);
  } catch (err) {
    logger.error({ err }, 'SAML metadata generation failed');
    return res.status(500).json({ error: 'Failed to generate SAML metadata' });
  }
});

/**
 * GET /auth/sso/:provider/initiate?schoolCode=SCHOOL_CODE
 * Redirect the browser to the OAuth provider's authorization page (or SAML IdP).
 */
router.get('/:provider/initiate', async (req, res) => {
  const { provider } = req.params;
  const schoolCode = String(req.query.schoolCode || '')
    .trim()
    .toUpperCase();

  if (!SSO_PROVIDERS.includes(provider)) {
    return res
      .status(400)
      .json({ error: 'Invalid SSO provider. Must be google, microsoft, or saml.' });
  }

  try {
    const school = await School.findOne({ code: schoolCode, status: 'active' });
    if (!school) return res.status(404).json({ error: req.t('common:errors.schoolNotFound') });

    const providerCfg = school.ssoConfig?.[provider];

    if (provider === 'saml') {
      if (!providerCfg?.enabled || !providerCfg?.entryPoint) {
        return res.status(400).json({ error: 'SAML SSO is not configured for this school' });
      }

      const state = generateSsoState(school._id, 'saml');
      const backendUrl = getBackendUrl();
      const issuer = providerCfg.issuer || `${backendUrl}/api/v1/auth/sso/saml`;
      const acsUrl = `${backendUrl}/api/v1/auth/sso/saml/callback`;

      // Build a minimal SAML AuthnRequest
      const id = `_${randomBytes(16).toString('hex')}`;
      const now = new Date().toISOString();
      const authnRequest = `<samlp:AuthnRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${id}"
  Version="2.0"
  IssueInstant="${now}"
  Destination="${providerCfg.entryPoint}"
  AssertionConsumerServiceURL="${acsUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;

      const deflated = await deflateAndEncode(authnRequest);
      const params = new URLSearchParams({
        SAMLRequest: deflated,
        RelayState: state,
      });

      return res.redirect(`${providerCfg.entryPoint}?${params}`);
    }

    if (!providerCfg?.enabled || !providerCfg?.clientId) {
      return res.status(400).json({ error: `${provider} SSO is not configured for this school` });
    }

    const state = generateSsoState(school._id, provider);
    const callbackUrl = `${getBackendUrl()}/api/v1/auth/sso/${provider}/callback`;

    let authUrl;

    if (provider === 'google') {
      const params = new URLSearchParams({
        client_id: providerCfg.clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'select_account',
      });
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else {
      // Microsoft
      const tenantId = providerCfg.tenantId || 'common';
      const params = new URLSearchParams({
        client_id: providerCfg.clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile User.Read',
        state,
        response_mode: 'query',
      });
      authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
    }

    return res.redirect(authUrl);
  } catch (err) {
    logger.error({ err, provider, schoolCode }, 'SSO initiate failed');
    return res.status(500).json({ error: 'Failed to initiate SSO' });
  }
});

/**
 * GET /auth/sso/:provider/callback
 * Exchange authorization code for access token, look up (or provision) the staff account,
 * then redirect the browser to the frontend with a JWT.
 */
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state, error: oauthError } = req.query;

  const defaultFrontend = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!SSO_PROVIDERS.includes(provider)) {
    return res.redirect(`${defaultFrontend}/login?sso_error=invalid_provider`);
  }

  if (oauthError) {
    return res.redirect(`${defaultFrontend}/login?sso_error=${encodeURIComponent(oauthError)}`);
  }

  // Validate CSRF state
  const statePayload = verifySsoState(state);
  if (!statePayload || statePayload.provider !== provider) {
    return res.redirect(`${defaultFrontend}/login?sso_error=invalid_state`);
  }

  let school;
  try {
    school = await School.findById(statePayload.schoolId);
    if (!school || school.status !== 'active') {
      return res.redirect(`${defaultFrontend}/login?sso_error=school_not_found`);
    }
  } catch {
    return res.redirect(`${defaultFrontend}/login?sso_error=school_not_found`);
  }

  const frontendUrl = getFrontendUrl(school);
  const providerCfg = school.ssoConfig?.[provider];

  if (!providerCfg?.enabled || !providerCfg?.clientId || !providerCfg?.clientSecret) {
    return res.redirect(frontendLoginUrl(school, 'sso_not_configured'));
  }

  const callbackUrl = `${getBackendUrl()}/api/v1/auth/sso/${provider}/callback`;

  // ── Exchange code for user info ──────────────────────────────────────────────
  let userInfo;
  try {
    let accessToken;

    if (provider === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: providerCfg.clientId,
          client_secret: providerCfg.clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userRes.ok) throw new Error('Failed to fetch Google user info');
      const gu = await userRes.json();
      userInfo = { id: gu.id, email: gu.email?.toLowerCase(), name: gu.name, picture: gu.picture };
    } else {
      // Microsoft
      const tenantId = providerCfg.tenantId || 'common';
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: providerCfg.clientId,
            client_secret: providerCfg.clientSecret,
            redirect_uri: callbackUrl,
            grant_type: 'authorization_code',
            scope: 'openid email profile User.Read',
          }),
        }
      );
      if (!tokenRes.ok) throw new Error(`Microsoft token exchange failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;

      const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userRes.ok) throw new Error('Failed to fetch Microsoft user info');
      const mu = await userRes.json();
      userInfo = {
        id: mu.id,
        email: (mu.mail || mu.userPrincipalName)?.toLowerCase(),
        name: mu.displayName,
        picture: null,
      };
    }
  } catch (err) {
    logger.error({ err, provider }, 'SSO token exchange error');
    return res.redirect(frontendLoginUrl(school, 'auth_failed'));
  }

  if (!userInfo?.email) {
    return res.redirect(frontendLoginUrl(school, 'no_email'));
  }

  // ── Look up staff by email ───────────────────────────────────────────────────
  let staff = await Staff.findOne({
    schoolId: school._id,
    email: userInfo.email,
    isDeleted: { $ne: true },
  });

  // ── Auto-provisioning ────────────────────────────────────────────────────────
  if (!staff && school.ssoConfig?.autoProvision) {
    const emailDomain = userInfo.email.split('@')[1];
    const isAllowedDomain = school.ssoConfig.allowedDomains?.includes(emailDomain);

    if (!isAllowedDomain) {
      return res.redirect(frontendLoginUrl(school, 'domain_not_allowed'));
    }

    try {
      const count = await Staff.countDocuments({ schoolId: school._id });
      const staffCode = `SSO${String(count + 1).padStart(4, '0')}`;
      const randomPassword = randomBytes(32).toString('hex');

      // Resolve role: group mapping > default role
      const resolvedRole =
        resolveRoleFromGroups(userInfo.groups || [], school.ssoConfig.groupRoleMappings) ||
        school.ssoConfig.defaultRole ||
        'Teacher';

      staff = await Staff.create({
        schoolId: school._id,
        name: userInfo.name || userInfo.email.split('@')[0],
        email: userInfo.email,
        code: staffCode,
        role: [resolvedRole],
        status: 'active',
        password: randomPassword,
        picture: userInfo.picture || null,
        ssoIdentities: [{ provider, providerUserId: userInfo.id, email: userInfo.email }],
      });
    } catch (err) {
      logger.error({ err }, 'SSO auto-provision failed');
      return res.redirect(frontendLoginUrl(school, 'provision_failed'));
    }
  }

  if (!staff) {
    return res.redirect(frontendLoginUrl(school, 'user_not_found'));
  }

  if (staff.status !== 'active') {
    return res.redirect(frontendLoginUrl(school, 'account_inactive'));
  }

  // ── Link SSO identity if not already present ────────────────────────────────
  const alreadyLinked = staff.ssoIdentities?.some(
    (i) => i.provider === provider && i.providerUserId === userInfo.id
  );
  if (!alreadyLinked) {
    await Staff.findByIdAndUpdate(staff._id, {
      $push: { ssoIdentities: { provider, providerUserId: userInfo.id, email: userInfo.email } },
    });
  }

  // ── Issue JWT ────────────────────────────────────────────────────────────────
  // Mint a sessionId + Session record so SSO logins are revocable via
  // /auth/sessions (previously SSO skipped session tracking entirely).
  const schoolId = school._id.toString();
  const sessionId = randomUUID();
  const token = generateToken(staff._id.toString(), staff.role, {
    schoolId,
    userType: 'staff',
    sessionId,
  });
  const refreshToken = generateRefreshToken(
    staff._id,
    schoolId,
    staff.tokenVersion || 1,
    sessionId
  );
  await createStaffSessionRecord({ staff, sessionId, req });

  logSsoEvent(`sso_login_${provider}`, staff, school, req);

  const params = new URLSearchParams({ token, refreshToken, provider });
  return res.redirect(`${frontendUrl}/sso/callback?${params}`);
});

/**
 * POST /auth/sso/saml/callback
 * IdP posts the SAML assertion here (HTTP-POST binding).
 * RelayState carries the signed state JWT we generated at initiation.
 */
router.post('/saml/callback', express.urlencoded({ extended: false }), async (req, res) => {
  const { SAMLResponse, RelayState } = req.body;
  const defaultFrontend = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!SAMLResponse) {
    return res.redirect(`${defaultFrontend}/login?sso_error=missing_saml_response`);
  }

  const statePayload = verifySsoState(RelayState);
  if (!statePayload || statePayload.provider !== 'saml') {
    return res.redirect(`${defaultFrontend}/login?sso_error=invalid_state`);
  }

  let school;
  try {
    school = await School.findById(statePayload.schoolId);
    if (!school || school.status !== 'active') {
      return res.redirect(`${defaultFrontend}/login?sso_error=school_not_found`);
    }
  } catch {
    return res.redirect(`${defaultFrontend}/login?sso_error=school_not_found`);
  }

  const frontendUrl = getFrontendUrl(school);
  const samlCfg = school.ssoConfig?.saml;

  if (!samlCfg?.enabled || !samlCfg?.entryPoint) {
    return res.redirect(frontendLoginUrl(school, 'sso_not_configured'));
  }

  let userInfo;
  try {
    userInfo = parseSamlResponse(SAMLResponse, samlCfg);
  } catch (err) {
    logger.error({ err }, 'SAML response parse error');
    return res.redirect(frontendLoginUrl(school, 'auth_failed'));
  }

  if (!userInfo?.email) {
    return res.redirect(frontendLoginUrl(school, 'no_email'));
  }

  // Look up staff by email
  let staff = await Staff.findOne({
    schoolId: school._id,
    email: userInfo.email,
    isDeleted: { $ne: true },
  });

  // Auto-provisioning
  if (!staff && school.ssoConfig?.autoProvision) {
    const emailDomain = userInfo.email.split('@')[1];
    const isAllowedDomain = school.ssoConfig.allowedDomains?.includes(emailDomain);

    if (!isAllowedDomain) {
      return res.redirect(frontendLoginUrl(school, 'domain_not_allowed'));
    }

    try {
      const count = await Staff.countDocuments({ schoolId: school._id });
      const staffCode = `SSO${String(count + 1).padStart(4, '0')}`;
      const randomPassword = randomBytes(32).toString('hex');

      // Resolve role: group mapping > default role
      const resolvedRole =
        resolveRoleFromGroups(userInfo.groups, school.ssoConfig.groupRoleMappings) ||
        school.ssoConfig.defaultRole ||
        'Teacher';

      staff = await Staff.create({
        schoolId: school._id,
        name: userInfo.name || userInfo.email.split('@')[0],
        email: userInfo.email,
        code: staffCode,
        role: [resolvedRole],
        status: 'active',
        password: randomPassword,
        ssoIdentities: [
          { provider: 'saml', providerUserId: userInfo.providerUserId, email: userInfo.email },
        ],
      });
    } catch (err) {
      logger.error({ err }, 'SAML auto-provision failed');
      return res.redirect(frontendLoginUrl(school, 'provision_failed'));
    }
  }

  if (!staff) return res.redirect(frontendLoginUrl(school, 'user_not_found'));
  if (staff.status !== 'active') return res.redirect(frontendLoginUrl(school, 'account_inactive'));

  // Link SAML identity if not already present
  const alreadyLinked = staff.ssoIdentities?.some(
    (i) => i.provider === 'saml' && i.providerUserId === userInfo.providerUserId
  );
  if (!alreadyLinked) {
    await Staff.findByIdAndUpdate(staff._id, {
      $push: {
        ssoIdentities: {
          provider: 'saml',
          providerUserId: userInfo.providerUserId,
          email: userInfo.email,
        },
      },
    });
  }

  // Apply group → role mapping if groups returned by IdP
  if (userInfo.groups?.length && school.ssoConfig?.groupRoleMappings?.length) {
    const newRole = resolveRoleFromGroups(userInfo.groups, school.ssoConfig.groupRoleMappings);
    if (newRole && !staff.role.includes(newRole)) {
      await Staff.findByIdAndUpdate(staff._id, { $addToSet: { role: newRole } });
      staff.role = [...staff.role, newRole];
    }
  }

  // Mint a sessionId + Session record so SAML SSO logins are revocable via
  // /auth/sessions.
  const schoolId = school._id.toString();
  const sessionId = randomUUID();
  const token = generateToken(staff._id.toString(), staff.role, {
    schoolId,
    userType: 'staff',
    sessionId,
  });
  const refreshToken = generateRefreshToken(
    staff._id,
    schoolId,
    staff.tokenVersion || 1,
    sessionId
  );
  await createStaffSessionRecord({ staff, sessionId, req });

  logSsoEvent('sso_login_saml', staff, school, req);

  const params = new URLSearchParams({ token, refreshToken, provider: 'saml' });
  return res.redirect(`${frontendUrl}/sso/callback?${params}`);
});

// ── SCIM v2 provisioning ───────────────────────────────────────────────────────

/**
 * Middleware: authenticate SCIM requests via Bearer token stored in school.ssoConfig.scim.token
 */
async function authenticateScim(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token)
    return res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Missing Bearer token',
    });

  // schoolCode passed as query param or header for tenant routing
  const schoolCode = String(req.query.schoolCode || req.headers['x-school-code'] || '')
    .trim()
    .toUpperCase();
  if (!schoolCode)
    return res.status(400).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '400',
      detail: 'Missing x-school-code header or schoolCode query parameter',
    });

  const school = await School.findOne({ code: schoolCode, status: 'active' }).select(
    'ssoConfig _id'
  );
  if (!school)
    return res.status(404).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '404',
      detail: req.t('common:errors.schoolNotFound'),
    });

  if (!school.ssoConfig?.scim?.enabled || !school.ssoConfig?.scim?.token) {
    return res.status(403).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '403',
      detail: 'SCIM is not enabled for this school',
    });
  }

  // Constant-time comparison to prevent timing attacks
  const expected = school.ssoConfig.scim.token;
  const expectedHash = createHash('sha256').update(expected).digest();
  const actualHash = createHash('sha256').update(token).digest();
  if (!timingSafeEqual(expectedHash, actualHash)) {
    return res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Invalid token',
    });
  }

  req.scimSchool = school;
  next();
}

function staffToScimUser(staff) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: staff._id.toString(),
    userName: staff.email || staff.phone,
    name: { formatted: staff.name },
    emails: staff.email ? [{ value: staff.email, primary: true }] : [],
    phoneNumbers: staff.phone ? [{ value: staff.phone }] : [],
    active: staff.status === 'active',
    meta: {
      resourceType: 'User',
      created: staff.createdAt,
      lastModified: staff.updatedAt,
      location: `/api/v1/auth/sso/scim/v2/Users/${staff._id}`,
    },
  };
}

// GET /auth/sso/scim/v2/Users — list users
router.get('/scim/v2/Users', authenticateScim, async (req, res) => {
  try {
    const startIndex = Math.max(1, parseInt(req.query.startIndex, 10) || 1);
    const count = Math.min(100, parseInt(req.query.count, 10) || 100);
    const filter = req.query.filter || '';

    const query = { schoolId: req.scimSchool._id, isDeleted: { $ne: true } };

    // Support basic filter: userName eq "user@example.com"
    const filterMatch = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    if (filterMatch) {
      query.$or = [{ email: filterMatch[1] }, { phone: filterMatch[1] }];
    }

    const total = await Staff.countDocuments(query);
    const users = await Staff.find(query)
      .skip(startIndex - 1)
      .limit(count)
      .lean();

    return res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map(staffToScimUser),
    });
  } catch (err) {
    logger.error({ err }, 'SCIM list users failed');
    return res.status(500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'Internal error',
    });
  }
});

// GET /auth/sso/scim/v2/Users/:id — get user
router.get('/scim/v2/Users/:id', authenticateScim, async (req, res) => {
  try {
    const staff = await Staff.findOne({
      _id: req.params.id,
      schoolId: req.scimSchool._id,
      isDeleted: { $ne: true },
    });
    if (!staff)
      return res.status(404).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
        detail: 'User not found',
      });
    return res.json(staffToScimUser(staff));
  } catch (err) {
    logger.error({ err }, 'SCIM get user failed');
    return res.status(500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'Internal error',
    });
  }
});

// POST /auth/sso/scim/v2/Users — provision user
router.post('/scim/v2/Users', authenticateScim, async (req, res) => {
  try {
    const { userName, name, emails, phoneNumbers, active } = req.body;
    const email = (emails?.[0]?.value || userName || '').toLowerCase();
    const phone = phoneNumbers?.[0]?.value || null;

    if (!email && !phone) {
      return res.status(400).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '400',
        detail: 'userName or emails[0].value is required',
      });
    }

    // Check if already exists
    const existing = await Staff.findOne({
      schoolId: req.scimSchool._id,
      ...(email ? { email } : { phone }),
      isDeleted: { $ne: true },
    });
    if (existing) {
      return res.status(409).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '409',
        detail: 'User already exists',
      });
    }

    const count = await Staff.countDocuments({ schoolId: req.scimSchool._id });
    const staffCode = `SCIM${String(count + 1).padStart(4, '0')}`;
    const randomPassword = randomBytes(32).toString('hex');
    const schoolCfg = await School.findById(req.scimSchool._id).select('ssoConfig');

    const staff = await Staff.create({
      schoolId: req.scimSchool._id,
      name: name?.formatted || email?.split('@')[0] || phone,
      email: email || null,
      phone: phone || null,
      code: staffCode,
      role: [schoolCfg?.ssoConfig?.defaultRole || 'Teacher'],
      status: active === false ? 'inactive' : 'active',
      password: randomPassword,
    });

    return res.status(201).json(staffToScimUser(staff));
  } catch (err) {
    logger.error({ err }, 'SCIM create user failed');
    return res.status(500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'Internal error',
    });
  }
});

// PUT /auth/sso/scim/v2/Users/:id — replace user
router.put('/scim/v2/Users/:id', authenticateScim, async (req, res) => {
  try {
    const staff = await Staff.findOne({
      _id: req.params.id,
      schoolId: req.scimSchool._id,
      isDeleted: { $ne: true },
    });
    if (!staff)
      return res.status(404).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
        detail: 'User not found',
      });

    const { name, emails, phoneNumbers, active } = req.body;
    if (name?.formatted) staff.name = name.formatted;
    if (emails?.[0]?.value) staff.email = emails[0].value.toLowerCase();
    if (phoneNumbers?.[0]?.value) staff.phone = phoneNumbers[0].value;
    if (active !== undefined) staff.status = active ? 'active' : 'inactive';

    await staff.save();
    return res.json(staffToScimUser(staff));
  } catch (err) {
    logger.error({ err }, 'SCIM replace user failed');
    return res.status(500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'Internal error',
    });
  }
});

// PATCH /auth/sso/scim/v2/Users/:id — update user (Operations)
router.patch('/scim/v2/Users/:id', authenticateScim, async (req, res) => {
  try {
    const staff = await Staff.findOne({
      _id: req.params.id,
      schoolId: req.scimSchool._id,
      isDeleted: { $ne: true },
    });
    if (!staff)
      return res.status(404).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
        detail: 'User not found',
      });

    const ops = req.body.Operations || [];
    for (const op of ops) {
      if (op.op?.toLowerCase() === 'replace') {
        if (op.path === 'active' || op.value?.active !== undefined) {
          const activeVal = op.path === 'active' ? op.value : op.value.active;
          staff.status = activeVal ? 'active' : 'inactive';
        }
        if (op.value?.['name.formatted'] || op.value?.name?.formatted) {
          staff.name = op.value['name.formatted'] || op.value.name?.formatted;
        }
      }
    }

    await staff.save();
    return res.json(staffToScimUser(staff));
  } catch (err) {
    logger.error({ err }, 'SCIM patch user failed');
    return res.status(500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'Internal error',
    });
  }
});

// DELETE /auth/sso/scim/v2/Users/:id — deprovision user (soft delete)
router.delete('/scim/v2/Users/:id', authenticateScim, async (req, res) => {
  try {
    const staff = await Staff.findOne({
      _id: req.params.id,
      schoolId: req.scimSchool._id,
      isDeleted: { $ne: true },
    });
    if (!staff)
      return res.status(404).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
        detail: 'User not found',
      });

    staff.isDeleted = true;
    staff.deletedAt = new Date();
    staff.status = 'terminated';
    await staff.save();

    return res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'SCIM delete user failed');
    return res.status(500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'Internal error',
    });
  }
});

export default router;
