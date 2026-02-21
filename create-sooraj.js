import { connectDB, Staff } from './database.js';

async function createSoorajUser() {
  try {
    await connectDB();

    // Check if Sooraj already exists
    const existingUser = await Staff.findOne({
      $or: [
        { email: 'sooraj@school.com' },
        { username: 'sooraj' }
      ]
    });

    if (existingUser) {
      console.log('❌ Sooraj user already exists!');
      console.log('Email:', existingUser.email);
      console.log('Username:', existingUser.username);
      console.log('Name:', existingUser.name);
      console.log('Role:', existingUser.role);
      process.exit(0);
    }

    // Get next available code
    const lastStaff = await Staff.findOne().sort({ code: -1 });
    const lastCodeNum = lastStaff ? parseInt(lastStaff.code.replace('EMP', '')) : 0;
    const newCode = `EMP${String(lastCodeNum + 1).padStart(3, '0')}`;

    // Create Sooraj user
    const sooraj = new Staff({
      code: newCode,
      name: 'Sooraj',
      email: 'sooraj@school.com',
      username: 'sooraj',
      password: 'password123', // Will be hashed by pre-save hook
      phone: '9876543215',
      role: 'Teacher',
      department: 'Computer Science',
      status: 'active'
    });

    await sooraj.save();

    console.log('✅ Sooraj user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Email:    sooraj@school.com');
    console.log('Username: sooraj');
    console.log('Password: password123');
    console.log('Role:     Teacher');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nYou can now login with these credentials!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating Sooraj user:', error.message);
    process.exit(1);
  }
}

createSoorajUser();
