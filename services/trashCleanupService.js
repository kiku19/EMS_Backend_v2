/**
 * Trash Cleanup Service
 * Handles automatic purging of expired trash items
 * This service is called by the Agenda scheduler daily
 */

import { TrashItem } from '../models/TrashItem.js';
import { Staff } from '../database.js';
import { permanentlyDeleteStudentData } from './studentDataErasureService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TrashCleanup');

/**
 * Permanently delete expired items from trash
 * This job runs daily via Agenda scheduler
 *
 * @returns {Promise<{purged: number, errors: number}>} Statistics about the cleanup operation
 */
export async function purgeExpiredTrashItems() {
  logger.info('Starting trash cleanup');
  let purged = 0;
  let errors = 0;

  try {
    // Find all expired items (older than 30 days)
    const expiredItems = await TrashItem.findExpired();

    // If no expired items, return early
    if (!expiredItems || expiredItems.length === 0) {
      logger.info('No expired items found in trash');
      return { purged: 0, errors: 0 };
    }

    logger.info({ count: expiredItems.length }, 'Found expired items to purge');

    // Process each expired item
    for (const trashItem of expiredItems) {
      try {
        // Delete based on item type
        switch (trashItem.itemType) {
          case 'Student':
            await permanentlyDeleteStudentData(trashItem.itemId);
            break;

          case 'Staff':
            // Delete the staff record
            await Staff.findByIdAndDelete(trashItem.itemId);
            break;

          default:
        }

        // Delete the trash item record itself
        await TrashItem.findByIdAndDelete(trashItem._id);

        purged++;
      } catch (itemError) {
        logger.error(
          { err: itemError, trashItemId: trashItem._id, itemType: trashItem.itemType },
          'Error processing trash item'
        );
        errors++;
        // Continue processing other items even if one fails
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Fatal error in trash cleanup');
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
  return await purgeExpiredTrashItems();
}
