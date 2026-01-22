const fs = require('fs');

const filePath = './server.js';
const content = fs.readFileSync(filePath, 'utf8');

// Find the line to replace - we need to find res.status(201).json after the fee error catch
const lines = content.split('\n');
let result = [];
let skipNext = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Check if this is the line we want to replace
  if (line.includes('res.status(201).json({ id: student._id, ...student.toObject() });')) {
    // Add the new code
    result.push('  // Populate classId and format response same as GET endpoint');
    result.push('  const populatedStudent = await Student.findById(student._id).populate(\'classId\', \'name section\');');
    result.push('  const classInfo = populatedStudent.classId ? `${populatedStudent.classId.name.replace(\'Class \', \'\')}-${populatedStudent.classId.section}` : null;');
    result.push('');
    result.push('  res.status(201).json({');
    result.push('    id: populatedStudent._id,');
    result.push('    name: populatedStudent.name,');
    result.push('    admissionId: populatedStudent.admissionId,');
    result.push('    academicYear: populatedStudent.academicYear,');
    result.push('    rollNo: populatedStudent.rollNo,');
    result.push('    classId: populatedStudent.classId?._id,');
    result.push('    class: classInfo,');
    result.push('    status: populatedStudent.status || \'active\',');
    result.push('    feeStatus: populatedStudent.feeStatus || \'pending\',');
    result.push('    photo: populatedStudent.photo,');
    result.push('    documents: populatedStudent.documents || [],');
    result.push('    ...populatedStudent.toObject()');
    result.push('  });');
  } else {
    result.push(line);
  }
}

fs.writeFileSync(filePath, result.join('\n'));
console.log('✅ Updated server.js successfully');
