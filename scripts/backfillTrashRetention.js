/**
 * One-time backfill: extend existing recycle-bin items to the new 60-day
 * retention window (TRASH_RETENTION_DAYS in services/trashService.js).
 *
 * Before this change, items were auto-purged 30 days after deletion. Existing
 * items in the bin already have expiresAt = deletedAt + 30d, so without this
 * script they would still disappear at the old 30-day mark even though the
 * policy is now 60 days. This re-stamps expiresAt = deletedAt + 60d for every
 * item that hasn't been purged yet.
 *
 * Usage:
 *   node scripts/backfillTrashRetention.js            # dry-run (prints counts)
 *   node scripts/backfillTrashRetention.js --apply    # commit the change
 */

import mongoose from 'mongoose';
import TrashItem from '../models/TrashItem.js';
import { TRASH_RETENTION_DAYS } from '../services/trashService.js';

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);

  const now = new Date();
  // Only touch items the TTL index hasn't purged yet.
  const candidates = await TrashItem.find({ expiresAt: { $gt: now } }).lean();
  const ms = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  let extended = 0;
  let alreadyOk = 0;
  for (const item of candidates) {
    const desired = new Date(new Date(item.deletedAt).getTime() + ms);
    if (new Date(item.expiresAt).getTime() >= desired.getTime()) {
      alreadyOk += 1;
      continue;
    }
    if (apply) {
      await TrashItem.updateOne(
        { _id: item._id },
        { $set: { expiresAt: desired } }
      );
    }
    extended += 1;
  }

  console.log(`Retention window: ${TRASH_RETENTION_DAYS} days`);
  console.log(`Items still in bin: ${candidates.length}`);
  console.log(`Already at/above window: ${alreadyOk}`);
  console.log(`${apply ? 'Extended' : 'Would extend'}: ${extended}`);
  if (!apply && extended > 0) {
    console.log('\nRe-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
