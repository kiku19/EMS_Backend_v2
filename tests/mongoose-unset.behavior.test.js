// Empirical test: does `delete doc.field` vs `doc.field = undefined` actually
// unset a field with a default on Mongoose save()? Resolves the C3 disagreement.
// Uses a SEPARATE mongoose instance + standalone MongoMemoryServer to avoid
// clashing with the global replSet connection.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongoServer = await MongoMemoryServer.create();
const conn = mongoose.createConnection();

const schema = new mongoose.Schema({
  name: String,
  paymentMethod: { type: String, enum: ['bank_transfer', 'cash'], default: 'bank_transfer' },
  paymentReference: String,
});
const Model = conn.model('UnsetProbe', schema);

beforeAll(async () => {
  await conn.openUri(mongoServer.getUri());
});

afterAll(async () => {
  await conn.close();
  if (mongoServer) await mongoServer.stop();
});

describe('Mongoose unset behavior (C3)', () => {
  it('delete + save is a NO-OP on a Mongoose document (field keeps its value)', async () => {
    const doc = await Model.create({
      name: 'a',
      paymentMethod: 'cash',
      paymentReference: 'NEFT-1',
    });
    delete doc.paymentMethod;
    delete doc.paymentReference;
    await doc.save();
    const reloaded = await Model.findById(doc._id).lean();
    // delete on a Mongoose document does not unset — the prior value persists.
    expect(reloaded.paymentMethod).toBe('cash');
    expect(reloaded.paymentReference).toBe('NEFT-1');
  });

  it('= undefined + save unsets both fields', async () => {
    const doc = await Model.create({
      name: 'b',
      paymentMethod: 'cash',
      paymentReference: 'NEFT-2',
    });
    doc.paymentMethod = undefined;
    doc.paymentReference = undefined;
    await doc.save();
    const reloaded = await Model.findById(doc._id).lean();
    expect(reloaded.paymentMethod).toBeUndefined();
    expect(reloaded.paymentReference).toBeUndefined();
  });
});
