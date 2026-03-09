import express from 'express';
import { Staff } from '../../database.js';
import authRoutes from '../../routes/auth.js';
import attendanceRoutes from '../../routes/attendance.js';
import feesRoutes from '../../routes/fees.js';
import studentsRoutes from '../../routes/students.js';
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
  app.use('/api/students', studentsRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/fees', feesRoutes);

  return { app, io };
}
