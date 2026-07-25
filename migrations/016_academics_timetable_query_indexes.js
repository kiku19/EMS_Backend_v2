/** Ensure the Exams and Exam Schedules release UI uses tenant-first indexes. */

export const description =
  'Add tenant-first exam list, exam schedule list, and schedule-overlap indexes';

const INDEXES = [
  {
    collection: 'exams',
    key: { schoolId: 1, academicYear: 1, isDeleted: 1, startDate: -1, createdAt: -1 },
    name: 'schoolId_1_academicYear_1_isDeleted_1_startDate_-1_createdAt_-1',
  },
  {
    collection: 'examschedules',
    key: { schoolId: 1, academicYear: 1, isDeleted: 1, createdAt: -1 },
    name: 'schoolId_1_academicYear_1_isDeleted_1_createdAt_-1',
  },
  {
    collection: 'examschedules',
    key: { schoolId: 1, classIds: 1, status: 1, startDate: 1, endDate: 1, isDeleted: 1 },
    name: 'schoolId_1_classIds_1_status_1_startDate_1_endDate_1_isDeleted_1',
  },
  {
    collection: 'timetables',
    key: { schoolId: 1, academicYear: 1, isDeleted: 1 },
    name: 'schoolId_1_academicYear_1_isDeleted_1',
  },
  {
    collection: 'teachertimetables',
    key: { schoolId: 1, academicYear: 1 },
    name: 'schoolId_1_academicYear_1',
  },
];

async function collectionExists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

export async function up(db, { dryRun }) {
  console.log('    [SCAN] Academics query indexes will be synchronized (no document updates)');
  if (dryRun) return;

  for (const index of INDEXES) {
    if (!(await collectionExists(db, index.collection))) {
      console.log(`    [SKIP] ${index.collection}: collection does not exist`);
      continue;
    }
    await db.collection(index.collection).createIndex(index.key, { name: index.name });
    console.log(`    [OK]   ${index.collection}.${index.name}`);
  }
}

export async function down(db, { dryRun }) {
  console.log('    [SCAN] Academics query indexes will be removed');
  if (dryRun) return;

  for (const index of [...INDEXES].reverse()) {
    if (!(await collectionExists(db, index.collection))) continue;
    const collection = db.collection(index.collection);
    const existing = await collection.indexes();
    if (existing.some((candidate) => candidate.name === index.name)) {
      await collection.dropIndex(index.name);
    }
  }
}
