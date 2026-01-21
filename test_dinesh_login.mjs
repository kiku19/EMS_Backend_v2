import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://eguser1:dummy123@cluster0.vy5smtv.mongodb.net/school_db?retryWrites=true&w=majority&appName=Cluster0';

// Staff Schema (minimal for login test)
const staffSchema = new mongoose.Schema({}, { strict: false });
const Staff = mongoose.model('Staff', staffSchema);

async function testDineshLogin() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find DINESH by username
    console.log('Testing login credentials...');
    const dinesh = await Staff.findOne({ username: 'dinesh.kumar' });

    if (dinesh) {
      console.log('✅ Found user: ' + dinesh.name);

      // Test password comparison
      const testPassword = 'Dinesh@123';
      const isMatch = await bcrypt.compare(testPassword, dinesh.password);

      if (isMatch) {
        console.log('✅ Password verification successful!');
        console.log('\n========================================');
        console.log('LOGIN TEST RESULTS');
        console.log('========================================');
        console.log('Username: dinesh.kumar');
        console.log('Password: Dinesh@123');
        console.log('Status: ✅ VALID CREDENTIALS');
        console.log('========================================\n');
        console.log('DINESH can now login to the application and test all staff functionality including:');
        console.log('  - View/Edit profile');
        console.log('  - Manage attendance');
        console.log('  - View assigned classes (10-A, 10-B)');
        console.log('  - Class teacher functionality for class 10-A');
        console.log('  - View salary details');
        console.log('  - Update qualifications and documents');
        console.log('  - And all other staff features');
      } else {
        console.log('❌ Password verification failed');
      }
    } else {
      console.log('❌ User not found with username: dinesh.kumar');
    }

  } catch (error) {
    console.error('❌ Error testing login:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

testDineshLogin();
