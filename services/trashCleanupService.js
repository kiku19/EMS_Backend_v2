/**
 * Trash Cleanup Service
 * Handles automatic purging of expired trash items.
 * This service is called by the Agenda scheduler daily.
 *
 * Uses the generic restoreStrategy / modelName stored on each TrashItem
 * so new entity types are handled automatically without code changes here.
 */

import mongoose from 'mongoose';
import TrashItem from '../models/TrashItem.js';
import { permanentlyDeleteStudentData } from './studentDataErasureService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TrashCleanup');

/**
 * Permanently delete expired items from trash.
 * Runs daily via Agenda scheduler.
 */
export async function purgeExpiredTrashItems() {
  logger.info('Starting trash cleanup');
  let purged = 0;
  let errors = 0;

  try {
    const expiredItems = await TrashItem.findExpired();

    if (!expiredItems || expiredItems.length === 0) {
      logger.info('No expired items found in trash');
      return { purged: 0, errors: 0 };
    }

    logger.info({ count: expiredItems.length }, 'Found expired items to purge');

    for (const trashItem of expiredItems) {
      try {
        const { itemType, restoreStrategy, modelName, itemId } = trashItem;

        // Student has special GDPR-compliant cascading erasure
        if (itemType === 'Student') {
          await permanentlyDeleteStudentData(itemId);
        } else if (itemType === 'BulkCleanup') {
          // Data already deleted from source — just discard the trash record
        } else if (restoreStrategy === 'soft-delete' && modelName) {
          // Soft-deleted items still exist in DB — hard-delete them now
          const Model = mongoose.model(modelName);
          await Model.findByIdAndDelete(itemId);
        }
        // hard-delete items: data already gone from source, nothing to do

        // Remove the trash record itself
        await TrashItem.findByIdAndDelete(trashItem._id);
        purged++;
      } catch (itemError) {
        logger.error(
          { err: itemError, trashItemId: trashItem._id, itemType: trashItem.itemType },
          'Error processing trash item'
        );
        errors++;
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Fatal error in trash cleanup');
    errors++;
  }

  logger.info({ purged, errors }, 'Trash cleanup complete');
  return { purged, errors };
}

/**
 * Manually trigger trash cleanup.
 * Useful for testing or manual cleanup.
 */
export async function manualTrashCleanup() {
  return await purgeExpiredTrashItems();
}
