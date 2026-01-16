/**
 * SEED TEST USERS FOR E2E TESTING
 *
 * This script creates test users for Playwright E2E tests
 * Run: node seed-test-users.js
 *
 * Users created:
 * - admin@test.com / admin123 (Admin role)
 * - teacher@test.com / teacher123 (Teacher role)
 * - accountant@test.com / accountant123 (Accountant role)
 * - receptionist@test.com / receptionist123 (Receptionist role)
 */

import { connectDB, Staff, Class } from './database.js';

async function seedTestUsers() {
  console.log('🌱 Seeding test users for E2E testing...\n');

  try {
    await connectDB();

    // Check if test users already exist
    const existingAdmin = await Staff.findOne({ email: 'admin@test.com' });
    if (existingAdmin) {
      console.log('⚠️  Test users already exist. Skipping seed.\n');
      console.log('To force re-creation, delete existing test users first:\n');
      console.log('  db.staff.deleteMany({ email: { $in: ["admin@test.com", "teacher@test.com", "accountant@test.com", "receptionist@test.com"] } })\n');
      process.exit(0);
    }

    // Create test users using .save() to trigger password hashing in pre-save hook
    const testUsersData = [
      {
        code: 'TEST001',
        name: 'Test Admin',
        email: 'admin@test.com',
        phone: '9999999991',
        password: 'admin123',
        role: 'Admin',
        department: 'Administration',
        status: 'active',
        qualification: 'M.Ed',
        experience: '10',
        dateOfJoining: new Date('2020-01-01'),
        address: 'Test Address - Admin',
        emergencyContact: '9999999990'
      },
      {
        code: 'TEST002',
        name: 'Test Teacher',
        email: 'teacher@test.com',
        phone: '9999999992',
        password: 'teacher123',
        role: 'Teacher',
        department: 'Mathematics',
        status: 'active',
        qualification: 'M.Sc Mathematics',
        experience: '5',
        dateOfJoining: new Date('2022-01-01'),
        address: 'Test Address - Teacher',
        emergencyContact: '9999999990'
      },
      {
        code: 'TEST003',
        name: 'Test Accountant',
        email: 'accountant@test.com',
        phone: '9999999993',
        password: 'accountant123',
        role: 'Accountant',
        department: 'Accounts',
        status: 'active',
        qualification: 'M.Com',
        experience: '7',
        dateOfJoining: new Date('2021-01-01'),
        address: 'Test Address - Accountant',
        emergencyContact: '9999999990'
      },
      {
        code: 'TEST004',
        name: 'Test Receptionist',
        email: 'receptionist@test.com',
        phone: '9999999994',
        password: 'receptionist123',
        role: 'Receptionist',
        department: 'Front Desk',
        status: 'active',
        qualification: 'B.A',
        experience: '3',
        dateOfJoining: new Date('2023-01-01'),
        address: 'Test Address - Receptionist',
        emergencyContact: '9999999990'
      }
    ];

    // Use .save() instead of insertMany to trigger password hashing
    const createdUsers = [];
    for (const userData of testUsersData) {
      const user = new Staff(userData);
      await user.save(); // This triggers the pre-save hook to hash password
      createdUsers.push(user);
    }
    console.log(`✅ Created ${createdUsers.length} test users\n`);

    // Create test classes for teacher
    const testTeacher = createdUsers.find(u => u.email === 'teacher@test.com');
    if (testTeacher) {
      const testClasses = await Class.insertMany([
        {
          name: 'Test Class 10',
          section: 'A',
          classTeacherId: testTeacher._id,
          subjects: ['Mathematics', 'Physics', 'Chemistry'],
          roomNumber: '101',
          capacity: '40'
        },
        {
          name: 'Test Class 11',
          section: 'B',
          classTeacherId: testTeacher._id,
          subjects: ['Mathematics', 'Computer Science'],
          roomNumber: '102',
          capacity: '35'
        }
      ]);
      console.log(`✅ Created ${testClasses.length} test classes for test teacher\n`);
    }

    // Print credentials
    console.log('═══════════════════════════════════════════════════════════');
    console.log('          TEST USER CREDENTIALS FOR E2E TESTS');
    console.log('═══════════════════════════════════════════════════════════\n');

    createdUsers.forEach(user => {
      console.log(`┌─ ${user.role.toUpperCase()} ──────────────────────────────`);
      console.log(`│  Name:     ${user.name}`);
      console.log(`│  Email:    ${user.email}`);
      console.log(`│  Phone:    ${user.phone}`);
      console.log(`│  Password: [ROLE_LOWER]123`);
      console.log(`│  Status:   ${user.status}`);
      console.log(`└───────────────────────────────────────────────────────`);
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Test users created successfully!');
    console.log('🧪 You can now run E2E tests: cd school-dashboard && npm test');
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
}

seedTestUsers();
