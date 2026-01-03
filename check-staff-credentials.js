// Check staff credentials in database
import { connectDB, Staff } from './database.js';

async function checkStaff() {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    const allStaff = await Staff.find({}).select('name email phone password status role');
    
    console.log('📋 All Staff in Database:\n');
    console.log('Total staff:', allStaff.length, '\n');
    
    allStaff.forEach((staff, index) => {
      console.log(`${index + 1}. ${staff.name}`);
      console.log(`   Email: ${staff.email || 'Not set'}`);
      console.log(`   Phone: ${staff.phone || 'Not set'}`);
      console.log(`   Password: ${staff.password || 'Not set'}`);
      console.log(`   Role: ${staff.role || 'Not set'}`);
      console.log(`   Status: ${staff.status || 'Not set'}`);
      console.log('');
    });

    // Check for admin role
    const admins = allStaff.filter(s => s.role?.toLowerCase().includes('admin') || s.role?.toLowerCase().includes('principal'));
    console.log('👑 Admin/Principal Staff:', admins.length);
    admins.forEach(admin => {
      console.log(`   - ${admin.name} (${admin.role})`);
      console.log(`     Email: ${admin.email}`);
      console.log(`     Password: ${admin.password}`);
      console.log(`     Status: ${admin.status}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkStaff();
