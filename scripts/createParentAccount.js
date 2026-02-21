import mongoose from 'mongoose';
import readline from 'readline/promises';
import process from 'process';
import dotenv from 'dotenv';
import Parent from '../models/Parent.js';
import { Student } from '../database.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
}

function displayStudents(students) {
  console.log('\n📋 Available Students:');
  console.log('─'.repeat(80));
  students.forEach((student, index) => {
    console.log(`${index + 1}. ${student.name} (Class: ${student.classId?.name || 'N/A'}, Roll: ${student.rollNo || 'N/A'})`);
  });
  console.log('─'.repeat(80));
}

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

async function getMultipleStudents(rl, students) {
  const selectedIndices = [];

  while (true) {
    const input = await rl.question('\nEnter student number (or "done" to finish): ');

    if (input.toLowerCase() === 'done') {
      break;
    }

    const index = parseInt(input) - 1;
    if (isNaN(index) || index < 0 || index >= students.length) {
      console.log('❌ Invalid selection. Please try again.');
      continue;
    }

    if (selectedIndices.includes(index)) {
      console.log('⚠️ Student already selected.');
      continue;
    }

    selectedIndices.push(index);
    console.log(`✅ Added: ${students[index].name}`);
  }

  return selectedIndices.map(i => students[i]._id);
}

async function main() {
  const rl = createInterface();

  try {
    // Connect to database
    await connectDB();

    // Get parent details
    console.log('\n👨‍👩‍👧‍👦 Create Parent Account');
    console.log('═'.repeat(80));

    const name = await rl.question('Parent Name: ');
    if (!name.trim()) {
      console.log('❌ Name is required.');
      process.exit(1);
    }

    const phone = await rl.question('Phone Number: ');
    if (!phone.trim()) {
      console.log('❌ Phone number is required.');
      process.exit(1);
    }

    const email = await rl.question('Email (optional, press Enter to skip): ');
    const relationship = await rl.question('Relationship (e.g., Father, Mother, Guardian): ');

    // Get all students
    const students = await Student.find({ isDeleted: { $ne: true } })
      .populate('classId', 'name section')
      .sort({ name: 1 });

    if (students.length === 0) {
      console.log('❌ No students found in the database.');
      process.exit(1);
    }

    // Display students
    displayStudents(students);

    // Get student selection
    const selectedStudentIds = await getMultipleStudents(rl, students);

    if (selectedStudentIds.length === 0) {
      console.log('❌ At least one student must be linked to the parent.');
      process.exit(1);
    }

    // Check for existing parent in Student.parents arrays
    const existingParentStudent = await Student.findOne({
      _id: { $in: selectedStudentIds },
      'parents.phone': phone
    });

    if (existingParentStudent) {
      console.log('\n⚠️ A parent with this phone number already exists in Student.parents array.');
      console.log(`Found in student: ${existingParentStudent.name}`);

      const createAccount = await rl.question('Create Parent account anyway? (yes/no): ');

      if (createAccount.toLowerCase() !== 'yes') {
        console.log('❌ Operation cancelled.');
        process.exit(0);
      }
    }

    // Create parent object
    const parentData = {
      name: name.trim(),
      phone: phone.trim(),
      relationship: relationship.trim() || 'Guardian',
      isWhatsapp: true // Default to true
    };

    if (email.trim()) {
      parentData.email = email.trim();
    }

    // Check if Parent account already exists
    let parent = await Parent.findOne({ phone: phone.trim() });

    if (parent) {
      console.log('\n⚠️ Parent account already exists with this phone number.');
      console.log(`Parent ID: ${parent._id}`);
      console.log(`Existing linked children: ${parent.children?.length || 0}`);

      // Add new students to existing parent
      const newStudents = [];
      for (const studentId of selectedStudentIds) {
        const existingChild = parent.children.find(
          c => c.studentId.toString() === studentId.toString()
        );

        if (!existingChild) {
          parent.children.push({
            studentId: studentId,
            relationship: relationship.trim() || 'guardian',
            isPrimary: parent.children.length === 0
          });
          newStudents.push(studentId);
        }
      }

      if (newStudents.length > 0) {
        await parent.save();
        console.log(`✅ Added ${newStudents.length} new child(ren) to existing parent account.`);

        // Update Student.parents arrays for new students
        for (const studentId of newStudents) {
          await Student.findByIdAndUpdate(studentId, {
            $push: { parents: parentData }
          });
          console.log(`✅ Updated Student.parents array for student ID: ${studentId}`);
        }
      } else {
        console.log('ℹ️ All selected children are already linked to this parent.');
      }

    } else {
      // Create new Parent account
      const childrenData = selectedStudentIds.map((studentId, index) => ({
        studentId: studentId,
        relationship: relationship.trim() || 'guardian',
        isPrimary: index === 0 // First child is primary
      }));

      parent = new Parent({
        ...parentData,
        children: childrenData,
        status: 'active'
      });

      await parent.save();
      console.log('\n✅ Parent account created successfully!');
      console.log(`Parent ID: ${parent._id}`);
      console.log(`Name: ${parent.name}`);
      console.log(`Phone: ${parent.phone}`);
      console.log(`Email: ${parent.email || 'N/A'}`);
      console.log(`Linked Children: ${parent.children.length}`);

      // Update Student.parents arrays
      for (const studentId of selectedStudentIds) {
        const student = await Student.findById(studentId);

        // Check if parent already exists in parents array
        const existingParentIndex = student.parents.findIndex(
          p => p.phone === phone.trim()
        );

        if (existingParentIndex === -1) {
          // Add to parents array
          await Student.findByIdAndUpdate(studentId, {
            $push: { parents: parentData }
          });
          console.log(`✅ Added parent to Student.parents array for: ${student.name}`);
        } else {
          console.log(`ℹ️ Parent already in Student.parents array for: ${student.name}`);
        }
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(80));
    console.log(`Parent Account ID: ${parent._id}`);
    console.log(`Parent Name: ${parent.name}`);
    console.log(`Phone: ${parent.phone}`);
    console.log(`Total Linked Children: ${parent.children.length}`);

    const linkedStudentIds = parent.children.map(c => c.studentId);
    const linkedStudents = await Student.find({ _id: { $in: linkedStudentIds } });
    console.log('\nLinked Students:');
    linkedStudents.forEach((student, i) => {
      console.log(`  ${i + 1}. ${student.name} (Class: ${student.classId?.name || 'N/A'})`);
    });

    console.log('═'.repeat(80));
    console.log('✅ Operation completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    rl.close();
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed.');
  }
}

// Run the script
main();
