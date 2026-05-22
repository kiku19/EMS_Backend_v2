import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { sendNotification } from '../routes/notifications.js';
import { createSchoolRecord, createStaffUser } from './helpers/factories.js';

describe('sendNotification schoolId guard', () => {
  it('throws a clear error when schoolId cannot be resolved', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await expect(sendNotification(fakeId, 'Staff', 'work', 'Title', 'Message')).rejects.toThrow(
      /sendNotification requires schoolId/
    );
  });

  it('succeeds when schoolId is passed explicitly', async () => {
    const school = await createSchoolRecord({ name: 'Explicit School' });
    const staff = await createStaffUser({ schoolId: school._id, name: 'Explicit Staff' });

    const notification = await sendNotification(
      staff._id,
      'Staff',
      'work',
      'Welcome',
      'Test message',
      { schoolId: school._id }
    );

    expect(notification).toBeTruthy();
    expect(notification.schoolId.toString()).toBe(school._id.toString());
    expect(notification.userId.toString()).toBe(staff._id.toString());
  });

  it('resolves schoolId from user document when not passed explicitly', async () => {
    const school = await createSchoolRecord({ name: 'Lookup School' });
    const staff = await createStaffUser({ schoolId: school._id, name: 'Lookup Staff' });

    const notification = await sendNotification(
      staff._id,
      'Staff',
      'work',
      'Welcome',
      'Test message'
    );

    expect(notification).toBeTruthy();
    expect(notification.schoolId.toString()).toBe(school._id.toString());
  });
});
