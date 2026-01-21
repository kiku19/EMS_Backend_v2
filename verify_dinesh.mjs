import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://eguser1:dummy123@cluster0.vy5smtv.mongodb.net/school_db?retryWrites=true&w=majority&appName=Cluster0';

// Staff Schema (minimal for verification)
const staffSchema = new mongoose.Schema({}, { strict: false });
const Staff = mongoose.model('Staff', staffSchema);

async function verifyDinesh() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find DINESH
    console.log('Searching for DINESH KUMAR in database...');
    const dinesh = await Staff.findOne({ name: 'DINESH KUMAR' });

    if (dinesh) {
      console.log('✅ DINESH KUMAR found in database!\n');
      console.log('========================================');
      console.log('VERIFICATION RESULTS');
      console.log('========================================');
      console.log('MongoDB _id:', dinesh._id.toString());
      console.log('Code:', dinesh.code);
      console.log('Name:', dinesh.name);
      console.log('Email:', dinesh.email);
      console.log('Username:', dinesh.username);
      console.log('Password (hashed):', dinesh.password.substring(0, 20) + '...');
      console.log('Role:', dinesh.role);
      console.log('Department:', dinesh.department);
      console.log('Status:', dinesh.status);
      console.log('DOB:', dinesh.dob);
      console.log('Gender:', dinesh.gender);
      console.log("Father's Name:", dinesh.fatherName);
      console.log('Blood Group:', dinesh.bloodGroup);
      console.log('Marital Status:', dinesh.maritalStatus);
      console.log('Employment Type:', dinesh.employmentType);
      console.log('Mobile:', dinesh.phone);
      console.log('WhatsApp:', dinesh.whatsappNumber);
      console.log('Address:', dinesh.address);
      console.log('\nEmergency Contacts:');
      dinesh.emergencyContacts.forEach((contact, index) => {
        console.log(`  ${index + 1}. ${contact.name} (${contact.relationship}): ${contact.phone}`);
      });
      console.log('\nQualifications:');
      dinesh.professionalQualifications.forEach((qual, index) => {
        console.log(`  ${index + 1}. ${qual.name} (${qual.year})`);
      });
      console.log('\nExperience:', dinesh.totalExperience);
      console.log('Previous Organization:', dinesh.previousOrganization);
      console.log('Role in Organization:', dinesh.roleInOrganization);
      console.log('Staff Number:', dinesh.staffNumber);
      console.log('Staff Type:', dinesh.staffType);
      console.log('Assigned Classes:', dinesh.assignedClasses.join(', '));
      console.log('Is Class Teacher:', dinesh.isClassTeacher);
      console.log('Class Teacher Of:', dinesh.classTeacherOf);
      console.log('\nBank Details:');
      console.log('  Bank:', dinesh.bankName, '-', dinesh.branchName);
      console.log('  Account Number:', dinesh.accountNumber);
      console.log('  IFSC Code:', dinesh.ifscCode);
      console.log('\nSalary Details:');
      console.log('  Total Salary:', dinesh.salary);
      console.log('  Breakdown:');
      dinesh.salaryBreakdown.forEach(item => {
        console.log(`    - ${item.component}: ${item.amount}`);
      });
      console.log('\nCreated At:', dinesh.createdAt);
      console.log('Updated At:', dinesh.updatedAt);
      console.log('========================================\n');

      // Test credentials summary
      console.log('LOGIN CREDENTIALS FOR TESTING');
      console.log('========================================');
      console.log('Username:', dinesh.username);
      console.log('Password: Dinesh@123');
      console.log('========================================\n');

      console.log('✅ DINESH is ready for testing all staff functionality!');

    } else {
      console.log('❌ DINESH KUMAR not found in database');
    }

  } catch (error) {
    console.error('❌ Error verifying DINESH:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

verifyDinesh();
