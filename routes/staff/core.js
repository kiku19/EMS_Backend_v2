import express from 'express';
import mongoose from 'mongoose';
import { Class, Staff, Student, getNextStaffCode, StaffIdConfig } from '../../database.js';
import StaffAttendance from '../../models/StaffAttendance.js';
import Session from '../../models/Session.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission, userHasPermission } from '../../middleware/permissions.js';
import { validateZod, createStaffSchema, updateStaffSchema } from '../../validators/index.js';
import { syncUsageMetrics } from '../../services/billingService.js';
import { planLimitGate } from '../../middleware/auth/planLimitGate.js';
import { archiveStaff, StaffNotFoundError } from '../../services/staffArchiveService.js';
// P7: deactivate recurring salary adjustments on soft-delete. Imported directly
// from the model (not re-exported by database.js) — the model file itself is
// owned by the Payroll agent, but importing it read-only is safe and keeps the
// cascade inside the staff delete handler per the issue split.
import SalaryAdjustment from '../../models/SalaryAdjustment.js';
import { dispatchWebhookEvent } from '../../services/webhookService.js';
import { sendWelcomeEmail } from '../../services/emailService.js';
import { sendSMS } from '../../config/sms.js';
import { piiMatch } from '../../utils/encryption.js';
import {
  scopeBySchool,
  resolveRequestSchoolId,
  buildPermissions,
  ensureUniqueUsername,
  formatStaffResponse,
  validateReporter,
  generatePassword,
} from './helpers.js';
import { buildPaginationResponse } from '../../utils/pagination.js';
import { localTodayString } from '../../utils/dateTimezone.js';

const router = express.Router();
router.use(authenticate);

// ── Helpers for the list endpoint (SCH-126 / PAG-28: server-side search + facets) ──

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCommaList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseScalar(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim();
  return v === '' ? null : v;
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikePhone(value) {
  return /^[+]?[\d\s-]{6,}$/.test(value);
}

async function findClassTeacherTarget({ schoolId, classTeacherOf, session = null }) {
  if (!classTeacherOf) return null;

  const findScopedClass = async (query) => {
    const operation = Class.findOne(
      scopeBySchool(schoolId, { ...query, isDeleted: { $ne: true } })
    );
    if (session) operation.session(session);
    return operation;
  };

  const targetClass = await findScopedClass({ name: classTeacherOf });
  if (targetClass) return targetClass;

  // Legacy clients submit "Class name-Section" rather than an id. Split on
  // the final dash so class names containing dashes keep working.
  const lastDash = classTeacherOf.lastIndexOf('-');
  if (lastDash <= 0) return null;
  return findScopedClass({
    name: classTeacherOf.slice(0, lastDash),
    section: classTeacherOf.slice(lastDash + 1).toUpperCase(),
  });
}

async function applyClassTeacherAssignment({ staffId, assignedClassId, schoolId, session }) {
  const staff = await Staff.findOne(
    scopeBySchool(schoolId, { _id: staffId, isDeleted: { $ne: true } })
  ).session(session);
  if (!staff) {
    const error = new Error('Staff not found');
    error.status = 404;
    throw error;
  }

  let targetClass = null;
  let previousTeacherId = null;
  if (assignedClassId) {
    targetClass = await Class.findOne(
      scopeBySchool(schoolId, {
        _id: assignedClassId,
        isDeleted: { $ne: true },
      })
    ).session(session);
    if (!targetClass) {
      const error = new Error('Assigned class was not found in this school');
      error.status = 404;
      throw error;
    }
    previousTeacherId = targetClass.classTeacherId;
  }

  await Class.updateMany(
    scopeBySchool(schoolId, {
      classTeacherId: staff._id,
      ...(targetClass ? { _id: { $ne: targetClass._id } } : {}),
      isDeleted: { $ne: true },
    }),
    { $unset: { classTeacherId: 1 } },
    { session }
  );

  if (targetClass) {
    await Class.updateOne(
      scopeBySchool(schoolId, { _id: targetClass._id, isDeleted: { $ne: true } }),
      { $set: { classTeacherId: staff._id } },
      { session }
    );
    await Staff.updateOne(
      scopeBySchool(schoolId, { _id: staff._id, isDeleted: { $ne: true } }),
      {
        $set: {
          isClassTeacher: true,
          classTeacherOf: `${targetClass.name}-${targetClass.section}`,
        },
      },
      { session }
    );

    if (previousTeacherId && String(previousTeacherId) !== String(staff._id)) {
      await Staff.updateOne(
        scopeBySchool(schoolId, {
          _id: previousTeacherId,
          isDeleted: { $ne: true },
        }),
        { $set: { isClassTeacher: false, classTeacherOf: null } },
        { session }
      );
    }
    return targetClass;
  }

  await Staff.updateOne(
    scopeBySchool(schoolId, { _id: staff._id, isDeleted: { $ne: true } }),
    { $set: { isClassTeacher: false, classTeacherOf: null } },
    { session }
  );
  return null;
}

async function updateClassTeacherAssignment({ staffId, assignedClassId, schoolId }) {
  const session = await mongoose.startSession();
  let assignedClass = null;

  try {
    await session.withTransaction(async (transactionSession) => {
      assignedClass = await applyClassTeacherAssignment({
        staffId,
        assignedClassId,
        schoolId,
        session: transactionSession,
      });
    });
  } finally {
    await session.endSession();
  }

  return assignedClass;
}

// Build the {$or: [...]} clause for the free-text `q` param.
// PII fields (phone, email) are encrypted at rest — substring search is not
// possible on them without decryption. When `q` looks like an email or phone,
// we additionally attempt an exact match via the deterministic HMAC hash
// (piiMatch). Non-PII text fields get a case-insensitive substring regex.
function buildSearchClause(q) {
  const esc = escapeRegex(q);
  const clauses = [
    { name: { $regex: esc, $options: 'i' } },
    { code: { $regex: esc, $options: 'i' } },
    { staffNumber: { $regex: esc, $options: 'i' } },
    { designation: { $regex: esc, $options: 'i' } },
    { role: { $regex: esc, $options: 'i' } },
  ];
  if (looksLikeEmail(q)) clauses.push(piiMatch('email', q));
  if (looksLikePhone(q)) clauses.push(piiMatch('phone', q));
  return { $or: clauses };
}

// Aggregate unique values + counts for a single field over `baseQuery`.
// `unwindArray` should be true for array fields (e.g. `role`).
//
// Note: `aggregate()` does NOT cast query values to the schema (unlike find()).
// The caller must ensure `schoolId` is a mongoose.Types.ObjectId — see
// `facetBaseQuery()` below.
async function aggregateFacet(StaffModel, baseQuery, field, { unwindArray = false } = {}) {
  const pipeline = [{ $match: baseQuery }];
  if (unwindArray) pipeline.push({ $unwind: `$${field}` });
  pipeline.push(
    { $match: { [field]: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  );
  const rows = await StaffModel.aggregate(pipeline);
  return rows.map((r) => ({ value: r._id, count: r.count }));
}

// Convert a normal Mongoose find query to an aggregation-safe query while
// optionally removing the facet currently being calculated. Other active
// filters remain in place, so counts describe the user's actual result set.
function aggregationQueryFromResult(resultQuery, excludedField) {
  const query = { ...resultQuery };
  query.schoolId = mongoose.Types.ObjectId.isValid(String(resultQuery.schoolId))
    ? new mongoose.Types.ObjectId(String(resultQuery.schoolId))
    : resultQuery.schoolId;
  if (excludedField) delete query[excludedField];
  return query;
}

// Fix: Add isDeleted filter and schoolId to Class query
// Fix 3.15: Add pagination support with backward compatibility
// SCH-126 / PAG-28: Extend paginated branch with q (search), role/department/
// employmentType/gender facet filters, today (StaffAttendance join), and a
// `facets` aggregate so the dashboard's filter pills can be driven server-side.
router.get('/', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const includePayroll = await userHasPermission(req, 'payroll', 'view');
    const baseQuery = scopeBySchool(schoolId, { isDeleted: { $ne: true } });
    const isPaginated = req.query.page !== undefined;

    const q = parseScalar(req.query.q);
    const roleFilters = parseCommaList(req.query.role);
    const department = parseScalar(req.query.department);
    const employmentType = parseScalar(req.query.employmentType);
    const gender = parseScalar(req.query.gender);
    const status = parseScalar(req.query.status);
    const todayOnly = String(req.query.today) === 'true';

    // Filter that drives the paged result. Facet filters apply here.
    const resultQuery = { ...baseQuery };
    if (q) resultQuery.$and = [buildSearchClause(q)];
    if (roleFilters.length > 0) resultQuery.role = { $in: roleFilters };
    if (department) resultQuery.department = department;
    if (employmentType) resultQuery.employmentType = employmentType;
    if (gender) resultQuery.gender = gender;
    if (status && status !== 'all') resultQuery.status = status;

    if (todayOnly) {
      const today = localTodayString();
      const todaysRecords = await StaffAttendance.find(
        scopeBySchool(schoolId, {
          date: today,
          status: { $in: ['present', 'absent', 'leave'] },
        })
      )
        .select('staffId')
        .lean();
      resultQuery._id = { $in: todaysRecords.map((r) => r.staffId) };
    }

    let staffList;
    let total;

    if (isPaginated) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const skip = (page - 1) * limit;

      [staffList, total] = await Promise.all([
        Staff.find(resultQuery)
          .populate('reporterId', 'name')
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Staff.countDocuments(resultQuery),
      ]);

      const staffIds = staffList.map((staff) => staff._id);
      const assignedClasses =
        staffIds.length > 0
          ? await Class.find(
              scopeBySchool(schoolId, {
                classTeacherId: { $in: staffIds },
              })
            )
              .select('name section classTeacherId')
              .lean()
          : [];

      const classMap = new Map(
        assignedClasses.map((classDoc) => [classDoc.classTeacherId.toString(), classDoc])
      );

      // Facets: computed over (baseQuery + q + today) but EXCLUDING facet
      // selections, so each pill reflects the available options given the
      // current search/attendance view. Skipping via includeFacets=false avoids
      // the 4 aggregation queries for callers that only want the page.
      const includeFacets = String(req.query.includeFacets) !== 'false';
      let facets;
      if (includeFacets) {
        const [roleFacet, deptFacet, empFacet, genderFacet] = await Promise.all([
          aggregateFacet(Staff, aggregationQueryFromResult(resultQuery, 'role'), 'role', {
            unwindArray: true,
          }),
          aggregateFacet(
            Staff,
            aggregationQueryFromResult(resultQuery, 'department'),
            'department'
          ),
          aggregateFacet(
            Staff,
            aggregationQueryFromResult(resultQuery, 'employmentType'),
            'employmentType'
          ),
          aggregateFacet(Staff, aggregationQueryFromResult(resultQuery, 'gender'), 'gender'),
        ]);
        facets = {
          role: roleFacet,
          department: deptFacet,
          employmentType: empFacet,
          gender: genderFacet,
        };
      }

      // Global aggregates (tab counts) over the FULL filtered roster — not
      // just the current page. The dashboard's All/Present-today/On-leave/
      // Inactive tabs need school-wide counts; under server pagination the
      // page only sees its own rows, so these are computed here. `present` and
      // `onLeave` derive from today's StaffAttendance records; `inactive` is a
      // status on the Staff doc itself.
      const today = localTodayString();
      // Status is the tab being counted, so keep every other active filter
      // while excluding only status itself.
      const aggregateBase = aggregationQueryFromResult(resultQuery, 'status');
      // `inactive` stays bundled (inactive+suspended+terminated): the
      // dashboard derives the "Active" tab count as `total - inactive`, so
      // unbundling it here would over-count active. The finer-grained
      // `suspended` / `terminated` facets are exposed separately (ST8 polish)
      // so their pills can show real numbers alongside the bundled total.
      const [presentTodayIds, onLeaveIds, inactiveCount, suspendedCount, terminatedCount] =
        await Promise.all([
          StaffAttendance.find(scopeBySchool(schoolId, { date: today, status: 'present' }))
            .select('staffId')
            .lean(),
          StaffAttendance.find(scopeBySchool(schoolId, { date: today, status: 'leave' }))
            .select('staffId')
            .lean(),
          Staff.countDocuments({
            ...aggregateBase,
            status: { $in: ['inactive', 'suspended', 'terminated'] },
          }),
          Staff.countDocuments({ ...aggregateBase, status: 'suspended' }),
          Staff.countDocuments({ ...aggregateBase, status: 'terminated' }),
        ]);
      const presentTodaySet = new Set(presentTodayIds.map((record) => String(record.staffId)));
      const onLeaveSet = new Set(onLeaveIds.map((record) => String(record.staffId)));
      // Present/leave counts are bounded by the filtered roster (the tab
      // shows "X of the currently-filtered staff are present today").
      const allFilteredIds = await Staff.distinct('_id', aggregateBase);
      let presentToday = 0;
      let onLeave = 0;
      for (const id of allFilteredIds) {
        const idStr = String(id);
        if (presentTodaySet.has(idStr)) presentToday++;
        if (onLeaveSet.has(idStr)) onLeave++;
      }
      const aggregates = {
        presentToday,
        onLeave,
        inactive: inactiveCount,
        suspended: suspendedCount,
        terminated: terminatedCount,
        total: allFilteredIds.length,
      };

      return res.json(
        buildPaginationResponse({
          data: staffList.map((staff) =>
            formatStaffResponse(staff, classMap.get(staff._id.toString()), { includePayroll })
          ),
          page,
          limit,
          total,
          aggregates,
          extra: facets ? { facets } : {},
        })
      );
    }

    // Backward compatible: return plain array when no page param.
    // q / facet / today filters DO apply here too, so existing consumers that
    // opt into the new params get filtered results. Unfiltered calls (the
    // current AppContext bootstrap) still get the full list.
    staffList = await Staff.find(resultQuery)
      .populate('reporterId', 'name')
      .sort({ createdAt: 1 })
      .lean();

    const staffIds = staffList.map((staff) => staff._id);
    const assignedClasses =
      staffIds.length > 0
        ? await Class.find(
            scopeBySchool(schoolId, {
              classTeacherId: { $in: staffIds },
            })
          )
            .select('name section classTeacherId')
            .lean()
        : [];

    const classMap = new Map(
      assignedClasses.map((classDoc) => [classDoc.classTeacherId.toString(), classDoc])
    );

    res.json(
      staffList.map((staff) =>
        formatStaffResponse(staff, classMap.get(staff._id.toString()), { includePayroll })
      )
    );
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToFetchStaffList') });
  }
});

// GET the next staff code (autogenerated sequence)
router.get('/next-code', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const config = await StaffIdConfig.findOne({ schoolId });
    const currentNumber = config ? config.currentNumber : 0;
    const prefix = config ? config.prefix : 'EMP';
    const separator = config ? config.separator : '';
    const includeYear = config ? config.includeYear : false;
    const digits = config ? config.digits : 3;
    const paddedNumber = String(currentNumber + 1).padStart(digits, '0');
    const year = new Date().getFullYear();

    let staffId = prefix;
    if (separator) staffId += separator;
    if (includeYear) staffId += year + (separator || '');
    staffId += paddedNumber;

    res.json({ nextCode: staffId });
  } catch (error) {
    console.error('Error fetching next staff code:', error);
    res.status(500).json({ error: 'Failed to fetch next staff code' });
  }
});

// Fix: Add isDeleted filter and schoolId to Class query
router.get('/:id', checkPermission('staff', 'view'), async (req, res) => {
  try {
    const includePayroll = await userHasPermission(req, 'payroll', 'view');
    const staff = await Staff.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).populate('reporterId', 'name');
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    const assignedClass = await Class.findOne(
      scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id })
    );
    res.json(formatStaffResponse(staff, assignedClass, { includePayroll }));
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToFetchStaffDetails') });
  }
});

router.post(
  '/',
  checkPermission('staff', 'create'),
  planLimitGate('staff'),
  validateZod(createStaffSchema),
  async (req, res) => {
    try {
      const {
        name,
        role,
        department,
        status,
        phone,
        email,
        joinDate,
        address,
        reporterId,
        dob,
        gender,
        fatherName,
        bloodGroup,
        maritalStatus,
        employmentType,
        emergencyContact,
        emergencyPhone,
        emergencyContacts,
        whatsappNumber,
        isWhatsapp,
        picture,
        idDocuments,
        professionalQualifications,
        totalExperience,
        previousOrganization,
        roleInOrganization,
        qualificationDocs,
        customDocuments,
        staffNumber,
        staffType,
        assignedClasses,
        assignedClassId,
        isClassTeacher,
        classTeacherOf,
        accountNumber,
        ifscCode,
        bankName,
        branchName,
        salary,
        salaryTemplate,
        salaryBreakdown,
        panNumber,
        nationality,
        shift,
        designation,
        qualification,
        experience,
      } = req.body;

      const schoolId = await resolveRequestSchoolId(req);

      // Resolve the legacy class-name payload before creating anything. The
      // transaction below receives only an id and re-validates that class in
      // the same school, preventing a half-created class-teacher relation.
      let resolvedAssignedClassId = assignedClassId || undefined;
      if (!resolvedAssignedClassId && isClassTeacher) {
        const targetClass = await findClassTeacherTarget({
          schoolId,
          classTeacherOf,
        });
        if (!targetClass) {
          return res.status(400).json({
            error: 'The selected class was not found in this school',
          });
        }
        resolvedAssignedClassId = targetClass._id;
      }

      const reporterError = await validateReporter(reporterId, null, schoolId);
      if (reporterError) {
        return res.status(400).json({ error: reporterError });
      }

      // Fix 3.12: Lowercase email for duplicate check and save
      if (email) {
        const existingByEmail = await Staff.findOne(
          scopeBySchool(schoolId, {
            ...piiMatch('email', email.toLowerCase()),
            isDeleted: { $ne: true },
          })
        );
        if (existingByEmail) {
          return res.status(409).json({
            error: `Email already used by ${existingByEmail.name} (${existingByEmail.code})`,
          });
        }
      }

      // BUG-19: Check phone uniqueness within school
      if (phone) {
        const existingByPhone = await Staff.findOne(
          scopeBySchool(schoolId, { ...piiMatch('phone', phone), isDeleted: { $ne: true } })
        );
        if (existingByPhone) {
          return res.status(409).json({
            error: `Phone number already used by ${existingByPhone.name} (${existingByPhone.code})`,
          });
        }
      }

      // Fix 1.2/1.3: Pass schoolId for per-school atomic code generation
      // ST15: the staff code is generated as late as possible — inside the
      // creation transaction, immediately before the save. `getNextStaffCode`
      // (in database.js) now accepts an optional mongoose session, so its
      // `findOneAndUpdate($inc)` participates in this transaction and is rolled
      // back if the save/assignment fails — no more counter gaps (ST15).
      const password = generatePassword(8);

      let staff = new Staff({
        schoolId,
        name,
        role: role || staffType,
        department: department || 'General',
        status: status || 'active',
        phone,
        email: email?.toLowerCase(),
        joinDate,
        address,
        password,
        reporterId: reporterId || null,
        dob,
        gender,
        fatherName,
        bloodGroup,
        maritalStatus,
        employmentType,
        emergencyContact,
        emergencyPhone,
        emergencyContacts,
        whatsappNumber,
        isWhatsapp,
        picture,
        photo: picture,
        idDocuments,
        professionalQualifications,
        totalExperience,
        previousOrganization,
        roleInOrganization,
        qualificationDocs,
        customDocuments,
        staffNumber,
        staffType,
        assignedClasses,
        accountNumber,
        ifscCode,
        bankName,
        branchName,
        salary,
        salaryTemplate,
        salaryBreakdown,
        panNumber,
        nationality,
        shift,
        designation,
        qualification,
        experience,
      });

      let assignedClass = null;
      // Declared in the outer scope so the generated code/username remain
      // available for the post-commit response / SMS after the transaction.
      let generatedCode = '';
      let username = '';
      const creationSession = await mongoose.startSession();
      try {
        await creationSession.withTransaction(async (transactionSession) => {
          // Generate code + username here (late as possible) and assign onto
          // the in-memory instance before the transactional save.
          generatedCode = await getNextStaffCode(schoolId, transactionSession);
          const baseUsername = email
            ? email.split('@')[0].toLowerCase()
            : generatedCode.toLowerCase();
          username = await ensureUniqueUsername(baseUsername, schoolId);
          staff.code = generatedCode;
          staff.username = username;

          await staff.save({ session: transactionSession });
          if (resolvedAssignedClassId) {
            assignedClass = await applyClassTeacherAssignment({
              staffId: staff._id,
              assignedClassId: resolvedAssignedClassId,
              schoolId,
              session: transactionSession,
            });
          }
        });
      } finally {
        await creationSession.endSession();
      }

      // The assignment helper uses direct updates so refresh the instance used
      // for the response and all post-commit side effects.
      staff = await Staff.findOne(
        scopeBySchool(schoolId, { _id: staff._id, isDeleted: { $ne: true } })
      ).populate('reporterId', 'name');

      dispatchWebhookEvent(schoolId, 'staff.created', {
        id: staff._id,
        name: staff.name,
        role: staff.role,
        department: staff.department,
        code: staff.code,
      }).catch(() => {});

      // AUDIT-312: Send auto-generated credentials to new staff via email/SMS
      if (staff.email) {
        sendWelcomeEmail({ name: staff.name, email: staff.email }, password).catch(() => {});
      }
      if (phone) {
        sendSMS(
          phone,
          `Welcome! Your login credentials — Username: ${username}, Password: ${password}. Please change your password after first login.`
        ).catch(() => {});
      }

      // The staff record is already committed. Billing telemetry is a
      // best-effort side effect and must not turn a successful create into a
      // misleading 500 that invites a duplicate retry.
      syncUsageMetrics(schoolId).catch(() => {});
      await buildPermissions(staff.role, staff._id, schoolId);

      // Fix 3.10: Do not return password in response - credentials should be sent via email/SMS
      const includePayroll = await userHasPermission(req, 'payroll', 'view');
      res.status(201).json({
        ...formatStaffResponse(staff, assignedClass, { includePayroll }),
        username,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message,
        details: error.details,
      });
    }
  }
);

// Fix 2.1: Add Joi validation middleware
// Fix 2.9: Add salary, panNumber, nationality, shift, designation, qualification, experience to destructuring
router.put(
  '/:id',
  checkPermission('staff', 'edit'),
  validateZod(updateStaffSchema),
  async (req, res) => {
    try {
      const {
        name,
        role,
        department,
        status,
        phone,
        email,
        joinDate,
        address,
        assignedClassId,
        username,
        password,
        reporterId,
        dob,
        gender,
        fatherName,
        bloodGroup,
        maritalStatus,
        employmentType,
        emergencyContact,
        emergencyPhone,
        emergencyContacts,
        whatsappNumber,
        isWhatsapp,
        picture,
        idDocuments,
        customDocuments,
        professionalQualifications,
        totalExperience,
        previousOrganization,
        roleInOrganization,
        qualificationDocs,
        staffNumber,
        staffType,
        assignedClasses,
        isClassTeacher,
        classTeacherOf,
        accountNumber,
        ifscCode,
        bankName,
        branchName,
        panNumber,
        salary,
        salaryTemplate,
        salaryBreakdown,
        nationality,
        shift,
        designation,
        qualification,
        experience,
      } = req.body;

      const reporterError = await validateReporter(reporterId, req.params.id, req.user?.schoolId);
      if (reporterError) {
        return res.status(400).json({ error: reporterError });
      }

      // BUG-19: Check phone uniqueness within school on update
      if (phone) {
        const existingByPhone = await Staff.findOne(
          scopeBySchool(req.user?.schoolId, {
            ...piiMatch('phone', phone),
            _id: { $ne: req.params.id },
            isDeleted: { $ne: true },
          })
        );
        if (existingByPhone) {
          return res.status(400).json({
            error: `Phone number already used by ${existingByPhone.name} (${existingByPhone.code})`,
          });
        }
      }

      // AUDIT-313: Check email uniqueness within school on update
      if (email) {
        const existingByEmail = await Staff.findOne(
          scopeBySchool(req.user?.schoolId, {
            ...piiMatch('email', email.toLowerCase()),
            _id: { $ne: req.params.id },
            isDeleted: { $ne: true },
          })
        );
        if (existingByEmail) {
          return res.status(409).json({
            error: `Email already used by ${existingByEmail.name} (${existingByEmail.code})`,
          });
        }
      }

      // isClassTeacher / classTeacherOf are server-derived from the class-
      // teacher assignment block below. Accepting them here would let a
      // caller send `{isClassTeacher: true, classTeacherOf: '5-A'}` and flip
      // the Staff flags without ever updating Class.classTeacherId — the
      // two collections would drift. Callers that want to change class-
      // teacher status MUST send `assignedClassId` (or the legacy
      // `classTeacherOf` string which we resolve into one below).
      const updateData = {
        name,
        role,
        department,
        status,
        phone,
        email: email?.toLowerCase(),
        joinDate,
        address,
        dob,
        gender,
        fatherName,
        bloodGroup,
        maritalStatus,
        employmentType,
        emergencyContact,
        emergencyPhone,
        emergencyContacts,
        whatsappNumber,
        isWhatsapp,
        picture,
        photo: picture,
        idDocuments,
        customDocuments,
        professionalQualifications,
        totalExperience,
        previousOrganization,
        roleInOrganization,
        qualificationDocs,
        staffNumber,
        staffType,
        assignedClasses,
        accountNumber,
        ifscCode,
        bankName,
        branchName,
        panNumber,
        salary,
        salaryTemplate,
        salaryBreakdown,
        nationality,
        shift,
        designation,
        qualification,
        experience,
      };

      if (username) {
        updateData.username = username;
      }
      if (reporterId !== undefined) {
        updateData.reporterId = reporterId || null;
      }

      // ST7: when a salaryBreakdown is supplied on edit, keep `salary` in sync
      // with the sum of its components — unless the caller explicitly sent a
      // `salary` value (which wins). Previously the payroll base was never
      // recomputed, so editing breakdown components left `salary` stale.
      if (Array.isArray(salaryBreakdown) && salaryBreakdown.length > 0) {
        updateData.salaryBreakdown = salaryBreakdown;
        if (salary === undefined) {
          const total = salaryBreakdown.reduce(
            (sum, item) => sum + (parseFloat(item?.amount) || 0),
            0
          );
          updateData.salary = total;
        }
      }

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      let passwordReset = false;
      if (password) {
        // Staff's findOneAndUpdate middleware owns password hashing. Hashing
        // here as well produced bcrypt(hash(password)), making the new
        // password impossible to use.
        updateData.password = password;
        passwordReset = true;
      }

      // Fix: Add isDeleted filter to update query. When an admin resets
      // another staff's password, also bump tokenVersion so any outstanding
      // access / refresh tokens are invalidated, and write an AuditTrail
      // row for compliance (previously silent).
      const updateDoc = passwordReset
        ? { $set: updateData, $inc: { tokenVersion: 1 } }
        : updateData;
      let staff = await Staff.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
        updateDoc,
        { new: true }
      ).populate('reporterId', 'name');
      if (!staff) {
        return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
      }
      if (passwordReset) {
        // Access tokens issued by normal login carry a sessionId. Revoke all
        // active sessions for the target account immediately; tokenVersion
        // above invalidates refresh tokens as a second line of defence.
        await Session.updateMany(
          {
            userId: staff._id,
            schoolId: req.user?.schoolId,
            isRevoked: { $ne: true },
          },
          { $set: { isRevoked: true, revokedAt: new Date() } }
        );
        try {
          const { default: AuditTrail } = await import('../../models/AuditTrail.js');
          await AuditTrail.create({
            schoolId: req.user?.schoolId,
            userId: req.user?.id,
            userName: req.user?.name || null,
            action: 'staff_password_reset',
            entity: 'Staff',
            entityId: req.params.id,
            method: 'PUT',
            path: req.path,
            newValue: { resetBy: req.user?.id, targetStaffId: req.params.id },
          });
        } catch {
          // Audit failure must not block the update
        }
      }

      if (role) {
        await buildPermissions(role, staff._id, staff.schoolId || req.user?.schoolId || null);
      }

      // Back-compat: resolve the legacy shape `{isClassTeacher,
      // classTeacherOf: 'ClassName-Section'}` into an assignedClassId so
      // the single authoritative branch below handles both sides.
      let resolvedAssignedClassId = assignedClassId;
      if (resolvedAssignedClassId === undefined && isClassTeacher !== undefined) {
        if (isClassTeacher && classTeacherOf) {
          const target = await findClassTeacherTarget({
            schoolId: req.user?.schoolId,
            classTeacherOf,
          });
          if (!target) {
            return res.status(400).json({
              error: 'The selected class was not found in this school',
            });
          }
          resolvedAssignedClassId = target._id;
        } else if (!isClassTeacher) {
          // Explicit unassign via the legacy shape
          resolvedAssignedClassId = null;
        }
      }

      // Class.classTeacherId, the selected staff flags, and any displaced
      // teacher flags commit together so the two collections cannot drift.
      if (resolvedAssignedClassId !== undefined) {
        await updateClassTeacherAssignment({
          staffId: staff._id,
          assignedClassId: resolvedAssignedClassId,
          schoolId: req.user?.schoolId,
        });
        staff = await Staff.findOne(
          scopeBySchool(req.user?.schoolId, { _id: staff._id, isDeleted: { $ne: true } })
        ).populate('reporterId', 'name');
      }

      const assignedClass = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { classTeacherId: staff._id })
      );
      const io = req.app.get('io');
      if (io) {
        io.emit('staff_updated', {
          staffId: staff._id.toString(),
          name: staff.name,
          role: staff.role,
          department: staff.department,
          status: staff.status,
          phone: staff.phone,
          email: staff.email,
          picture: staff.picture,
          photo: staff.photo || staff.picture,
          timestamp: new Date(),
        });
      }

      const includePayroll = await userHasPermission(req, 'payroll', 'view');
      res.json(formatStaffResponse(staff, assignedClass, { includePayroll }));
    } catch (error) {
      res.status(error.status || 500).json({
        error:
          error.status && error.message
            ? error.message
            : req.t('common:routes.failedToUpdateStaffMember'),
      });
    }
  }
);

// Reversible archive. Historical and financial records are intentionally
// preserved; only active account/class-teacher state changes transactionally.
router.delete('/:id', checkPermission('staff', 'delete'), async (req, res) => {
  try {
    const { staff } = await archiveStaff({
      staffId: req.params.id,
      schoolId: req.user?.schoolId,
      deletedBy: req.user?.id || req.user?._id,
    });

    // Archival has committed at this point. A metrics outage must not report
    // failure and prompt a retry against an already-archived account.
    if (staff.schoolId) syncUsageMetrics(staff.schoolId).catch(() => {});

    // P7: cascade-deactivate recurring salary adjustments so future payroll
    // runs stop applying them for this (now archived) employee. Best-effort —
    // historical PayrollRecords are preserved; only the recurring template is
    // turned off. The Payroll agent owns the payroll-run fetch filter side.
    SalaryAdjustment.updateMany(
      { employeeId: staff._id, isRecurring: true },
      { $set: { isActive: false } }
    ).catch((err) =>
      console.error('Failed to deactivate recurring salary adjustments on staff delete:', err)
    );

    res.json({ success: true });
  } catch (error) {
    if (error instanceof StaffNotFoundError) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }
    res.status(500).json({ error: req.t('common:routes.failedToDeleteStaffMember') });
  }
});

export default router;
