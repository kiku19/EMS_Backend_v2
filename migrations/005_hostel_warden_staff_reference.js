/**
 * Hostel Warden Staff Reference Migration
 *
 * Maps existing plain-text wardenName fields to Staff._id references
 * and backfills denormalized wardenName/wardenPhone/wardenEmail.
 */

export const description =
  'Map existing hostel wardenName to Staff._id and backfill wardenId with denormalized fields';

export async function up(db, { dryRun }) {
  const hostelsColl = db.collection('hostels');
  const staffColl = db.collection('staffs');

  // Find hostels that have wardenName but no wardenId
  const hostels = await hostelsColl
    .find({
      wardenName: { $exists: true, $ne: null, $ne: '' },
      $or: [{ wardenId: { $exists: false } }, { wardenId: null }],
    })
    .toArray();

  console.log(`    Found ${hostels.length} hostel(s) with wardenName but no wardenId`);

  if (hostels.length === 0) {
    console.log('    [OK] Nothing to migrate');
    return;
  }

  let matched = 0;
  let unmatched = 0;

  for (const hostel of hostels) {
    const wardenName = hostel.wardenName.trim();
    const schoolId = hostel.schoolId;

    // Try exact match first, then case-insensitive
    let staff = await staffColl.findOne({
      schoolId,
      name: wardenName,
      isDeleted: { $ne: true },
    });

    if (!staff) {
      staff = await staffColl.findOne({
        schoolId,
        name: { $regex: `^${wardenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isDeleted: { $ne: true },
      });
    }

    if (staff) {
      matched++;
      console.log(
        `    [MATCH] Hostel "${hostel.name}" → Staff "${staff.name}" (${staff._id})`
      );
      if (!dryRun) {
        await hostelsColl.updateOne(
          { _id: hostel._id },
          {
            $set: {
              wardenId: staff._id,
              wardenName: staff.name || wardenName,
              wardenPhone: staff.phone || hostel.wardenPhone || '',
              wardenEmail: staff.email || hostel.wardenEmail || '',
            },
          }
        );
      }
    } else {
      unmatched++;
      console.log(
        `    [SKIP] Hostel "${hostel.name}" — no Staff match for wardenName "${wardenName}"`
      );
    }
  }

  console.log(`    [DONE] Matched: ${matched}, Unmatched: ${unmatched}`);

  // Ensure index on wardenId for cascade cleanup performance
  if (!dryRun) {
    await hostelsColl.createIndex({ schoolId: 1, wardenId: 1 });
    console.log('    [OK] Created index { schoolId: 1, wardenId: 1 }');
  }
}

export async function down(db, { dryRun }) {
  const hostelsColl = db.collection('hostels');

  const hostels = await hostelsColl
    .find({ wardenId: { $exists: true } })
    .toArray();

  console.log(`    Reverting ${hostels.length} hostel(s)`);

  if (!dryRun) {
    for (const hostel of hostels) {
      await hostelsColl.updateOne(
        { _id: hostel._id },
        { $unset: { wardenId: 1, wardenPhone: 1, wardenEmail: 1 } }
      );
    }
  }

  console.log('    [DONE] Removed wardenId and denormalized phone/email from hostels');
}
