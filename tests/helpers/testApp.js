import express from 'express';
import { Staff } from '../../database.js';
import authRoutes from '../../routes/auth.js';
import attendanceRoutes from '../../routes/attendance.js';
import billingRoutes from '../../routes/billing.js';
import feesRoutes from '../../routes/fees.js';
import staffRoutes from '../../routes/staff.js';
import studentsRoutes from '../../routes/students.js';
import superAdminRoutes from '../../routes/superAdmin.js';
import { initializeSocket } from '../../utils/socketEmitter.js';

function createTestIo() {
  return {
    emit() {},
    to() {
      return {
        emit() {},
      };
    },
  };
}

export function createTestApp() {
  const app = express();
  const io = createTestIo();

  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;

  initializeSocket(io);

  app.use('/api/auth', authRoutes);
  app.use('/api/super-admin', superAdminRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/students', studentsRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/fees', feesRoutes);

  return { app, io };
}
