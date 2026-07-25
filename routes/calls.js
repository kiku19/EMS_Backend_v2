import express from 'express';
import CallHistory from '../models/CallHistory.js';
import Parent from '../models/Parent.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/auth/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { Staff } from '../database.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) {
    throw new Error('schoolId is required for scoped queries');
  }
  return { ...query, schoolId: normalizedSchoolId };
}

// POST /api/calls/initiate - Initiate call
router.post('/initiate', checkPermission('front-desk', 'create'), async (req, res) => {
  try {
    const { to, callType } = req.body; // to: { userId, userModel }
    const user = req.user;

    if (!to || !callType) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.recipientAndCallTypeAreRequired') });
    }

    // Cross-tenant guard: verify the recipient belongs to the caller's school
    // before creating the call or emitting a socket event. Without this any
    // authenticated caller could ring an arbitrary user id in another tenant.
    const callerSchoolId = extractSchoolId(user?.schoolId);
    const allowedRecipientModels = new Set(['Staff', 'Parent']);
    if (!to.userModel || !allowedRecipientModels.has(to.userModel)) {
      return res.status(400).json({ error: 'Invalid recipient model' });
    }

    const recipientQuery = { _id: to.userId, schoolId: callerSchoolId };
    const recipient =
      to.userModel === 'Staff'
        ? await Staff.findOne(recipientQuery).lean()
        : await Parent.findOne(recipientQuery).lean();

    if (!recipient) {
      return res.status(403).json({
        error: req.t('common:errors.forbidden'),
        code: 'RECIPIENT_NOT_IN_SCHOOL',
      });
    }

    // Create call record
    const call = new CallHistory({
      schoolId: extractSchoolId(req.user?.schoolId),
      participants: [
        {
          userId: user.id,
          userModel: user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student',
          joinedAt: new Date(),
        },
        {
          userId: to.userId,
          userModel: to.userModel,
        },
      ],
      callType,
      initiatedBy: user.id,
      initiatorModel: user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student',
      status: 'initiated',
      startTime: new Date(),
    });

    await call.save();

    // Emit Socket.IO event to recipient
    const io = req.app.get('io');
    io.to(`user:${to.userId}`).emit('incoming_call', {
      callId: call._id,
      callerId: user.id,
      callerModel: user.role,
      callerName: user.name,
      callType,
      timestamp: new Date(),
    });

    res.json(call);
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({ error: req.t('common:routes.failedToInitiateCall') });
  }
});

// POST /api/calls/:id/accept - Accept call
router.post('/:id/accept', async (req, res) => {
  try {
    const call = await CallHistory.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!call) {
      return res.status(404).json({ error: req.t('common:routes.callNotFound') });
    }

    const user = req.user;

    // Add participant to call
    const participant = call.participants.find((p) => p.userId.toString() === user.id.toString());
    if (participant) {
      participant.joinedAt = new Date();
    }

    call.status = 'connected';
    call.startTime = new Date();
    await call.save();

    // Notify caller
    const io = req.app.get('io');
    io.to(`user:${call.initiatedBy}`).emit('call_accepted', {
      callId: call._id,
      acceptedBy: user.id,
    });

    res.json(call);
  } catch (error) {
    console.error('Error accepting call:', error);
    res.status(500).json({ error: req.t('common:routes.failedToAcceptCall') });
  }
});

// POST /api/calls/:id/reject - Reject call
router.post('/:id/reject', async (req, res) => {
  try {
    const call = await CallHistory.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!call) {
      return res.status(404).json({ error: req.t('common:routes.callNotFound') });
    }

    const user = req.user;

    call.status = 'rejected';
    call.rejectedBy = user.id;
    call.endTime = new Date();
    await call.calculateDuration();
    await call.save();

    // Notify caller
    const io = req.app.get('io');
    io.to(`user:${call.initiatedBy}`).emit('call_rejected', {
      callId: call._id,
      rejectedBy: user.id,
    });

    res.json(call);
  } catch (error) {
    console.error('Error rejecting call:', error);
    res.status(500).json({ error: req.t('common:routes.failedToRejectCall') });
  }
});

// POST /api/calls/:id/end - End call
router.post('/:id/end', async (req, res) => {
  try {
    const call = await CallHistory.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!call) {
      return res.status(404).json({ error: req.t('common:routes.callNotFound') });
    }

    const user = req.user;
    const { reason } = req.body;

    // Update participant leave time
    const participant = call.participants.find((p) => p.userId.toString() === user.id.toString());
    if (participant) {
      participant.leftAt = new Date();
    }

    call.status = 'ended';
    call.endTime = new Date();
    call.endReason = reason || 'user_ended';
    await call.calculateDuration();
    await call.save();

    // Notify other participants
    const io = req.app.get('io');
    call.participants.forEach((p) => {
      if (p.userId.toString() !== user.id.toString()) {
        io.to(`user:${p.userId}`).emit('call_ended', {
          callId: call._id,
          endedBy: user.id,
          duration: call.duration,
        });
      }
    });

    res.json(call);
  } catch (error) {
    console.error('Error ending call:', error);
    res.status(500).json({ error: req.t('common:routes.failedToEndCall') });
  }
});

// GET /api/calls/history - Get call history
router.get('/history/me', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const user = req.user;
    const { limit = 50 } = req.query;

    const calls = await CallHistory.find(
      scopeBySchool(req.user?.schoolId, { 'participants.userId': user.id })
    )
      .sort({ startTime: -1 })
      .limit(parseInt(limit))
      .populate('participants.userId', 'name profileImage')
      .populate('initiatedBy', 'name profileImage');

    res.json(calls);
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchCallHistory') });
  }
});

// GET /api/calls/missed - Get missed calls
router.get('/missed/me', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const user = req.user;

    const missedCalls = await CallHistory.find(
      scopeBySchool(req.user?.schoolId, {
        'participants.userId': user.id,
        status: 'missed',
      })
    )
      .sort({ startTime: -1 })
      .populate('initiatedBy', 'name profileImage');

    res.json(missedCalls);
  } catch (error) {
    console.error('Error fetching missed calls:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchMissedCalls') });
  }
});

export default router;
