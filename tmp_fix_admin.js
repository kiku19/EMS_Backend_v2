import mongoose from 'mongoose';
import { connectDB, Staff } from './database.js';

await connectDB();

// Update the admin to have email
const admin = await Staff.findOne({ phone: '9999999999' });
if (admin) {
  console.log('\n✅ Found admin, updating email...');
  admin.email = 'admin@school.com';
  await admin.save();
  console.log('✅ Email updated!');
} else {
  console.log('❌ Admin not found');
}

console.log('\n🔑 USE THESE CREDENTIALS:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('   Email: admin@school.com');
console.log('   Password: admin123');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n📱 Login at: http://localhost:5173');

await mongoose.connection.close();
