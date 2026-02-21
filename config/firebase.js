import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

/**
 * Firebase Admin SDK Configuration
 *
 * Environment variables required:
 * - FIREBASE_SERVICE_ACCOUNT_KEY_PATH: Path to service account JSON file
 * - FIREBASE_PROJECT_ID: Firebase project ID
 */

// Get environment variables
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!serviceAccountPath) {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT_KEY_PATH environment variable is not set. ' +
    'Please set it to the path of your Firebase service account JSON file.'
  );
}

if (!projectId) {
  throw new Error(
    'FIREBASE_PROJECT_ID environment variable is not set. ' +
    'Please set it to your Firebase project ID.'
  );
}

// Resolve absolute path
const absoluteServiceAccountPath = path.resolve(serviceAccountPath);

// Check if service account file exists
if (!fs.existsSync(absoluteServiceAccountPath)) {
  throw new Error(
    `Firebase service account file not found at: ${absoluteServiceAccountPath}\n` +
    `Please ensure the file exists and the path is correct.`
  );
}

// Read and parse service account
let serviceAccount;
try {
  serviceAccount = JSON.parse(
    fs.readFileSync(absoluteServiceAccountPath, 'utf8')
  );
} catch (error) {
  throw new Error(
    `Failed to read or parse service account file at: ${absoluteServiceAccountPath}\n` +
    `Error: ${error.message}`
  );
}

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: projectId
  });
}

// Export the admin instance
export default admin;

