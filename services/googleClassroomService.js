/**
 * Google Classroom Service
 *
 * Handles OAuth token lifecycle and Google Classroom API calls.
 * Uses googleapis package if available; gracefully degrades with a clear error
 * if GOOGLE_CLASSROOM_CLIENT_ID / GOOGLE_CLASSROOM_CLIENT_SECRET are not set.
 *
 * Required env vars:
 *   GOOGLE_CLASSROOM_CLIENT_ID      — OAuth 2.0 client ID
 *   GOOGLE_CLASSROOM_CLIENT_SECRET  — OAuth 2.0 client secret
 *   GOOGLE_CLASSROOM_REDIRECT_URI   — Registered OAuth redirect URI
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('GoogleClassroom');

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials',
  'https://www.googleapis.com/auth/userinfo.email',
];

function getConfig() {
  const clientId = process.env.GOOGLE_CLASSROOM_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CLASSROOM_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Google Classroom is not configured. Set GOOGLE_CLASSROOM_CLIENT_ID, ' +
        'GOOGLE_CLASSROOM_CLIENT_SECRET, and GOOGLE_CLASSROOM_REDIRECT_URI.'
    );
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Build the OAuth2 authorization URL for the school admin to consent.
 */
export function buildAuthUrl(stateToken) {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: stateToken,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for access + refresh tokens.
 * Returns { accessToken, refreshToken, expiresAt, email, scopes }
 */
export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getConfig();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }

  // Fetch connected user email
  const userInfo = await fetchWithToken(
    data.access_token,
    'https://www.googleapis.com/oauth2/v2/userinfo'
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: (data.scope || '').split(' ').filter(Boolean),
    email: userInfo.email || null,
  };
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns { accessToken, expiresAt }
 */
export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getConfig();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Token refresh failed');
  }

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Ensure the sync record has a valid access token, refreshing if needed.
 * Mutates syncRecord.oauth and saves it.
 */
async function ensureValidToken(syncRecord) {
  const { tokenExpiresAt, accessToken, refreshToken } = syncRecord.oauth;

  // Refresh 5 minutes before expiry
  const needsRefresh =
    !accessToken || !tokenExpiresAt || tokenExpiresAt <= new Date(Date.now() + 5 * 60 * 1000);

  if (needsRefresh) {
    if (!refreshToken) throw new Error('No refresh token available. Reconnect Google Classroom.');
    const { accessToken: newToken, expiresAt } = await refreshAccessToken(refreshToken);
    syncRecord.oauth.accessToken = newToken;
    syncRecord.oauth.tokenExpiresAt = expiresAt;
    await syncRecord.save();
  }

  return syncRecord.oauth.accessToken;
}

/**
 * Generic authenticated fetch helper for Google APIs.
 */
async function fetchWithToken(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Google API error: ${response.status}`);
  }

  return response.json();
}

/**
 * List all active courses in the connected Google Workspace.
 */
export async function listCourses(syncRecord) {
  const token = await ensureValidToken(syncRecord);
  const data = await fetchWithToken(
    token,
    'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100'
  );
  return data.courses || [];
}

/**
 * List students enrolled in a Google Classroom course.
 */
async function listCourseStudents(token, courseId) {
  const students = [];
  let pageToken;

  do {
    const url = `https://classroom.googleapis.com/v1/courses/${courseId}/students?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await fetchWithToken(token, url);
    if (data.students) students.push(...data.students);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return students;
}

/**
 * List coursework (assignments) in a Google Classroom course.
 */
async function listCourseWork(token, courseId) {
  const data = await fetchWithToken(
    token,
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork?courseWorkStates=PUBLISHED&pageSize=100`
  );
  return data.courseWork || [];
}

/**
 * List student submissions (grades) for a specific coursework item.
 */
async function listSubmissions(token, courseId, courseWorkId) {
  const data = await fetchWithToken(
    token,
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?pageSize=100`
  );
  return data.studentSubmissions || [];
}

/**
 * List teachers in a Google Classroom course.
 */
async function listCourseTeachers(token, courseId) {
  const data = await fetchWithToken(
    token,
    `https://classroom.googleapis.com/v1/courses/${courseId}/teachers?pageSize=50`
  );
  return data.teachers || [];
}

/**
 * Core sync function for a single class mapping.
 * Returns summary counts for students, assignments, grades.
 */
async function syncClassMapping(token, mapping, emsModels, settings, conflictResolution) {
  const { Class, Student, Staff } = emsModels;
  const summary = {
    studentsAdded: 0,
    studentsRemoved: 0,
    assignmentsCreated: 0,
    gradesUpdated: 0,
    conflicts: 0,
    errors: 0,
  };

  try {
    // --- Student sync ---
    if (settings.syncStudents) {
      const googleStudents = await listCourseStudents(token, mapping.googleCourseId);
      const googleEmails = new Set(
        googleStudents.map((s) => s.profile?.emailAddress?.toLowerCase()).filter(Boolean)
      );

      // Find EMS students in this class
      const emsStudents = await Student.find({
        classId: mapping.emsClassId,
        isDeleted: { $ne: true },
      })
        .select('email name rollNo')
        .lean();

      const emsEmailSet = new Set(emsStudents.map((s) => s.email?.toLowerCase()).filter(Boolean));

      // Students in Google but not in EMS: these are in Google Classroom but not enrolled locally
      // We log conflicts rather than auto-creating students (EMS is source of truth by default)
      for (const gStudent of googleStudents) {
        const email = gStudent.profile?.emailAddress?.toLowerCase();
        if (email && !emsEmailSet.has(email)) {
          if (conflictResolution === 'google_wins') {
            // Would auto-create student — skipped in this implementation (requires full student data)
            summary.conflicts++;
          } else {
            summary.conflicts++;
          }
        }
      }

      // Students in EMS but not in Google: flag if needed
      for (const emsStudent of emsStudents) {
        const email = emsStudent.email?.toLowerCase();
        if (email && !googleEmails.has(email)) {
          summary.conflicts++;
        }
      }

      summary.studentsAdded = 0; // Preserve EMS as source of truth
    }

    // --- Assignment sync ---
    if (settings.syncAssignments) {
      const courseWork = await listCourseWork(token, mapping.googleCourseId);

      // Import assignments as exam entries if they don't already exist
      for (const work of courseWork) {
        try {
          const exists = await emsModels.Exam?.findOne({
            schoolId: emsModels.schoolId,
            'googleClassroom.courseWorkId': work.id,
            isDeleted: { $ne: true },
          });

          if (!exists && emsModels.Exam) {
            // Create a minimal exam record linked to this Google assignment
            await emsModels.Exam.create({
              schoolId: emsModels.schoolId,
              title: work.title || 'Google Classroom Assignment',
              classId: mapping.emsClassId,
              maxMarks: work.maxPoints || 100,
              status: 'published',
              source: 'google_classroom',
              'googleClassroom.courseId': mapping.googleCourseId,
              'googleClassroom.courseWorkId': work.id,
              dueDate: work.dueDate
                ? new Date(work.dueDate.year, (work.dueDate.month || 1) - 1, work.dueDate.day || 1)
                : null,
            });
            summary.assignmentsCreated++;
          }
        } catch (err) {
          logger.warn({ err: err.message, courseWorkId: work.id }, 'Failed to sync assignment');
          summary.errors++;
        }
      }
    }

    // --- Grade passthrough ---
    if (settings.syncGrades && settings.syncAssignments) {
      const courseWork = await listCourseWork(token, mapping.googleCourseId);
      for (const work of courseWork) {
        try {
          const submissions = await listSubmissions(token, mapping.googleCourseId, work.id);
          for (const sub of submissions) {
            if (sub.assignedGrade != null && emsModels.Result) {
              // Find the student by Google user ID
              const googleUserId = sub.userId;
              // Match to EMS student via email lookup (teacher mapping lookup)
              const updated = await emsModels.Result?.updateOne(
                {
                  schoolId: emsModels.schoolId,
                  'googleClassroom.courseWorkId': work.id,
                  'googleClassroom.googleUserId': googleUserId,
                },
                {
                  $set: {
                    marksObtained: sub.assignedGrade,
                    'googleClassroom.lastGradeSync': new Date(),
                  },
                }
              );
              if (updated?.modifiedCount > 0) summary.gradesUpdated++;
            }
          }
        } catch (err) {
          logger.warn({ err: err.message, courseWorkId: work.id }, 'Failed to sync grades');
          summary.errors++;
        }
      }
    }

    mapping.lastSyncedAt = new Date();
  } catch (err) {
    logger.error(
      { err: err.message, courseId: mapping.googleCourseId },
      'Class mapping sync failed'
    );
    summary.errors++;
  }

  return summary;
}

/**
 * Run a full sync for all configured class mappings.
 * Returns the sync log entry.
 */
export async function runSync(syncRecord, emsModels, triggeredBy = 'manual') {
  const logEntry = {
    triggeredBy,
    status: 'running',
    startedAt: new Date(),
    summary: {
      classesProcessed: 0,
      studentsAdded: 0,
      studentsRemoved: 0,
      assignmentsCreated: 0,
      gradesUpdated: 0,
      conflicts: 0,
      errors: 0,
    },
  };

  syncRecord.syncHistory.push(logEntry);
  await syncRecord.save();

  const logId = syncRecord.syncHistory[syncRecord.syncHistory.length - 1]._id;

  try {
    const token = await ensureValidToken(syncRecord);
    const settings = syncRecord.settings;
    const conflictResolution = settings.conflictResolution;

    for (const mapping of syncRecord.classMappings) {
      const counts = await syncClassMapping(
        token,
        mapping,
        emsModels,
        settings,
        conflictResolution
      );
      logEntry.summary.classesProcessed++;
      logEntry.summary.studentsAdded += counts.studentsAdded;
      logEntry.summary.studentsRemoved += counts.studentsRemoved;
      logEntry.summary.assignmentsCreated += counts.assignmentsCreated;
      logEntry.summary.gradesUpdated += counts.gradesUpdated;
      logEntry.summary.conflicts += counts.conflicts;
      logEntry.summary.errors += counts.errors;
    }

    logEntry.status = logEntry.summary.errors > 0 ? 'partial' : 'completed';
    syncRecord.lastScheduledSync = new Date();
  } catch (err) {
    logger.error({ err: err.message }, 'Google Classroom sync failed');
    logEntry.status = 'failed';
    logEntry.errorMessage = err.message;
  }

  logEntry.completedAt = new Date();

  // Update the log entry in syncHistory
  const idx = syncRecord.syncHistory.findIndex((l) => l._id.toString() === logId.toString());
  if (idx !== -1) {
    syncRecord.syncHistory[idx] = {
      ...(syncRecord.syncHistory[idx].toObject?.() ?? syncRecord.syncHistory[idx]),
      ...logEntry,
    };
  }

  await syncRecord.save();
  return logEntry;
}
