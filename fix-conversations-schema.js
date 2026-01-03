// Fix conversation schema - update existing conversations
import { connectDB } from './database.js';
import mongoose from 'mongoose';

async function fixConversations() {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Drop the conversations collection to reset schema
    console.log('🗑️  Dropping conversations collection...');
    await mongoose.connection.db.dropCollection('conversations').catch(() => {
      console.log('⚠️  Collection does not exist or already dropped');
    });
    
    console.log('✅ Conversations collection dropped');
    console.log('✅ Schema will be recreated on next message send');
    console.log('\n📝 Note: All existing conversations have been deleted.');
    console.log('   Users will need to start new conversations.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixConversations();
