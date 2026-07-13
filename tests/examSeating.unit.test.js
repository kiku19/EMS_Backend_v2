import { describe, expect, it } from 'vitest';
import {
  generateEntrySeating,
  generateScheduleSeating,
  buildClassroomVenues,
} from '../services/examSeating.js';

// ── Fixtures ──────────────────────────────────────────────────────────────
const mkStudents = (classId, count, startRoll = 1) =>
  Array.from({ length: count }, (_, i) => ({
    _id: `${classId}-s${i + 1}`,
    name: `${classId} Student ${i + 1}`,
    classId,
    rollNo: startRoll + i,
  }));

const hall = (over = {}) => ({
  _id: 'hall1',
  name: 'Main Hall',
  kind: 'hall',
  benchCapacity: 2,
  rows: 2,
  columns: 2, // 4 benches
  capacity: 8,
  ...over,
});

const entry = {
  _id: 'e1',
  date: new Date('2026-07-06'),
  session: 'morning',
  subjectName: 'Math',
  classIds: ['A'],
};

describe('generateEntrySeating — one student per bench (default)', () => {
  it('seats every student on their own bench when benches are plentiful', () => {
    const students = mkStudents('A', 3);
    const { seating, stats } = generateEntrySeating(entry, students, [hall()]);

    expect(stats.seated).toBe(3);
    expect(seating).toHaveLength(3);
    // Each on a distinct bench, seatInBench always 0.
    expect(new Set(seating.map((s) => s.benchIndex)).size).toBe(3);
    expect(seating.every((s) => s.seatInBench === 0)).toBe(true);
  });

  it('caps at one per bench even on double-seater furniture', () => {
    // 4 benches, benchCapacity 2, but default rule → only 4 seats.
    const students = mkStudents('A', 5);
    expect(() => generateEntrySeating(entry, students, [hall()])).toThrow(/only 4 seat/i);
  });

  it('respects a hall capacity lower than its bench count', () => {
    const students = mkStudents('A', 4);
    // 4 benches but capacity 3 → NOT_ENOUGH_SEATS for 4 students.
    expect(() => generateEntrySeating(entry, students, [hall({ capacity: 3 })])).toThrow(
      /only 3 seat/i
    );
  });
});

describe('generateEntrySeating — shareBenches (two per double-seater bench)', () => {
  it('doubles capacity and fills every bench once before doubling up', () => {
    const students = mkStudents('A', 5);
    const { seating } = generateEntrySeating(entry, students, [hall()], { shareBenches: true });

    expect(seating).toHaveLength(5);
    // Benches 0-3 each get seat 0; the 5th student shares bench 0 as seat 1.
    const shared = seating.filter((s) => s.seatInBench === 1);
    expect(shared).toHaveLength(1);
    expect(shared[0].benchIndex).toBe(0);
  });

  it('pairs bench-mates from different classes, not adjacent roll numbers', () => {
    // 3 in class A, 2 in class B; sorted A1..A3,B1,B2 → bench0 = A1 + B2.
    const students = [...mkStudents('A', 3), ...mkStudents('B', 2)];
    const { seating } = generateEntrySeating(entry, students, [hall()], { shareBenches: true });

    const bench0 = seating.filter((s) => s.benchIndex === 0);
    expect(bench0).toHaveLength(2);
    expect(bench0[0].classId).not.toBe(bench0[1].classId);
  });

  it('single-seater benches never take two even when sharing is on', () => {
    const students = mkStudents('A', 3);
    // 2 single-seater benches → only 2 seats regardless of shareBenches.
    const single = hall({ benchCapacity: 1, rows: 1, columns: 2, capacity: 4 });
    expect(() => generateEntrySeating(entry, students, [single], { shareBenches: true })).toThrow(
      /only 2 seat/i
    );
  });
});

describe('buildClassroomVenues', () => {
  it('derives a double-seater grid from class strength (one desk per two pupils)', () => {
    const [venue] = buildClassroomVenues([
      { _id: 'C1', name: 'Class 5', section: 'A', room: 'R-101', strengthLimit: { current: 40 } },
    ]);

    expect(venue.kind).toBe('classroom');
    expect(venue.name).toBe('R-101');
    expect(venue.benchCapacity).toBe(2);
    expect(venue.rows * venue.columns).toBe(20); // 40 pupils / 2 per desk
    expect(venue.capacity).toBe(40); // physical max (two per desk)
  });

  it('falls back to the class label when the room is unset, and defaults strength to 40', () => {
    const [venue] = buildClassroomVenues([{ _id: 'C2', name: 'Class 6', section: 'B' }]);
    expect(venue.name).toBe('Class 6 · B');
    expect(venue.rows * venue.columns).toBe(20);
  });
});

describe('generateScheduleSeating — pooled venues', () => {
  const classroomEntry = {
    _id: 'e1',
    date: new Date('2026-07-06'),
    session: 'morning',
    subjectName: 'Math',
    classIds: ['C1'],
  };

  it('seats a class inside its own classroom when no halls exist (one per desk)', () => {
    const venues = buildClassroomVenues([
      { _id: 'C1', name: 'Class 5', section: 'A', strengthLimit: { current: 40 } },
    ]);
    const studentsByClass = new Map([['C1', mkStudents('C1', 18)]]);

    const { perEntry } = generateScheduleSeating([classroomEntry], studentsByClass, venues);
    const result = perEntry.get('e1');
    expect(result.stats.seated).toBe(18); // 18 ≤ 20 one-per-desk seats
    expect(result.seating.every((s) => s.venueKind === 'classroom')).toBe(true);
  });

  it('fills dedicated halls before classrooms (venue order)', () => {
    const venues = [
      hall({ _id: 'H1', rows: 1, columns: 2, capacity: 2 }), // 2 seats one-per-bench
      ...buildClassroomVenues([
        { _id: 'C1', name: 'Class 5', section: 'A', strengthLimit: { current: 40 } },
      ]),
    ];
    const studentsByClass = new Map([['C1', mkStudents('C1', 3)]]);

    const { perEntry } = generateScheduleSeating([classroomEntry], studentsByClass, venues);
    const seating = perEntry.get('e1').seating;
    const inHall = seating.filter((s) => s.hallId === 'H1');
    expect(inHall).toHaveLength(2); // hall filled first
    expect(seating.filter((s) => s.venueKind === 'classroom')).toHaveLength(1); // overflow to room
  });

  it('throws NO_HALLS when the venue pool is empty', () => {
    expect(() => generateScheduleSeating([classroomEntry], new Map(), [])).toThrow(
      /no seating venues/i
    );
  });

  it('warns (not throws) when an entry has no active students', () => {
    const venues = buildClassroomVenues([
      { _id: 'C1', name: 'Class 5', section: 'A', strengthLimit: { current: 40 } },
    ]);
    const { perEntry, warnings } = generateScheduleSeating([classroomEntry], new Map(), venues);
    expect(perEntry.get('e1').seating).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});
