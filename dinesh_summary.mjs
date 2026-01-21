import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://eguser1:dummy123@cluster0.vy5smtv.mongodb.net/school_db?retryWrites=true&w=majority&appName=Cluster0';

// Staff Schema (minimal for summary)
const staffSchema = new mongoose.Schema({}, { strict: false });
const Staff = mongoose.model('Staff', staffSchema);

async function showDineshSummary() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const dinesh = await Staff.findOne({ name: 'DINESH KUMAR' });

    if (dinesh) {
      console.log('\n╔════════════════════════════════════════════════════════════════╗');
      console.log('║           DINESH KUMAR - TEST STAFF MEMBER CREATED            ║');
      console.log('╚════════════════════════════════════════════════════════════════╝\n');

      console.log('📋 BASIC INFORMATION');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`MongoDB _id:     ${dinesh._id.toString()}`);
      console.log(`Staff Code:      ${dinesh.code}`);
      console.log(`Staff Number:    ${dinesh.staffNumber}`);
      console.log(`Name:            ${dinesh.name}`);
      console.log(`Email:           ${dinesh.email}`);
      console.log(`Username:        ${dinesh.username}`);
      console.log(`Password:        Dinesh@123`);
      console.log(`Role:            ${dinesh.role}`);
      console.log(`Department:      ${dinesh.department}`);
      console.log(`Staff Type:      ${dinesh.staffType}`);
      console.log(`Status:          ${dinesh.status}\n`);

      console.log('👤 PERSONAL DETAILS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Date of Birth:   ${dinesh.dob}`);
      console.log(`Gender:          ${dinesh.gender}`);
      console.log(`Father's Name:   ${dinesh.fatherName}`);
      console.log(`Blood Group:     ${dinesh.bloodGroup}`);
      console.log(`Marital Status:  ${dinesh.maritalStatus}`);
      console.log(`Employment Type: ${dinesh.employmentType}\n`);

      console.log('📞 CONTACT INFORMATION');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Mobile:          ${dinesh.phone}`);
      console.log(`WhatsApp:        ${dinesh.whatsappNumber} (Same as mobile)`);
      console.log(`Address:         ${dinesh.address}\n`);

      console.log('🚨 EMERGENCY CONTACTS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      dinesh.emergencyContacts.forEach((contact, index) => {
        console.log(`${index + 1}. ${contact.name} (${contact.relationship})`);
        console.log(`   Phone: ${contact.phone}`);
      });
      console.log('');

      console.log('🎓 QUALIFICATIONS & EXPERIENCE');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Qualifications:');
      dinesh.professionalQualifications.forEach((qual, index) => {
        console.log(`${index + 1}. ${qual.name} (${qual.year})`);
      });
      console.log(`\nTotal Experience:     ${dinesh.totalExperience}`);
      console.log(`Previous Organization: ${dinesh.previousOrganization}`);
      console.log(`Role in Organization:  ${dinesh.roleInOrganization}\n`);

      console.log('🏫 TEACHING ASSIGNMENTS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Assigned Classes:  ${dinesh.assignedClasses.join(', ')}`);
      console.log(`Is Class Teacher:  ${dinesh.isClassTeacher ? 'Yes' : 'No'}`);
      console.log(`Class Teacher Of:  ${dinesh.classTeacherOf}\n`);

      console.log('💰 SALARY & BANK DETAILS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Total Salary:     ${dinesh.salary}`);
      console.log('Salary Breakdown:');
      dinesh.salaryBreakdown.forEach(item => {
        console.log(`  • ${item.component.padEnd(10)} ₹${item.amount.toLocaleString()}`);
      });
      console.log('\nBank Details:');
      console.log(`  Bank:           ${dinesh.bankName} - ${dinesh.branchName}`);
      console.log(`  Account Number: ${dinesh.accountNumber}`);
      console.log(`  IFSC Code:      ${dinesh.ifscCode}\n`);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔐 LOGIN CREDENTIALS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Login URL:  http://localhost:3001/api/staff/login');
      console.log('Username:   dinesh.kumar');
      console.log('Password:   Dinesh@123');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      console.log('✅ SUCCESS! DINESH KUMAR has been created successfully.');
      console.log('✅ You can now use these credentials to test all staff functionality.');
      console.log('✅ The staff member is ready for testing in your application.\n');

    } else {
      console.log('❌ DINESH KUMAR not found in database');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

showDineshSummary();
