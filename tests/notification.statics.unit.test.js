import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Notification from '../models/Notification.js';

describe('Notification statics tenant scoping', () => {
  const userId = new mongoose.Types.ObjectId();
  const schoolA = new mongoose.Types.ObjectId();
  const schoolB = new mongoose.Types.ObjectId();

  beforeEach(async () => {
    await Notification.insertMany([
      {
        schoolId: schoolA,
        userId,
        userModel: 'Staff',
        type: 'event',
        title: 'A-1',
        message: 'school A notification 1',
        read: false,
      },
      {
        schoolId: schoolA,
        userId,
        userModel: 'Staff',
        type: 'event',
        title: 'A-2',
        message: 'school A notification 2',
        read: false,
      },
      {
        schoolId: schoolB,
        userId,
        userModel: 'Staff',
        type: 'event',
        title: 'B-1',
        message: 'school B notification 1',
        read: false,
      },
    ]);
  });

  it('getUnreadCount counts only the passed tenant', async () => {
    expect(await Notification.getUnreadCount(userId, 'Staff', schoolA)).toBe(2);
    expect(await Notification.getUnreadCount(userId, 'Staff', schoolB)).toBe(1);
  });

  it('markAllAsReadForUser wipes unread only in the passed tenant', async () => {
    await Notification.markAllAsReadForUser(userId, 'Staff', schoolA);

    // School A: all read
    const aUnread = await Notification.countDocuments({
      userId,
      schoolId: schoolA,
      read: false,
    });
    expect(aUnread).toBe(0);

    // School B: untouched — before the fix this would also be 0 because the
    // updateMany was scoped only by {userId, userModel}.
    const bUnread = await Notification.countDocuments({
      userId,
      schoolId: schoolB,
      read: false,
    });
    expect(bUnread).toBe(1);
  });

  it('rejects calls without schoolId so callers cannot silently regress', async () => {
    await expect(Notification.getUnreadCount(userId, 'Staff')).rejects.toThrow(/schoolId/);
    await expect(Notification.markAllAsReadForUser(userId, 'Staff')).rejects.toThrow(/schoolId/);
  });
});
