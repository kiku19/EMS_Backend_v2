/**
 * Migration: Add default subjects to SchoolSettings
 * 
 * This migration adds a default set of subjects to the SchoolSettings collection
 * if they don't already exist.
 */

import { connectDB, SchoolSettings } from '../database.js';

const defaultSubjects = [
  { name: 'Mathematics', code: 'MATH', description: 'Mathematics and Numerical Skills' },
  { name: 'Science', code: 'SCI', description: 'General Science' },
  { name: 'Physics', code: 'PHY', description: 'Physics' },
  { name: 'Chemistry', code: 'CHEM', description: 'Chemistry' },
  { name: 'Biology', code: 'BIO', description: 'Biology' },
  { name: 'English', code: 'ENG', description: 'English Language and Literature' },
  { name: 'Hindi', code: 'HIN', description: 'Hindi Language' },
  { name: 'History', code: 'HIST', description: 'History' },
  { name: 'Geography', code: 'GEO', description: 'Geography' },
  { name: 'Social Studies', code: 'SST', description: 'Social Studies' },
  { name: 'Computer Science', code: 'CS', description: 'Computer Science and IT' },
  { name: 'Physical Education', code: 'PE', description: 'Physical Education and Sports' },
  { name: 'Art', code: 'ART', description: 'Art and Craft' },
  { name: 'Music', code: 'MUS', description: 'Music' }
];

async function migrate() {
  try {
    await connectDB();
    console.log('🔄 Running migration: Add default subjects...');

    // Find or create SchoolSettings
    let settings = await SchoolSettings.findOne();
    
    if (!settings) {
      console.log('📝 Creating new SchoolSettings with default subjects...');
      settings = await SchoolSettings.create({
        subjects: defaultSubjects
      });
      console.log(`✅ Created SchoolSettings with ${defaultSubjects.length} subjects`);
    } else if (!settings.subjects || settings.subjects.length === 0) {
      console.log('📝 Adding default subjects to existing SchoolSettings...');
      settings.subjects = defaultSubjects;
      await settings.save();
      console.log(`✅ Added ${defaultSubjects.length} subjects to SchoolSettings`);
    } else {
      console.log(`ℹ️  SchoolSettings already has ${settings.subjects.length} subjects, skipping...`);
    }

    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
