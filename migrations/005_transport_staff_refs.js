/**
 * Transport Module: Establish Proper Staff References
 *
 * Migrates Vehicle.driver and Vehicle.conductor from embedded plain-text
 * objects to driverId / conductorId references into the Staff collection.
 *
 * For each vehicle with an existing driver.name or conductor.name, we
 * attempt to match a Staff record in the same school by name (case-insensitive).
 * If a unique match is found, the corresponding ID is set. Old embedded
 * objects are then removed. Driver license data is preserved as vehicle-level
 * fields.
 */

export const description =
  'Migrate Vehicle.driver/conductor embedded objects to Staff references (driverId/conductorId)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STATUS_PRIORITY = {
  active: 0,
  'on-leave': 1,
  inactive: 2,
  suspended: 3,
  terminated: 4,
};

function getStatusPriority(status) {
  return STATUS_PRIORITY[status] ?? 99;
}

async function findStaffByName(db, schoolId, name) {
  if (!name || !schoolId) return null;
  const staffColl = db.collection('staffs');
  // Fetch all matches and pick the one with the best status priority
  const matches = await staffColl
    .find({
      schoolId,
      name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') },
      isDeleted: { $ne: true },
    })
    .toArray();

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Sort by status priority (active first) and return the best match
  matches.sort((a, b) => getStatusPriority(a.status) - getStatusPriority(b.status));
  return matches[0];
}

// ---------------------------------------------------------------------------
// Up
// ---------------------------------------------------------------------------

export async function up(db, { dryRun = false } = {}) {
  const vehicleColl = db.collection('vehicles');
  const vehicles = await vehicleColl
    .find({
      $or: [
        { 'driver.name': { $exists: true, $ne: '' } },
        { 'conductor.name': { $exists: true, $ne: '' } },
      ],
    })
    .toArray();

  console.log(`  [INFO] Found ${vehicles.length} vehicles with legacy driver/conductor data`);

  let matchedDrivers = 0;
  let matchedConductors = 0;
  let unmatchedDrivers = 0;
  let unmatchedConductors = 0;

  for (const vehicle of vehicles) {
    const update = {};
    const unset = {};

    // Driver
    if (vehicle.driver?.name) {
      const staff = await findStaffByName(db, vehicle.schoolId, vehicle.driver.name);
      if (staff) {
        update.driverId = staff._id;
        matchedDrivers++;
      } else {
        unmatchedDrivers++;
      }
      unset.driver = '';
    } else if (vehicle.driver) {
      unset.driver = '';
    }

    // Preserve driver license info
    if (vehicle.driver?.licenseNumber) {
      update.driverLicenseNumber = vehicle.driver.licenseNumber;
    }
    if (vehicle.driver?.licenseExpiry) {
      const expiryDate = new Date(vehicle.driver.licenseExpiry);
      if (!isNaN(expiryDate.getTime())) {
        update.driverLicenseExpiry = expiryDate;
      }
    }

    // Conductor
    if (vehicle.conductor?.name) {
      const staff = await findStaffByName(db, vehicle.schoolId, vehicle.conductor.name);
      if (staff) {
        update.conductorId = staff._id;
        matchedConductors++;
      } else {
        unmatchedConductors++;
      }
      unset.conductor = '';
    } else if (vehicle.conductor) {
      unset.conductor = '';
    }

    if (Object.keys(update).length || Object.keys(unset).length) {
      const ops = {};
      if (Object.keys(update).length) ops.$set = update;
      if (Object.keys(unset).length) ops.$unset = unset;

      if (dryRun) {
        console.log(
          `  [DRY-RUN] Vehicle ${vehicle._id} (${vehicle.registrationNumber}):`,
          JSON.stringify(ops)
        );
      } else {
        await vehicleColl.updateOne({ _id: vehicle._id }, ops);
      }
    }
  }

  console.log(
    `  [INFO] Matched drivers: ${matchedDrivers}, unmatched: ${unmatchedDrivers}`
  );
  console.log(
    `  [INFO] Matched conductors: ${matchedConductors}, unmatched: ${unmatchedConductors}`
  );
}

// ---------------------------------------------------------------------------
// Down
// ---------------------------------------------------------------------------

export async function down(db, { dryRun = false } = {}) {
  const vehicleColl = db.collection('vehicles');
  const staffColl = db.collection('staffs');

  const vehicles = await vehicleColl
    .find({
      $or: [{ driverId: { $exists: true } }, { conductorId: { $exists: true } }],
    })
    .toArray();

  console.log(`  [INFO] Found ${vehicles.length} vehicles with driverId/conductorId to roll back`);

  for (const vehicle of vehicles) {
    const update = {};
    const unset = {};

    if (vehicle.driverId) {
      const staff = await staffColl.findOne({ _id: vehicle.driverId });
      update.driver = {
        name: staff?.name || '',
        phone: staff?.phone || '',
        licenseNumber: vehicle.driverLicenseNumber || '',
        licenseExpiry: vehicle.driverLicenseExpiry || null,
        photo: staff?.picture || staff?.photo || '',
      };
      unset.driverId = '';
      unset.driverLicenseNumber = '';
      unset.driverLicenseExpiry = '';
    }

    if (vehicle.conductorId) {
      const staff = await staffColl.findOne({ _id: vehicle.conductorId });
      update.conductor = {
        name: staff?.name || '',
        phone: staff?.phone || '',
        photo: staff?.picture || staff?.photo || '',
      };
      unset.conductorId = '';
    }

    const ops = {};
    if (Object.keys(update).length) ops.$set = update;
    if (Object.keys(unset).length) ops.$unset = unset;

    if (dryRun) {
      console.log(
        `  [DRY-RUN] Vehicle ${vehicle._id} (${vehicle.registrationNumber}):`,
        JSON.stringify(ops)
      );
    } else {
      await vehicleColl.updateOne({ _id: vehicle._id }, ops);
    }
  }
}
