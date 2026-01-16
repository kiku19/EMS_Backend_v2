import mongoose from 'mongoose';
import { connectDB, Staff } from './database.js';

await connectDB();
const staff = await Staff.find({}).select('name phone email username role status').limit(10);
console.log('\n📋 Available Staff Accounts:\n');
console.log('=' .repeat(80));
staff.forEach((s, i) => {
  console.log(${i+1}. );
  console.log(   Role: );
  console.log(   Phone: );
  console.log(   Email: );
  console.log(   Username: );
  console.log(   Status: );
  console.log('');
});
console.log('=' .repeat(80));
console.log('\n💡 TRY THESE CREDENTIALS:');
console.log('   Phone: Use any phone number above');
console.log('   Password: password123');
console.log('\n   OR');
console.log('   Phone: 9876543214');
console.log('   Password: password123');
await mongoose.connection.close();
