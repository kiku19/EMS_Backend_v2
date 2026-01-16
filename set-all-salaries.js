import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, Staff } from './database.js';

// Load env from backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ Error loading .env file:', result.error);
} else {
  console.log('✅ .env file loaded from:', envPath);
  console.log('🔑 MONGO_URI present:', !!process.env.MONGO_URI);
  console.log('🔑 MONGODB_URI present:', !!process.env.MONGODB_URI);
}

const DEFAULT_SALARY = 50000;
const DEFAULT_EMPLOYMENT_TYPE = 'full_time';

async function setAllSalaries() {
  await connectDB();

  try {
    console.log('🔄 Fetching all staff...');
    const allStaff = await Staff.find({});
    console.log(`📋 Found ${allStaff.length} staff members.`);

    let updatedCount = 0;
    let alreadySetCount = 0;

    for (const staff of allStaff) {
      let needsUpdate = false;
      const updates = {};

      // Set default salary if missing or 0
      if (!staff.salary || staff.salary === 0) {
        updates.salary = DEFAULT_SALARY;
        needsUpdate = true;
      }

      // Set default employment type if missing
      if (!staff.employmentType) {
        updates.employmentType = DEFAULT_EMPLOYMENT_TYPE;
        needsUpdate = true;
      }
      
      // Also ensure salary breakdown exists if missing (basic example)
      if (!staff.salaryBreakdown || staff.salaryBreakdown.length === 0) {
          updates.salaryBreakdown = [
              { component: 'Base Salary', amount: updates.salary || staff.salary || DEFAULT_SALARY }
          ];
          needsUpdate = true;
      }

      if (needsUpdate) {
        await Staff.findByIdAndUpdate(staff._id, updates);
        console.log(`✅ Updated ${staff.name} (${staff.code}): Salary set to ${updates.salary || staff.salary}, Type: ${updates.employmentType || staff.employmentType}`);
        updatedCount++;
      } else {
        alreadySetCount++;
      }
    }

    console.log('\n🎉 Summary:');
    console.log(`- Total Staff: ${allStaff.length}`);
    console.log(`- Updated: ${updatedCount}`);
    console.log(`- Already Configured: ${alreadySetCount}`);

  } catch (error) {
    console.error('❌ Error updating salaries:', error);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Database connection closed.');
  }
}

setAllSalaries();
