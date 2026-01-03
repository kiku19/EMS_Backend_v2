// Reset all chat collections for fresh start
import { connectDB } from './database.js';
import mongoose from 'mongoose';

async function resetChatCollections() {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Drop conversations
    console.log('🗑️  Dropping conversations collection...');
    await mongoose.connection.db.dropCollection('conversations').catch(() => {
      console.log('⚠️  Conversations collection does not exist');
    });
    
    // Drop messages
    console.log('🗑️  Dropping messages collection...');
    await mongoose.connection.db.dropCollection('messages').catch(() => {
      console.log('⚠️  Messages collection does not exist');
    });
    
    // Drop user presence
    console.log('🗑️  Dropping userpresences collection...');
    await mongoose.connection.db.dropCollection('userpresences').catch(() => {
      console.log('⚠️  UserPresences collection does not exist');
    });
    
    console.log('\n✅ All chat collections have been reset!');
    console.log('✅ Schema will be recreated correctly on next use');
    console.log('\n📝 Note: All chat history has been deleted.');
    console.log('   Users will start with a clean slate.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetChatCollections();
