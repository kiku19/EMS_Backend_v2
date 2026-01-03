// This file shows how to integrate Socket.IO into your existing server.js
// Add these imports at the top of your server.js:

import { createServer } from 'http';
import { Server } from 'socket.io';
import { initializeChatHandlers } from './socket/chatHandler.js';
import messageRoutes from './routes/messages.js';

// After creating your Express app, wrap it with HTTP server:
// const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'https://school-dashboard-ivory.vercel.app'
    ],
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Initialize chat handlers
initializeChatHandlers(io);

// Add message routes
app.use('/api/messages', messageRoutes);

// Make io accessible to routes if needed
app.set('io', io);

// Change app.listen to httpServer.listen:
// app.listen(PORT, ...) becomes:
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server ready`);
});

// Export io for use in other files if needed
export { io };
