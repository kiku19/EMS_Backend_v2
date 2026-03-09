import dotenv from 'dotenv';
import mongoose, { connectDB } from '../database.js';
import { bootstrapTenantContext } from '../services/tenantBootstrapService.js';

dotenv.config();

try {
  await connectDB();
  const summary = await bootstrapTenantContext();
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  process.exit(0);
} catch (error) {
  console.error('Failed to bootstrap tenant context:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
