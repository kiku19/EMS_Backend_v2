import mongoose from 'mongoose';
import { getCurrentSchoolId } from '../../utils/tenantAsyncContext.js';

/**
 * Global Mongoose plugin that enforces tenant (schoolId) scoping at the
 * database layer. It is applied before any model is compiled in database.js.
 *
 * For schemas that contain a `schoolId` path, every read/write query executed
 * inside an HTTP request (where the async context holds a schoolId) is
 * transparently restricted to that school. Queries that already specify a
 * schoolId are left untouched, and queries run outside a request context
 * (background jobs, migrations, super-admin flows) are not modified.
 */

const QUERY_METHODS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'count',
  'countDocuments',
  'distinct',
  'replaceOne',
];

function hasSchoolId(schema) {
  return Boolean(schema.paths.schoolId);
}

function injectSchoolIdFilter(query) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return;

  // getFilter works for Query instances; it returns a plain object.
  const filter = query.getFilter ? query.getFilter() : null;
  if (!filter || filter.schoolId !== undefined) return;

  query.setQuery({ ...filter, schoolId });
}

function injectSchoolIdAggregate(aggregate) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return;

  const schoolIdOid = new mongoose.Types.ObjectId(String(schoolId));
  const pipeline = aggregate.pipeline();
  if (pipeline.length > 0 && pipeline[0].$match && pipeline[0].$match.schoolId === undefined) {
    pipeline[0].$match.schoolId = schoolIdOid;
  } else if (pipeline.length === 0 || !pipeline[0].$match) {
    pipeline.unshift({ $match: { schoolId: schoolIdOid } });
  }
}

export default function tenantScopePlugin(schema) {
  if (!hasSchoolId(schema)) return;

  for (const method of QUERY_METHODS) {
    schema.pre(method, function (next) {
      try {
        injectSchoolIdFilter(this);
      } catch (err) {
        return next(err);
      }
      next();
    });
  }

  schema.pre('aggregate', function (next) {
    try {
      injectSchoolIdAggregate(this);
    } catch (err) {
      return next(err);
    }
    next();
  });

  schema.pre('save', function (next) {
    const schoolId = getCurrentSchoolId();
    if (schoolId && this.isNew && !this.schoolId) {
      this.schoolId = new mongoose.Types.ObjectId(String(schoolId));
    }
    next();
  });
}

// Register globally so every schema compiled after this module loads inherits
// the tenant-scope hooks. database.js imports this file before any model file.
mongoose.plugin(tenantScopePlugin);
