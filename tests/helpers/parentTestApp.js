import express from 'express';
import { Staff } from '../../database.js';
import { i18nMiddleware } from '../../middleware/i18n.js';
import parentDataRoutes from '../../routes/parentData.js';
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

export function createParentTestApp() {
  const app = express();
  const io = createTestIo();

  app.use(i18nMiddleware);
  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;

  initializeSocket(io);

  app.use('/api/parent', parentDataRoutes);

  return { app, io };
}
