/**
 * Exam seating generator — pure, deterministic, no DB access.
 *
 * Given a list of exam-schedule entries (each = one paper: a subject on a
 * date+session, sat by some classes) and a list of VENUES, produces a seat map
 * per entry.
 *
 * A "venue" is anywhere students can sit an exam. Two kinds:
 *   - hall      → a dedicated ExamHall configured in Settings.
 *   - classroom → a participating class's own room, derived on the fly so the
 *                 school never has to pre-configure halls just to seat an exam.
 * Both share the same shape:
 *   { _id, name, kind, capacity, benchCapacity, rows, columns }
 *   benches = rows × columns.  benchCapacity = seats of furniture per bench (1 or 2).
 *
 * BENCH OCCUPANCY:
 *   Every student in a single entry sits the SAME subject, so two students on
 *   one bench are two same-subject papers side by side (a copying risk). By
 *   default we therefore place ONE student per bench (`shareBenches = false`).
 *   A school may opt into `shareBenches = true`, which lets double-seater benches
 *   (benchCapacity 2) hold two students. Even then we fill every bench with one
 *   student FIRST and only double up once benches run out — and bench-mates are
 *   drawn from far apart in the class-sorted order, so they're almost always
 *   from different classes rather than adjacent roll numbers.
 *
 * Layout: benches are numbered left-to-right, top-to-bottom across each venue's
 * `rows × columns` grid. Venues fill in the order given (halls before classrooms),
 * and within the pool students fill in `{ classId asc, rollNo asc }` order so
 * classmates sit together in blocks.
 *
 * Output shape per entry:
 *   seating: [{ hallId, hallName, venueKind, benchIndex (0-based, flat),
 *               benchCapacity, seatInBench (0 or 1), row, col,
 *               studentId, studentName, classId, className, rollNo }]
 */

/** Seats a venue can offer for one paper, given the bench-sharing rule. */
function venueSeatCount(venue, shareBenches) {
  const benches = (venue.rows || 1) * (venue.columns || 1);
  const perBench = shareBenches ? Math.min(venue.benchCapacity || 1, 2) : 1;
  return Math.min(venue.capacity ?? benches * perBench, benches * perBench);
}

/**
 * Build the ordered list of physical seat slots across all venues.
 *
 * Two passes so students only ever share a bench once every bench is taken:
 *   pass 0 → one seat per bench (seatInBench 0), across all venues in order.
 *   pass 1 → a second seat on shareable benches (seatInBench 1), across all
 *            venues in order — only reached when students outnumber benches.
 *
 * @returns {{ slots: object[], totalSeats: number }}
 */
function buildSeatSlots(venues, shareBenches) {
  const firstSeats = [];
  const secondSeats = [];

  for (const venue of venues) {
    const rows = venue.rows || 1;
    const cols = venue.columns || 1;
    const benches = rows * cols;
    const seats = venueSeatCount(venue, shareBenches);
    const firstCount = Math.min(benches, seats); // benches that get a lone student
    const secondCount = seats - firstCount; // benches that also get a partner

    for (let b = 0; b < firstCount; b++) {
      const slot = {
        venue,
        benchIndex: b,
        seatInBench: 0,
        row: Math.floor(b / cols),
        col: b % cols,
      };
      firstSeats.push(slot);
    }
    for (let b = 0; b < secondCount; b++) {
      const slot = {
        venue,
        benchIndex: b,
        seatInBench: 1,
        row: Math.floor(b / cols),
        col: b % cols,
      };
      secondSeats.push(slot);
    }
  }

  // First-seats everywhere, THEN second-seats everywhere. Pairing a bench's two
  // occupants across this boundary keeps them far apart in the sorted order.
  return {
    slots: firstSeats.concat(secondSeats),
    totalSeats: firstSeats.length + secondSeats.length,
  };
}

/**
 * Generate seating for one entry.
 *
 * @param {object} entry  ExamSchedule entry: { _id, date, session, subjectName, classIds[], ... }
 * @param {object[]} students  [{ _id, name, classId, className, section, rollNo }]
 *                             (already filtered to entry's classes + active)
 * @param {object[]} venues    [{ _id, name, kind, capacity, benchCapacity, rows, columns }]
 * @param {object} [opts]      { shareBenches?: boolean }
 * @returns {{ seating: array, stats: object }}
 *          Throws { code: 'NOT_ENOUGH_SEATS', required, available, message } if the
 *          venues can't hold every student.
 */
export function generateEntrySeating(entry, students, venues, opts = {}) {
  const shareBenches = !!opts.shareBenches;
  const { slots, totalSeats } = buildSeatSlots(venues, shareBenches);

  if (students.length > totalSeats) {
    const shortfall = students.length - totalSeats;
    const hint = shareBenches
      ? `Add ${shortfall} more bench(es)/capacity, or add another venue.`
      : `Add ${shortfall} more bench(es)/capacity, enable two-per-bench, or add another venue.`;
    throw Object.assign(
      new Error(
        `Need seating for ${students.length} students but only ${totalSeats} seat(s) are available across ${venues.length} venue(s). ${hint}`
      ),
      { code: 'NOT_ENOUGH_SEATS', required: students.length, available: totalSeats }
    );
  }

  // Sort students: classId asc, then rollNo asc (rollNo may be null → push to end).
  const sorted = [...students].sort((a, b) => {
    const ca = String(a.classId || '');
    const cb = String(b.classId || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    const ra = a.rollNo == null ? Infinity : a.rollNo;
    const rb = b.rollNo == null ? Infinity : b.rollNo;
    return ra - rb;
  });

  const seating = sorted.map((student, i) => {
    const slot = slots[i];
    return {
      hallId: String(slot.venue._id),
      hallName: slot.venue.name,
      venueKind: slot.venue.kind || 'hall',
      benchIndex: slot.benchIndex, // 0-based flat index within the venue
      benchCapacity: slot.venue.benchCapacity || 1,
      seatInBench: slot.seatInBench, // 0 = left/only, 1 = right (shared bench)
      row: slot.row,
      col: slot.col,
      studentId: String(student._id),
      studentName: student.name,
      classId: String(student.classId),
      className:
        student.className || student.section
          ? `${student.className || ''}${student.section ? ' · ' + student.section : ''}`
          : '',
      rollNo: student.rollNo ?? null,
    };
  });

  return { seating, stats: { seated: seating.length, total: sorted.length } };
}

/**
 * Generate seating for every entry in a schedule.
 *
 * @param {object[]} entries  schedule.entries (each with classIds[])
 * @param {Map} studentsByClass  Map<classIdString, student[]> pre-fetched
 * @param {object[]} venues     seating venues (halls + classrooms), in fill order
 * @param {object} [opts]       { shareBenches?: boolean }
 * @returns {{ perEntry: Map<entryId, {seating, stats}>, warnings: string[] }}
 */
export function generateScheduleSeating(entries, studentsByClass, venues, opts = {}) {
  if (!venues || venues.length === 0) {
    throw Object.assign(
      new Error(
        'No seating venues available. Add an exam hall in Settings, or select classes that have a room.'
      ),
      { code: 'NO_HALLS' }
    );
  }

  const perEntry = new Map();
  const warnings = [];

  for (const entry of entries) {
    const entryId = String(entry._id);
    // De-dup students across the entry's classes (a student could appear once).
    const seen = new Set();
    const students = [];
    for (const cid of entry.classIds || []) {
      const list = studentsByClass.get(String(typeof cid === 'object' ? cid._id : cid)) || [];
      for (const s of list) {
        const sid = String(s._id);
        if (seen.has(sid)) continue;
        seen.add(sid);
        students.push(s);
      }
    }

    if (students.length === 0) {
      warnings.push(
        `"${entry.subjectName}" on ${new Date(entry.date).toLocaleDateString()}: no active students found.`
      );
      perEntry.set(entryId, { seating: [], stats: { seated: 0, total: 0 } });
      continue;
    }

    try {
      const result = generateEntrySeating(entry, students, venues, opts);
      perEntry.set(entryId, result);
    } catch (err) {
      // Re-throw NOT_ENOUGH_SEATS with the paper context so the caller can show
      // an actionable error.
      if (err.code === 'NOT_ENOUGH_SEATS') {
        throw Object.assign(
          new Error(
            `"${entry.subjectName}" (${new Date(entry.date).toLocaleDateString()}, ${entry.session}): ${err.message}`
          ),
          { code: 'NOT_ENOUGH_SEATS', entryId }
        );
      }
      throw err;
    }
  }

  return { perEntry, warnings };
}

/**
 * Turn participating classes into seating venues (their own classrooms).
 *
 * A classroom normally seats `strengthLimit.current` students at two per desk,
 * so it has ~ceil(strength / 2) benches (double-seaters). In one-per-bench exam
 * mode that's ~strength/2 seats; with sharing enabled it goes back up to ~strength.
 *
 * @param {object[]} classes  [{ _id, name, section, room, block, strengthLimit }]
 * @returns {object[]} venue objects (kind: 'classroom')
 */
export function buildClassroomVenues(classes) {
  const DEFAULT_COLS = 5; // benches per row in a typical classroom grid
  return (classes || []).map((cls) => {
    const strength = cls?.strengthLimit?.current ?? cls?.strengthLimit?.default ?? 40;
    const benches = Math.max(1, Math.ceil(strength / 2)); // double-seater desks
    const columns = Math.min(DEFAULT_COLS, benches);
    const rows = Math.ceil(benches / columns);
    const label = cls.section ? `${cls.name} · ${cls.section}` : cls.name;
    return {
      _id: String(cls._id),
      name: cls.room ? String(cls.room) : label,
      block: cls.block || '',
      kind: 'classroom',
      benchCapacity: 2,
      rows,
      columns,
      capacity: benches * 2, // physical max (two per desk)
    };
  });
}
