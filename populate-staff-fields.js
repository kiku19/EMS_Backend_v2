/**
 * Script to populate all staff records with complete dummy data
 * This ensures all staff have all fields filled for proper functionality
 */

import { connectDB, Staff } from './database.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

// Dummy data pools
const dummyData = {
  bloodGroups: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  genders: ["Male", "Female"],
  maritalStatuses: ["Single", "Married"],
  employmentTypes: ["Full-time", "Full-time", "Full-time", "Part-time"],
  departments: ["Science", "Mathematics", "Languages", "Admin", "Sports"],
  addresses: [
    "123 Main Street, City Center",
    "456 Park Avenue, Green Valley",
    "789 Lake View, Hill Station",
    "321 Oak Road, Suburban Area",
    "654 Pine Lane, Metro City"
  ],
  qualifications: [
    { name: "B.Ed", year: "2018" },
    { name: "M.Sc", year: "2016" },
    { name: "M.A", year: "2017" },
    { name: "B.Com", year: "2019" },
    { name: "MBA", year: "2015" },
    { name: "PhD", year: "2014" }
  ],
  bankNames: ["State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Punjab National Bank"],
  branches: ["New Delhi", "Mumbai", "Bangalore", "Chennai", "Kolkata"],
  ifscCodes: ["SBIN0001234", "HDFC0005678", "ICIC0009012", "UTIB0003456", "PUNB0007890"],
  expertise: ["Physics", "Mathematics", "English", "Computer Science", "Chemistry", "Biology", "Sports"],
  documents: [
    "https://via.placeholder.com/150?text=Aadhar+Front",
    "https://via.placeholder.com/150?text=Aadhar+Back",
    "https://via.placeholder.com/150?text=PAN+Card",
    "https://via.placeholder.com/150?text=Degree+Certificate",
    "https://via.placeholder.com/150?text=Experience+Letter"
  ]
};

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomYear(start = 1980, end = 2000) {
  return Math.floor(Math.random() * (end - start + 1)) + start;
}

function generateRandomDOB(age = 30) {
  const year = new Date().getFullYear() - age;
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateRandomPhone() {
  return `98${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
}

function generateAccountNumber() {
  return Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
}

async function populateStaffFields() {
  try {
    console.log('🔄 Connecting to database...');
    await connectDB();
    console.log('✅ Database connected');

    // Fetch all staff
    console.log('📋 Fetching all staff members...');
    const allStaff = await Staff.find();
    console.log(`✅ Found ${allStaff.length} staff members`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const staff of allStaff) {
      const updateData = {};
      let needsUpdate = false;

      // Check if password exists, if not generate a default one
      if (!staff.password) {
        updateData.password = await bcrypt.hash('Staff@123', 10);
        needsUpdate = true;
        console.log(`🔐 Setting default password for ${staff.name}`);
      }

      // Personal Details
      if (!staff.dob) {
        updateData.dob = generateRandomDOB(25 + Math.floor(Math.random() * 20));
        needsUpdate = true;
      }
      if (!staff.gender) {
        updateData.gender = getRandomItem(dummyData.genders);
        needsUpdate = true;
      }
      if (!staff.fatherName) {
        updateData.fatherName = `Father of ${staff.name}`;
        needsUpdate = true;
      }
      if (!staff.bloodGroup) {
        updateData.bloodGroup = getRandomItem(dummyData.bloodGroups);
        needsUpdate = true;
      }
      if (!staff.maritalStatus) {
        updateData.maritalStatus = getRandomItem(dummyData.maritalStatuses);
        needsUpdate = true;
      }
      if (!staff.employmentType) {
        updateData.employmentType = getRandomItem(dummyData.employmentTypes);
        needsUpdate = true;
      }
      if (!staff.address) {
        updateData.address = getRandomItem(dummyData.addresses);
        needsUpdate = true;
      }
      if (!staff.joinDate) {
        const joinYear = getRandomYear(2015, 2023);
        updateData.joinDate = `${joinYear}-04-01`;
        needsUpdate = true;
      }

      // Contact Details
      if (!staff.phone) {
        updateData.phone = generateRandomPhone();
        needsUpdate = true;
      }
      if (!staff.email) {
        updateData.email = `${staff.name.toLowerCase().replace(/\s+/g, '.')}@school.edu`;
        needsUpdate = true;
      }
      if (!staff.whatsappNumber) {
        updateData.whatsappNumber = staff.phone || generateRandomPhone();
        needsUpdate = true;
      }

      // Emergency Contacts
      if (!staff.emergencyContacts || staff.emergencyContacts.length === 0) {
        updateData.emergencyContacts = [{
          name: `Emergency Contact for ${staff.name}`,
          relationship: getRandomItem(["Spouse", "Parent", "Sibling", "Friend"]),
          phone: generateRandomPhone()
        }];
        needsUpdate = true;
      }
      if (!staff.emergencyContact) {
        updateData.emergencyContact = `Emergency Contact`;
        needsUpdate = true;
      }
      if (!staff.emergencyPhone) {
        updateData.emergencyPhone = generateRandomPhone();
        needsUpdate = true;
      }

      // Documents
      if (!staff.picture) {
        updateData.picture = `https://i.pravatar.cc/150?u=${staff._id}`;
        needsUpdate = true;
      }
      if (!staff.idDocuments || staff.idDocuments.length === 0) {
        updateData.idDocuments = [
          dummyData.documents[0], // Aadhar Front
          dummyData.documents[1],  // Aadhar Back
          dummyData.documents[2]   // PAN Card
        ];
        needsUpdate = true;
      }

      // Qualifications
      if (!staff.professionalQualifications || staff.professionalQualifications.length === 0) {
        const qual1 = getRandomItem(dummyData.qualifications);
        const qual2 = getRandomItem(dummyData.qualifications);
        updateData.professionalQualifications = [
          {
            name: qual1.name,
            year: qual1.year,
            documents: [dummyData.documents[3]]
          },
          {
            name: qual2.name,
            year: qual2.year,
            documents: [dummyData.documents[4]]
          }
        ];
        needsUpdate = true;
      }
      if (!staff.totalExperience) {
        updateData.totalExperience = `${Math.floor(Math.random() * 15) + 1} years`;
        needsUpdate = true;
      }
      if (!staff.previousOrganization) {
        updateData.previousOrganization = "Previous Educational Institution";
        needsUpdate = true;
      }
      if (!staff.qualificationDocs || staff.qualificationDocs.length === 0) {
        updateData.qualificationDocs = [dummyData.documents[3], dummyData.documents[4]];
        needsUpdate = true;
      }

      // Staff Info
      if (!staff.staffNumber) {
        const year = new Date().getFullYear();
        const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        updateData.staffNumber = `STF-${year}-${randomNum}`;
        needsUpdate = true;
      }
      if (!staff.staffType) {
        updateData.staffType = staff.role === "Teacher" ? "Teaching" : "Non-Teaching";
        needsUpdate = true;
      }
      if (!staff.expertise) {
        updateData.expertise = getRandomItem(dummyData.expertise);
        needsUpdate = true;
      }
      if (!staff.assignedClasses) {
        updateData.assignedClasses = [];
        needsUpdate = true;
      }
      if (staff.isClassTeacher === undefined || staff.isClassTeacher === null) {
        updateData.isClassTeacher = false;
        needsUpdate = true;
      }

      // Bank & Salary
      if (!staff.accountNumber) {
        updateData.accountNumber = generateAccountNumber();
        needsUpdate = true;
      }
      if (!staff.ifscCode) {
        updateData.ifscCode = getRandomItem(dummyData.ifscCodes);
        needsUpdate = true;
      }
      if (!staff.bankName) {
        updateData.bankName = getRandomItem(dummyData.bankNames);
        needsUpdate = true;
      }
      if (!staff.branchName) {
        updateData.branchName = getRandomItem(dummyData.branches);
        needsUpdate = true;
      }
      if (!staff.salaryTemplate) {
        updateData.salaryTemplate = "Standard Template";
        needsUpdate = true;
      }
      if (!staff.salaryBreakdown || staff.salaryBreakdown.length === 0) {
        const baseSalary = 25000 + Math.floor(Math.random() * 50000);
        updateData.salaryBreakdown = [
          { component: "Basic", amount: Math.round(baseSalary * 0.5) },
          { component: "DA", amount: Math.round(baseSalary * 0.2) },
          { component: "HRA", amount: Math.round(baseSalary * 0.15) },
          { component: "TA", amount: Math.round(baseSalary * 0.1) },
          { component: "Other", amount: Math.round(baseSalary * 0.05) }
        ];
        updateData.salary = baseSalary;
        needsUpdate = true;
      }

      // Custom documents array
      if (!staff.customDocuments) {
        updateData.customDocuments = [];
        needsUpdate = true;
      }

      // Update the staff record if needed
      if (needsUpdate) {
        await Staff.findByIdAndUpdate(staff._id, { $set: updateData });
        updatedCount++;
        console.log(`✅ Updated staff: ${staff.name} (${staff.code})`);
      } else {
        skippedCount++;
        console.log(`⏭️  Skipped staff: ${staff.name} (${staff.code}) - already complete`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully updated: ${updatedCount} staff members`);
    console.log(`⏭️  Already complete: ${skippedCount} staff members`);
    console.log(`📋 Total processed: ${allStaff.length} staff members`);
    console.log('='.repeat(60));
    console.log('\n✅ All staff records have been populated with complete data!');
    console.log('🔐 Default password for all staff: Staff@123');
    console.log('🔐 Please change passwords after first login.\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error populating staff fields:', error);
    process.exit(1);
  }
}

// Run the script
populateStaffFields();
