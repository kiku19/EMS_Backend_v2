/**
 * Curriculum reference-data helpers.
 *
 * Curricula are bundled JSON (see ../data/curricula/) — read-only reference
 * data, not tied to any school. These helpers are pure and synchronous so they
 * can be used from routes and tests without a DB.
 */
import { curricula } from '../data/curricula/index.js';

const byId = new Map(curricula.map((c) => [c.id, c]));

/** Return a lightweight list for dropdowns (no per-grade subjects). */
export function listCurricula() {
  return curricula.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    gradeCount: Object.keys(c.grades || {}).length,
  }));
}

/** Return a full curriculum by id, or null if unknown. */
export function getCurriculum(id) {
  return byId.get(id) || null;
}

/**
 * Normalise a grade token to a string key like "5", or null if it isn't a
 * numeric grade ("Nursery", "LKG", "UKG", etc.). Accepts numbers and strings.
 */
export function normaliseGrade(grade) {
  if (grade === null || grade === undefined) return null;
  const str = String(grade).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isInteger(num) || num < 1 || num > 12) return null;
  return str;
}

/**
 * Subjects for a single grade of a curriculum.
 * Returns [] for an unknown curriculum, non-numeric grade, or missing grade.
 * Always returns a fresh array so callers can mutate safely.
 */
export function getSubjectsForGrade(id, grade) {
  const curriculum = getCurriculum(id);
  if (!curriculum) return [];
  const key = normaliseGrade(grade);
  if (!key) return [];
  return [...(curriculum.grades?.[key] || [])];
}

/**
 * Invert a curriculum's per-grade subject lists into the master-directory
 * shape used by SchoolSettings.subjects: one entry per subject with the grades
 * it appears in recorded under `assignedClasses`.
 *
 * @param {string} id     curriculum id
 * @param {number[]} grades  optional subset of grades to include (defaults to 1-12)
 * @returns {Array<{ name: string, code: string, assignedClasses: number[] }>}
 */
export function toMasterSubjects(id, grades) {
  const curriculum = getCurriculum(id);
  if (!curriculum) return [];

  const gradeKeys = (grades && grades.length ? grades : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    .map((g) => normaliseGrade(g))
    .filter(Boolean);

  const subjectToGrades = new Map();
  for (const key of gradeKeys) {
    for (const name of curriculum.grades?.[key] || []) {
      if (!subjectToGrades.has(name)) subjectToGrades.set(name, []);
      subjectToGrades.get(name).push(Number(key));
    }
  }

  return [...subjectToGrades.entries()]
    .map(([name, assignedClasses]) => ({
      name,
      code: '',
      assignedClasses: [...new Set(assignedClasses)].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
