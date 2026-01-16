import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { connectDB, Staff } from './database.js';

await connectDB();

console.log('\n🔍 Checking staff accounts...\n');

const staff = await Staff.find({}).select('name email phone username password').limit(5);

for (let s of staff) {
  console.log(`Name: ${s.name}`);
  console.log(`Email: ${s.email || 'N/A'}`);
  console.log(`Phone: ${s.phone || 'N/A'}`);
  console.log(`Username: ${s.username || 'N/A'}`);
  console.log(`Has Password: ${s.password ? 'Yes' : 'No'}`);
  
  if (s.password) {
    // Test if password is 'admin123' or 'password123'
    const test1 = await bcrypt.compare('admin123', s.password);
    const test2 = await bcrypt.compare('password123', s.password);
    const test3 = await bcrypt.compare('12345', s.password);
    
    if (test1) console.log('✅ Password is: admin123');
    else if (test2) console.log('✅ Password is: password123');
    else if (test3) console.log('✅ Password is: 12345');
    else console.log('⚠️ Password is something else');
  }
  console.log('---\n');
}

await mongoose.connection.close();
