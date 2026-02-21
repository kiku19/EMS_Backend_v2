/**
 * Check Staff via API
 * 
 * This script checks a specific staff member's data via the API
 */

const staffId = process.argv[2] || '69900115d125322003266f9d';
const API_URL = process.env.API_URL || 'http://localhost:3001/api';

async function checkStaff() {
  try {
    console.log(`📋 Looking up staff with ID: ${staffId}\n`);
    
    const response = await fetch(`${API_URL}/staff/${staffId}`, {
      headers: {
        'Authorization': 'Bearer dummy-token-for-testing'
      }
    });
    
    if (!response.ok) {
      console.log(`❌ API Error: ${response.status} ${response.statusText}\n`);
      const error = await response.text();
      console.log(error);
      return;
    }
    
    const staff = await response.json();
    
    console.log('📄 Staff Record:');
    console.log('================\n');
    
    // Check if name is an ObjectId
    const nameIsObjectId = /^[a-f\d]{24}$/i.test(staff.name);
    
    console.log(`ID: ${staff.id || staff._id}`);
    console.log(`Name: ${staff.name} ${nameIsObjectId ? '⚠️ (IS AN OBJECTID!)' : '✅'}`);
    console.log(`Code: ${staff.code || 'N/A'}`);
    console.log(`Email: ${staff.email || 'N/A'}`);
    console.log(`Phone: ${staff.phone || 'N/A'}`);
    console.log(`Role: ${staff.role || 'N/A'}`);
    console.log(`Department: ${staff.department || 'N/A'}`);
    console.log(`Status: ${staff.status || 'N/A'}`);
    console.log(`Username: ${staff.username || 'N/A'}`);
    console.log(`Join Date: ${staff.joinDate || 'N/A'}`);
    
    if (staff.reporterName) {
      console.log(`\nReporter:`);
      console.log(`  ID: ${staff.reporterId}`);
      console.log(`  Name: ${staff.reporterName}`);
    }
    
    if (nameIsObjectId) {
      console.log('\n⚠️ WARNING: The name field contains a MongoDB ObjectId!');
      console.log('This is a data corruption issue in the database.\n');
      
      // Suggest a fix
      let suggestedName = null;
      if (staff.code) {
        suggestedName = `Staff ${staff.code}`;
      } else if (staff.email) {
        const emailPrefix = staff.email.split('@')[0];
        suggestedName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
      } else {
        suggestedName = `${staff.role || 'Staff'} ${(staff.id || staff._id).toString().slice(-6)}`;
      }
      
      console.log(`💡 Suggested fix: Update name to "${suggestedName}"`);
      console.log(`\nTo fix this, you need to update the database directly.`);
      console.log(`The backend API should have an endpoint to update staff, or use MongoDB directly.`);
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkStaff();
