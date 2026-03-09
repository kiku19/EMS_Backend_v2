import dotenv from 'dotenv';
import { installConsoleBridge } from './utils/logger.js';

dotenv.config();
installConsoleBridge();

await import('./server.js');
