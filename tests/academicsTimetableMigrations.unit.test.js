import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';

import * as timetableDedupe from '../migrations/008_timetable_dedupe.js';
import * as academicsIndexes from '../migrations/016_academics_timetable_query_indexes.js';

const TIMETABLE_UNIQUE_KEY = {
  schoolId: 1,
  classId: 1,
  academicYear: 1,
};

function hasKey(index, expected) {
  return Object.entries(expected).every(([field, direction]) => index.key?.[field] === direction);
}

describe('academics and timetable release migrations', () => {
  it('008 deduplicates identical schedules, enforces uniqueness, and rolls back cleanly', async () => {
    const db = mongoose.connection.db;
    const collection = db.collection('timetables');
    const schoolId = new ObjectId();
    const classId = new ObjectId();
    const common = {
      schoolId,
      classId,
      academicYear: '2026-27',
      periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
      schedule: { Monday: [{ subject: 'Math', teacherId: null, room: 'A1' }] },
    };

    await collection.insertMany([
      { ...common, updatedAt: new Date('2026-01-01T00:00:00.000Z') },
      { ...common, updatedAt: new Date('2026-02-01T00:00:00.000Z') },
    ]);

    await timetableDedupe.up(db, { dryRun: false });

    const afterUp = await collection.find({ schoolId, classId }).sort({ updatedAt: 1 }).toArray();
    expect(afterUp).toHaveLength(2);
    expect(afterUp.filter((document) => document.isDeleted === false)).toHaveLength(1);
    expect(
      afterUp.filter((document) => document.dedupReason === '008_timetable_dedupe')
    ).toHaveLength(1);
    const upIndexes = await collection.indexes();
    expect(
      upIndexes.some((index) => index.unique === true && hasKey(index, TIMETABLE_UNIQUE_KEY))
    ).toBe(true);

    await timetableDedupe.down(db, { dryRun: false });

    const afterDown = await collection.find({ schoolId, classId }).toArray();
    expect(afterDown).toHaveLength(2);
    expect(afterDown.every((document) => document.isDeleted === false)).toBe(true);
    expect(afterDown.every((document) => document.dedupReason == null)).toBe(true);
    const downIndexes = await collection.indexes();
    expect(
      downIndexes.some((index) => index.unique === true && hasKey(index, TIMETABLE_UNIQUE_KEY))
    ).toBe(false);
  });

  it('008 refuses divergent duplicate schedules without mutating either document', async () => {
    const db = mongoose.connection.db;
    const collection = db.collection('timetables');
    const schoolId = new ObjectId();
    const classId = new ObjectId();
    const common = {
      schoolId,
      classId,
      academicYear: '2026-27',
      periods: [{ name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false }],
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    };

    await collection.insertMany([
      { ...common, schedule: { Monday: [{ subject: 'Math', room: 'A1' }] } },
      { ...common, schedule: { Monday: [{ subject: 'Science', room: 'A1' }] } },
    ]);

    await expect(timetableDedupe.up(db, { dryRun: false })).rejects.toThrow(
      /Refusing to deduplicate/
    );

    const documents = await collection.find({ schoolId, classId }).toArray();
    expect(documents).toHaveLength(2);
    expect(documents.every((document) => document.isDeleted !== true)).toBe(true);
    expect(documents.every((document) => document.dedupReason == null)).toBe(true);
  });

  it('016 creates and removes only the release query indexes on isolated collections', async () => {
    // Use a separate database so Mongoose's background auto-index builders for
    // application models cannot recreate an index between migration.down() and
    // this assertion.
    const dbName = `${mongoose.connection.db.databaseName}_migration016_${Date.now()}`;
    const db = mongoose.connection.client.db(dbName);
    const collectionNames = ['exams', 'examschedules', 'timetables', 'teachertimetables'];
    const releaseIndexNames = [
      'schoolId_1_academicYear_1_isDeleted_1_startDate_-1_createdAt_-1',
      'schoolId_1_academicYear_1_isDeleted_1_createdAt_-1',
      'schoolId_1_classIds_1_status_1_startDate_1_endDate_1_isDeleted_1',
      'schoolId_1_academicYear_1_isDeleted_1',
      'schoolId_1_academicYear_1',
    ];

    try {
      for (const name of collectionNames) {
        await db.createCollection(name);
        await db
          .collection(name)
          .createIndex({ __releaseGateSentinel: 1 }, { name: 'release_gate_sentinel' });
      }

      await academicsIndexes.up(db, { dryRun: false });

      const createdNames = [];
      for (const name of collectionNames) {
        const names = (await db.collection(name).indexes()).map((index) => index.name);
        createdNames.push(...names.filter((indexName) => indexName !== '_id_'));
      }
      expect(createdNames).toEqual(expect.arrayContaining(releaseIndexNames));

      await academicsIndexes.down(db, { dryRun: false });

      const remainingReleaseIndexes = [];
      for (const name of collectionNames) {
        const names = (await db.collection(name).indexes()).map((index) => index.name).sort();
        expect(names).toEqual(['_id_', 'release_gate_sentinel']);
        remainingReleaseIndexes.push(
          ...names.filter((indexName) => releaseIndexNames.includes(indexName))
        );
      }
      expect(remainingReleaseIndexes).toEqual([]);
    } finally {
      await db.dropDatabase();
    }
  });
});
