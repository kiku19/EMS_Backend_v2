import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Firebase');

let initializationError = null;

function normalizePrivateKey(privateKey) {
  return typeof privateKey === 'string' ? privateKey.replace(/\\n/g, '\n') : privateKey;
}

function parseServiceAccountJson(rawValue, sourceLabel) {
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed.private_key) {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid Firebase service account JSON from ${sourceLabel}: ${error.message}`);
  }
}

function loadServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    return parseServiceAccountJson(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim(),
      'FIREBASE_SERVICE_ACCOUNT_JSON'
    );
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY?.trim());

  if (!projectId && !clientEmail && !privateKey) {
    return null;
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Incomplete Firebase configuration. Set FIREBASE_SERVICE_ACCOUNT_JSON or all of ' +
      'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
    );
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    ...(process.env.FIREBASE_PRIVATE_KEY_ID?.trim()
      ? { private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID.trim() }
      : {}),
    ...(process.env.FIREBASE_CLIENT_ID?.trim()
      ? { client_id: process.env.FIREBASE_CLIENT_ID.trim() }
      : {}),
  };
}

function loadServiceAccountFromFile() {
  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH?.trim();
  if (!configuredPath) {
    return null;
  }

  const absolutePath = path.resolve(process.cwd(), configuredPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Firebase service account file not found at ${absolutePath}`);
  }

  return parseServiceAccountJson(
    fs.readFileSync(absolutePath, 'utf8'),
    'FIREBASE_SERVICE_ACCOUNT_KEY_PATH'
  );
}

function loadServiceAccount() {
  return loadServiceAccountFromEnv() || loadServiceAccountFromFile();
}

function initializeFirebaseAdmin() {
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      logger.warn(
        'Firebase Admin SDK is not configured. Parent OTP verification and push notifications are disabled.'
      );
      return null;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID?.trim(),
      });
    }

    logger.info(
      { projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID?.trim() || null },
      'Firebase Admin SDK initialized'
    );

    return admin;
  } catch (error) {
    initializationError = error;
    logger.error({ err: error }, 'Failed to initialize Firebase Admin SDK');
    return null;
  }
}

const firebaseAdmin = initializeFirebaseAdmin();

export function isFirebaseConfigured() {
  return Boolean(firebaseAdmin);
}

export function getFirebaseInitializationError() {
  return initializationError;
}

export default firebaseAdmin;
