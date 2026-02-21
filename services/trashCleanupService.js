/**
 * Trash Cleanup Service
 * Handles automatic purging of expired trash items
 * This service is called by the Agenda scheduler daily
 */

import { TrashItem } from '../models/TrashItem.js';
import { Student } from '../database.js';
import { StudentFeeStructure } from '../database.js';
import { Staff } from '../database.js';

/**
 * Permanently delete expired items from trash
 * This job runs daily via Agenda scheduler
 *
 * @returns {Promise<{purged: number, errors: number}>} Statistics about the cleanup operation
 */
export async function purgeExpiredTrashItems() {
  console.log('🧹 Starting trash cleanup...');

  let purged = 0;
  let errors = 0;

  try {
    // Find all expired items (older than 30 days)
    const expiredItems = await TrashItem.findExpired();

    // If no expired items, return early
    if (!expiredItems || expiredItems.length === 0) {
      console.log('✅ No expired items found in trash');
      return { purged: 0, errors: 0 };
    }

    console.log(`📦 Found ${expiredItems.length} expired items to purge`);

    // Process each expired item
    for (const trashItem of expiredItems) {
      try {
        console.log(`🗑️ Processing ${trashItem.itemType} (ID: ${trashItem.itemId})...`);

        // Delete based on item type
        switch (trashItem.itemType) {
          case 'Student':
            // First delete related fee structures
            await StudentFeeStructure.deleteMany({ studentId: trashItem.itemId });
            console.log(`   💰 Deleted fee structures for student ${trashItem.itemId}`);

            // Then delete the student record
            await Student.findByIdAndDelete(trashItem.itemId);
            console.log(`   👤 Deleted student record ${trashItem.itemId}`);
            break;

          case 'Staff':
            // Delete the staff record
            await Staff.findByIdAndDelete(trashItem.itemId);
            console.log(`   👨‍🏫 Deleted staff record ${trashItem.itemId}`);
            break;

          default:
            console.log(`⚠️ Unknown item type: ${trashItem.itemType}`);
        }

        // Delete the trash item record itself
        await TrashItem.findByIdAndDelete(trashItem._id);
        console.log(`   ✅ Removed from trash`);

        purged++;

      } catch (itemError) {
        console.error(`❌ Error processing item ${trashItem._id}:`, itemError.message);
        errors++;
        // Continue processing other items even if one fails
      }
    }

    console.log(`✅ Trash cleanup complete: ${purged} purged, ${errors} errors`);

  } catch (error) {
    console.error('❌ Fatal error in trash cleanup:', error);
    errors++;
  }

  return { purged, errors };
}

/**
 * Manually trigger trash cleanup
 * Useful for testing or manual cleanup
 *
 * @returns {Promise<{purged: number, errors: number}>} Statistics about the cleanup operation
 */
export async function manualTrashCleanup() {
  console.log('🔧 Manual trash cleanup triggered');
  return await purgeExpiredTrashItems();
}
