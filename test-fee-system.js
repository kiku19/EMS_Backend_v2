import axios from 'axios';

const API_URL = 'http://localhost:3001';

async function testFeeSystem() {
  console.log('🧪 Testing Fee Management System\n');

  try {
    // Test 1: Create a fee head for classes 1-5
    console.log('1️⃣ Creating Tuition Fee for Classes 1-5...');
    const feeHeadResponse = await axios.post(`${API_URL}/api/fee-heads`, {
      name: 'Tuition Fee',
      category: 'Academic',
      amount: 50000,
      applicableClasses: ['1', '2', '3', '4', '5'],
      frequency: 'yearly',
      mandatory: true,
      description: 'Annual tuition fee',
      autoApply: true
    });
    console.log('✅ Fee head created:', feeHeadResponse.data.name);
    console.log('   ID:', feeHeadResponse.data._id);
    console.log('   Applicable to classes:', feeHeadResponse.data.applicableClasses.join(', '));

    // Test 2: Get all fee heads
    console.log('\n2️⃣ Fetching all fee heads...');
    const allFeeHeads = await axios.get(`${API_URL}/api/fee-heads`);
    console.log('✅ Total fee heads:', allFeeHeads.data.length);
    allFeeHeads.data.forEach(fh => {
      console.log(`   - ${fh.name}: ₹${fh.amount} (Classes: ${fh.applicableClasses.join(', ')})`);
    });

    // Test 3: Create another fee head for classes 9-12
    console.log('\n3️⃣ Creating Lab Fee for Classes 9-12...');
    const labFeeResponse = await axios.post(`${API_URL}/api/fee-heads`, {
      name: 'Lab Fee',
      category: 'Academic',
      amount: 8000,
      applicableClasses: ['9', '10', '11', '12'],
      frequency: 'yearly',
      mandatory: true,
      description: 'Laboratory and practical fee',
      autoApply: true
    });
    console.log('✅ Lab fee created:', labFeeResponse.data.name);

    // Test 4: Update fee head
    console.log('\n4️⃣ Updating Tuition Fee amount...');
    const updateResponse = await axios.put(`${API_URL}/api/fee-heads/${feeHeadResponse.data._id}`, {
      ...feeHeadResponse.data,
      amount: 55000
    });
    console.log('✅ Fee head updated. New amount: ₹' + updateResponse.data.amount);

    // Test 5: Get all students with fee structures
    console.log('\n5️⃣ Checking student fee structures...');
    const studentFees = await axios.get(`${API_URL}/api/student-fees/all`);
    console.log('✅ Students with fee structures:', studentFees.data.length);
    if (studentFees.data.length > 0) {
      const sample = studentFees.data[0];
      console.log('   Sample student:');
      console.log('   - Name:', sample.studentId?.name || 'N/A');
      console.log('   - Total Fee: ₹' + sample.totalFee);
      console.log('   - Fee Heads:', sample.feeHeads.length);
    }

    // Test 6: Apply fee head to students manually
    console.log('\n6️⃣ Manually applying fee head to students...');
    const applyResponse = await axios.post(`${API_URL}/api/fee-heads/${feeHeadResponse.data._id}/apply`);
    console.log('✅', applyResponse.data.message);

    console.log('\n✅ All tests passed! Fee management system is working correctly.\n');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('   Status:', error.response?.status);
    console.error('   URL:', error.config?.url);
  }
}

// Run tests
testFeeSystem();
