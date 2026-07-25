import mongoose from 'mongoose';
import AuditTrail from '../models/AuditTrail.js';
import TrashItem from '../models/TrashItem.js';
import FeatureFlagAuditLog from '../models/FeatureFlagAuditLog.js';
import School from '../models/School.js';
import Staff from '../models/Staff.js';

// Activity feed — unifies three audit surfaces into one chronological feed:
//   • AuditTrail        — every mutation by school users + super-admin (Phase 1a)
//   • TrashItem         — every soft/hard deletion across all schools
//   • FeatureFlagAuditLog — flag + override changes by super-admin
//
// We normalize each source to a common event shape via $project, then $unionWith
// them and run filters + sort + pagination in one pipeline. $lookup for display
// names runs AFTER $limit so it only touches the visible page.

const SCHOOLS_COLL = School.collection.name;
const STAFF_COLL = Staff.collection.name;

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Normalization projection per source → common event shape.
const AUDIT_PROJECT = {
  $project: {
    _id: 1,
    source: { $literal: 'audit' },
    occurredAt: '$createdAt',
    schoolId: '$schoolId',
    actorType: { $ifNull: ['$actorType', 'school-user'] },
    actorName: '$userName',
    actorId: '$userId',
    action: '$action',
    entityType: '$entity',
    entityId: '$entityId',
    target: null,
    method: '$method',
    path: '$path',
  },
};

const TRASH_PROJECT = {
  $project: {
    _id: 1,
    source: { $literal: 'trash' },
    occurredAt: '$deletedAt',
    schoolId: '$schoolId',
    actorType: { $literal: 'school-user' },
    actorName: null, // resolved via Staff lookup on actorId (deletedBy)
    actorId: '$deletedBy',
    action: { $literal: 'deleted' },
    entityType: '$itemType',
    entityId: { $toString: { $ifNull: ['$itemId', '$_id'] } },
    target: '$itemName',
    method: { $literal: 'DELETE' },
    path: null,
  },
};

const FLAG_PROJECT = {
  $project: {
    _id: 1,
    source: { $literal: 'flag' },
    occurredAt: '$createdAt',
    // Overrides carry metadata.schoolId; global flag edits are platform-wide (null).
    schoolId: '$metadata.schoolId',
    actorType: { $literal: 'super-admin' },
    actorName: '$actorEmail',
    actorId: null,
    action: '$action',
    entityType: { $literal: 'feature-flag' },
    entityId: '$flagKey',
    target: '$flagKey',
    method: null,
    path: null,
  },
};

function toObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(value);
  } catch {
    return null;
  }
}

// Translate API filters into a $match object over the common shape.
function buildMatch(filters) {
  const match = {};

  if (filters.source) match.source = filters.source;

  if (filters.actorType && filters.actorType !== 'all') {
    match.actorType = filters.actorType;
  }

  if (filters.schoolId) {
    const oid = toObjectId(filters.schoolId);
    if (!oid) return { __invalid: true };
    match.schoolId = oid;
  }

  if (filters.action) match.action = filters.action;

  if (filters.entity) {
    // allow either the entity type or a free label
    match.entityType = filters.entity;
  }

  // Time window. Defaults to the last 30 days when neither bound is given so the
  // feed (and the bySource grouping) scan a bounded recent set, not all history.
  const occurredAt = {};
  if (filters.since) occurredAt.$gte = new Date(filters.since);
  if (filters.until) occurredAt.$lte = new Date(filters.until);
  if (!filters.since && !filters.until) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DEFAULT_WINDOW_DAYS);
    occurredAt.$gte = cutoff;
  }
  match.occurredAt = occurredAt;

  if (filters.q) {
    const rx = { $regex: filters.q, $options: 'i' };
    match.$or = [
      { actorName: rx },
      { entityType: rx },
      { entityId: rx },
      { target: rx },
      { path: rx },
      { action: rx },
    ];
  }

  return match;
}

export async function getActivityFeed(rawFilters) {
  const limit = Math.min(Math.max(Number(rawFilters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(Number(rawFilters.page) || 1, 1);
  const skip = (page - 1) * limit;

  const match = buildMatch(rawFilters);
  if (match.__invalid) {
    return { data: [], pagination: { total: 0, page, limit, totalPages: 0 }, bySource: [] };
  }

  const pipeline = [
    AUDIT_PROJECT,
    { $unionWith: { coll: TrashItem.collection.name, pipeline: [TRASH_PROJECT] } },
    { $unionWith: { coll: FeatureFlagAuditLog.collection.name, pipeline: [FLAG_PROJECT] } },
    { $match: match },
    { $sort: { occurredAt: -1 } },
    {
      $facet: {
        page: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: SCHOOLS_COLL,
              localField: 'schoolId',
              foreignField: '_id',
              as: '_school',
            },
          },
          {
            $lookup: { from: STAFF_COLL, localField: 'actorId', foreignField: '_id', as: '_actor' },
          },
          {
            $addFields: {
              schoolName: { $arrayElemAt: ['$_school.name', 0] },
              actorName: {
                $ifNull: ['$actorName', { $arrayElemAt: ['$_actor.name', 0] }],
              },
            },
          },
          {
            $project: {
              _school: 0,
              _actor: 0,
            },
          },
        ],
        total: [{ $count: 'count' }],
        bySource: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
      },
    },
  ];

  const [result] = await AuditTrail.aggregate(pipeline).exec();
  const rows = (result?.page || []).map((row) => ({
    ...row,
    _id: row._id.toString(),
    schoolId: row.schoolId ? row.schoolId.toString() : null,
  }));
  const total = result?.total?.[0]?.count || 0;
  const bySource = (result?.bySource || []).map((b) => ({ source: b._id, count: b.count }));

  return {
    data: rows,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    bySource,
  };
}
