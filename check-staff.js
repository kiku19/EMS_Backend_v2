import { connectDB, Staff } from './database.js';

async function checkStaff() {
  try {
    await connectDB();
    const staff = await Staff.find({});
    console.log('\n📊 Current Staff in Database:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total: ${staff.length} staff members\n`);
    
    staff.forEach((s, index) => {
      console.log(`${index + 1}. ${s.name}`);
      console.log(`   Email: ${s.email}`);
      console.log(`   Role: ${s.role}`);
      console.log(`   Code: ${s.code}`);
      console.log(`   Status: ${s.status}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkStaff();
