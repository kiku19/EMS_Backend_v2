/**
 * Global Full-Text Search
 *
 * GET /search?q=...&types=students,staff,classes&limit=10&page=1
 *
 * Atlas Search mode (ENABLE_ATLAS_SEARCH=true):
 *   Requires search indexes on each collection — see index definitions below.
 *   Atlas index name convention: ems_<collection>_search
 *
 *   Students index definition (create in Atlas UI or CLI):
 *   {
 *     "name": "ems_students_search",
 *     "definition": {
 *       "mappings": {
 *         "dynamic": false,
 *         "fields": {
 *           "schoolId": { "type": "objectId" },
 *           "name": { "type": "string", "analyzer": "lucene.standard" },
 *           "admissionId": { "type": "string" },
 *           "email": { "type": "string" },
 *           "parents.name": { "type": "string", "analyzer": "lucene.standard" }
 *         }
 *       }
 *     }
 *   }
 *
 *   Staff index definition:
 *   { "name": "ems_staff_search", "definition": { "mappings": { "dynamic": false,
 *     "fields": {
 *       "schoolId": { "type": "objectId" },
 *       "name": { "type": "string", "analyzer": "lucene.standard" },
 *       "code": { "type": "string" },
 *       "phone": { "type": "string" },
 *       "email": { "type": "string" },
 *       "department": { "type": "string" }
 *     }
 *   }}}
 *
 *   Classes index definition:
 *   { "name": "ems_classes_search", "definition": { "mappings": { "dynamic": false,
 *     "fields": {
 *       "schoolId": { "type": "objectId" },
 *       "name": { "type": "string" },
 *       "section": { "type": "string" },
 *       "classTag": { "type": "string" }
 *     }
 *   }}}
 *
 *   Note: Fees search always uses regex (student name requires $lookup; not indexable in Atlas without denormalization).
 */

import express from 'express';
import mongoose from 'mongoose';
import { Student, Staff, Class, Exam, Announcement } from '../database.js';
import FeePayment from '../models/FeePayment.js';
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import { searchQuerySchema } from '../validators/searchSchema.js';
import { piiMatch } from '../utils/encryption.js';

const router = express.Router();
router.use(authenticate);

const ATLAS_SEARCH_ENABLED = process.env.ENABLE_ATLAS_SEARCH === 'true';

// ─── Search Analytics (lightweight inline model) ──────────────────────────────
const searchAnalyticsSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId },
    query: { type: String, required: true },
    types: [String],
    resultCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

searchAnalyticsSchema.index({ schoolId: 1, createdAt: -1 });

const SearchAnalytics =
  mongoose.models.SearchAnalytics || mongoose.model('SearchAnalytics', searchAnalyticsSchema);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Atlas Search pipelines ───────────────────────────────────────────────────

function atlasStudentsPipeline(q, schoolId, limit, skip) {
  return [
    {
      $search: {
        index: 'ems_students_search',
        compound: {
          filter: [{ equals: { path: 'schoolId', value: new mongoose.Types.ObjectId(schoolId) } }],
          should: [
            { text: { query: q, path: ['name', 'parents.name'], fuzzy: { maxEdits: 1 } } },
            { text: { query: q, path: ['admissionId', 'email'] } },
          ],
          minimumShouldMatch: 1,
        },
      },
    },
    { $match: { isDeleted: { $ne: true } } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        name: 1,
        admissionId: 1,
        classId: 1,
        status: 1,
        picture: 1,
        gender: 1,
        academicYear: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ];
}

function atlasStaffPipeline(q, schoolId, limit, skip) {
  return [
    {
      $search: {
        index: 'ems_staff_search',
        compound: {
          filter: [{ equals: { path: 'schoolId', value: new mongoose.Types.ObjectId(schoolId) } }],
          should: [
            { text: { query: q, path: ['name', 'department'], fuzzy: { maxEdits: 1 } } },
            { text: { query: q, path: ['code', 'phone', 'email'] } },
          ],
          minimumShouldMatch: 1,
        },
      },
    },
    { $match: { isDeleted: { $ne: true } } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        name: 1,
        code: 1,
        role: 1,
        department: 1,
        status: 1,
        picture: 1,
        phone: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ];
}

function atlasClassesPipeline(q, schoolId, limit, skip, academicYear) {
  const filter = [{ equals: { path: 'schoolId', value: new mongoose.Types.ObjectId(schoolId) } }];
  return [
    {
      $search: {
        index: 'ems_classes_search',
        compound: {
          filter,
          should: [{ text: { query: q, path: ['name', 'section', 'classTag'] } }],
          minimumShouldMatch: 1,
        },
      },
    },
    { $match: { isDeleted: { $ne: true }, ...(academicYear ? { academicYear } : {}) } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        name: 1,
        section: 1,
        academicYear: 1,
        room: 1,
        classTag: 1,
        classTeacherId: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ];
}

// ─── Regex (fallback) search ──────────────────────────────────────────────────

async function regexSearchStudents(q, schoolId, limit, skip, academicYear) {
  const regex = new RegExp(escapeRegex(q), 'i');
  const emailMatch = piiMatch('email', q);
  const match = {
    schoolId: new mongoose.Types.ObjectId(schoolId),
    isDeleted: { $ne: true },
    $or: [
      { name: regex },
      { admissionId: regex },
      ...(emailMatch.$or || [emailMatch]),
      { 'parents.name': regex },
    ],
  };
  if (academicYear) match.academicYear = academicYear;

  return Student.find(match)
    .select('name admissionId classId status picture gender academicYear')
    .skip(skip)
    .limit(limit)
    .lean();
}

async function regexSearchStaff(q, schoolId, limit, skip) {
  const regex = new RegExp(escapeRegex(q), 'i');
  const phoneMatch = piiMatch('phone', q);
  const emailMatch = piiMatch('email', q);
  const match = {
    schoolId: new mongoose.Types.ObjectId(schoolId),
    isDeleted: { $ne: true },
    $or: [
      { name: regex },
      { code: regex },
      ...(phoneMatch.$or || [phoneMatch]),
      ...(emailMatch.$or || [emailMatch]),
      { department: regex },
    ],
  };

  return Staff.find(match)
    .select('name code role department status picture phone')
    .skip(skip)
    .limit(limit)
    .lean();
}

async function regexSearchClasses(q, schoolId, limit, skip, academicYear) {
  const regex = new RegExp(escapeRegex(q), 'i');
  const match = {
    schoolId: new mongoose.Types.ObjectId(schoolId),
    isDeleted: { $ne: true },
    $or: [{ name: regex }, { section: regex }, { classTag: regex }],
  };
  if (academicYear) match.academicYear = academicYear;

  return Class.find(match)
    .select('name section academicYear room classTag classTeacherId')
    .skip(skip)
    .limit(limit)
    .lean();
}

// ─── Fee Payments search (always regex — student name requires $lookup) ───────

async function regexSearchFees(q, schoolId, limit, skip, academicYear) {
  const regex = new RegExp(escapeRegex(q), 'i');

  // Find students matching the name for cross-reference
  const matchingStudents = await Student.find({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    isDeleted: { $ne: true },
    name: regex,
  })
    .select('_id')
    .lean();
  const studentIds = matchingStudents.map((s) => s._id);

  const orClauses = [{ receiptNumber: regex }];
  if (studentIds.length) orClauses.push({ studentId: { $in: studentIds } });

  const match = {
    schoolId: new mongoose.Types.ObjectId(schoolId),
    $or: orClauses,
  };
  if (academicYear) match.academicYear = academicYear;

  return FeePayment.find(match)
    .select('receiptNumber studentId amount paymentDate paymentMode status academicYear')
    .populate('studentId', 'name admissionId')
    .skip(skip)
    .limit(limit)
    .lean();
}

async function regexSearchExams(q, schoolId, limit, skip, academicYear) {
  const regex = new RegExp(escapeRegex(q), 'i');
  const match = {
    schoolId: new mongoose.Types.ObjectId(schoolId),
    isDeleted: { $ne: true },
    $or: [{ name: regex }, { type: regex }, { subjectName: regex }],
  };
  if (academicYear) match.academicYear = academicYear;

  return Exam.find(match)
    .select('name type status classId subjectName startDate endDate academicYear')
    .populate('classId', 'name section')
    .skip(skip)
    .limit(limit)
    .lean();
}

async function regexSearchAnnouncements(q, schoolId, limit, skip) {
  const regex = new RegExp(escapeRegex(q), 'i');
  return Announcement.find({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    isDeleted: { $ne: true },
    $or: [{ title: regex }, { content: regex }],
  })
    .select('title status channels createdAt')
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .lean();
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Global full-text search across students, staff, and classes
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 1, maxLength: 200 }
 *         description: Search query string
 *       - in: query
 *         name: types
 *         schema: { type: string, example: "students,staff,classes" }
 *         description: "Comma-separated entity types to search (default: all)"
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: academicYear
 *         schema: { type: string, example: "YYYY-YY" }
 *     responses:
 *       200:
 *         description: Search results grouped by entity type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 q: { type: string }
 *                 mode: { type: string, enum: [atlas, regex] }
 *                 students:
 *                   type: object
 *                   properties:
 *                     results: { type: array }
 *                     count: { type: integer }
 *                 staff:
 *                   type: object
 *                   properties:
 *                     results: { type: array }
 *                     count: { type: integer }
 *                 classes:
 *                   type: object
 *                   properties:
 *                     results: { type: array }
 *                     count: { type: integer }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', validateZod(searchQuerySchema, 'query'), async (req, res) => {
  try {
    const { q, types, limit, page, academicYear } = req.query;
    const schoolId = req.user.schoolId;
    const skip = (page - 1) * limit;

    const results = {};

    await Promise.all([
      (async () => {
        if (!types.includes('students')) return;
        let docs;
        if (ATLAS_SEARCH_ENABLED) {
          docs = await Student.aggregate(atlasStudentsPipeline(q, schoolId, limit, skip));
        } else {
          docs = await regexSearchStudents(q, schoolId, limit, skip, academicYear);
        }
        results.students = { results: docs, count: docs.length };
      })(),

      (async () => {
        if (!types.includes('staff')) return;
        let docs;
        if (ATLAS_SEARCH_ENABLED) {
          docs = await Staff.aggregate(atlasStaffPipeline(q, schoolId, limit, skip));
        } else {
          docs = await regexSearchStaff(q, schoolId, limit, skip);
        }
        results.staff = { results: docs, count: docs.length };
      })(),

      (async () => {
        if (!types.includes('classes')) return;
        let docs;
        if (ATLAS_SEARCH_ENABLED) {
          docs = await Class.aggregate(
            atlasClassesPipeline(q, schoolId, limit, skip, academicYear)
          );
        } else {
          docs = await regexSearchClasses(q, schoolId, limit, skip, academicYear);
        }
        results.classes = { results: docs, count: docs.length };
      })(),

      (async () => {
        if (!types.includes('fees')) return;
        // Fee search always uses regex (student name lookup requires join)
        const docs = await regexSearchFees(q, schoolId, limit, skip, academicYear);
        results.fees = { results: docs, count: docs.length };
      })(),

      (async () => {
        if (!types.includes('exams')) return;
        const docs = await regexSearchExams(q, schoolId, limit, skip, academicYear);
        results.exams = { results: docs, count: docs.length };
      })(),

      (async () => {
        if (!types.includes('announcements')) return;
        const docs = await regexSearchAnnouncements(q, schoolId, limit, skip);
        results.announcements = { results: docs, count: docs.length };
      })(),
    ]);

    const totalCount = Object.values(results).reduce((sum, r) => sum + (r?.count || 0), 0);

    // Fire-and-forget analytics
    SearchAnalytics.create({
      schoolId,
      userId: req.user._id || req.user.id,
      query: q,
      types,
      resultCount: totalCount,
    }).catch(() => {});

    res.json({
      q,
      mode: ATLAS_SEARCH_ENABLED ? 'atlas' : 'regex',
      page,
      limit,
      ...results,
    });
  } catch (err) {
    res.status(500).json({ error: req.t('common:routes.searchFailed'), message: err.message });
  }
});

// ─── Analytics: top queries for this school ───────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const days = Math.min(parseInt(req.query.days ?? '30', 10), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const topQueries = await SearchAnalytics.aggregate([
      { $match: { schoolId: new mongoose.Types.ObjectId(schoolId), createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $toLower: '$query' },
          count: { $sum: 1 },
          avgResults: { $avg: '$resultCount' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, query: '$_id', count: 1, avgResults: { $round: ['$avgResults', 0] } } },
    ]);

    res.json({ days, topQueries });
  } catch (err) {
    res
      .status(500)
      .json({ error: req.t('common:routes.analyticsFetchFailed'), message: err.message });
  }
});

export default router;
