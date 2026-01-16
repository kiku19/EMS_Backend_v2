# 🧪 Test Instructions for Student & Staff Data Management

## 📋 Overview

This guide helps you test the newly implemented features:
- ✅ Student creation with new fields (aadhaarNumber, mediumOfInstruction, house)
- ✅ Staff creation with new fields (emergencyContacts[], roleInOrganization, customDocuments[])
- ✅ File uploads to Cloudinary
- ✅ Database field storage verification

---

## 🚀 Quick Start - Automated Testing

### Option 1: Run the Test Script (Recommended)

```bash
cd backend
node tmp_rovodev_test-student-staff.js
```

**What this does:**
- ✅ Creates a test class, student, and staff member
- ✅ Verifies all new fields are stored correctly
- ✅ Checks password hashing
- ✅ Tests nested arrays and objects
- ✅ Provides detailed output with color coding

**Expected Output:**
```
🚀 STARTING DATA MANAGEMENT TESTS
✅ Connected to database

📚 TEST 1: CREATE CLASS
✅ Class created: Class 10 A (ID: ...)

👨‍🎓 TEST 2: CREATE STUDENT
✅ Student created: Test Student
   Admission ID: ADM-2024-0001
   Roll No: 1

🔍 VERIFYING STUDENT FIELDS
✅ aadhaarNumber: 123456789012
✅ mediumOfInstruction: English
✅ house: Red House
✅ parents array: 2
✅ photo: true

✅ ALL STUDENT FIELDS VERIFIED

👨‍🏫 TEST 3: CREATE STAFF
✅ Staff created: Test Staff Member
   Staff Code: EMP001
   Username: teststaff

🔍 VERIFYING STAFF FIELDS
✅ emergencyContacts array: 2
✅ roleInOrganization: Senior Teacher
✅ customDocuments array: 2
✅ professionalQualifications array: 2
✅ idDocuments object: true
✅ picture: true
✅ salaryBreakdown array: 3

✅ ALL STAFF FIELDS VERIFIED

🎉 ALL TESTS PASSED! 🎉
```

---

## 🧪 Manual Testing via UI

### Test 1: Student Creation

1. **Start the servers:**
   ```bash
   # Terminal 1 - Backend
   cd backend
   npm start
   
   # Terminal 2 - Frontend
   cd school-dashboard
   npm run dev
   ```

2. **Open the application:**
   - Navigate to `http://localhost:5173`
   - Login with admin credentials

3. **Create a new student:**
   - Go to Students → Add Student
   - Fill in all fields including:
     - ✅ **Aadhaar Number** (Step 1, Optional Info section)
     - ✅ **Medium of Instruction** (should be in Class Info)
     - ✅ **House** (should be in Class Info)
   - Upload a photo
   - Add multiple parents
   - Submit

4. **Verify in database:**
   ```bash
   # Connect to MongoDB
   mongosh
   
   # Switch to your database
   use school_db
   
   # Find the student
   db.students.findOne({ name: "Your Student Name" })
   
   # Check for new fields
   db.students.findOne({ name: "Your Student Name" }, { 
     aadhaarNumber: 1, 
     mediumOfInstruction: 1, 
     house: 1,
     parents: 1,
     photo: 1
   })
   ```

---

### Test 2: Staff Creation with File Uploads

1. **Create a new staff member:**
   - Go to Staffs → Add Staff
   - Fill in all fields including:
     - ✅ **Multiple Emergency Contacts** (Step 1)
     - ✅ **Role in Previous Organization** (Step 2, Experience section)
   - **Upload files:**
     - ✅ Profile picture
     - ✅ ID documents (Aadhaar, PAN, etc.)
     - ✅ Qualification certificates
     - ✅ Other certificates

2. **Monitor console logs:**
   - Open browser DevTools (F12)
   - Watch for upload messages:
     ```
     📸 Uploading staff photo to Cloudinary...
     ✅ Staff photo uploaded: https://res.cloudinary.com/...
     ✅ Aadhar Card uploaded: https://res.cloudinary.com/...
     ✅ Qualification doc uploaded: https://res.cloudinary.com/...
     ```

3. **Verify in database:**
   ```bash
   mongosh
   use school_db
   
   # Find the staff member
   db.staffs.findOne({ name: "Your Staff Name" })
   
   # Check specific fields
   db.staffs.findOne({ name: "Your Staff Name" }, {
     emergencyContacts: 1,
     roleInOrganization: 1,
     customDocuments: 1,
     picture: 1,
     idDocuments: 1,
     professionalQualifications: 1
   })
   ```

---

## 🔍 Verification Checklist

### Student Data ✓
- [ ] `aadhaarNumber` field is stored
- [ ] `mediumOfInstruction` field is stored
- [ ] `house` field is stored
- [ ] `parents` array contains multiple parents
- [ ] `photo` is a Cloudinary URL
- [ ] All other fields are saved correctly

### Staff Data ✓
- [ ] `emergencyContacts` is an array with multiple contacts
- [ ] Each emergency contact has `name`, `relationship`, `phone`
- [ ] `roleInOrganization` is stored
- [ ] `customDocuments` is an array of URLs
- [ ] `picture` is a Cloudinary URL (not a File object)
- [ ] `idDocuments` is an object (not array) with URLs
- [ ] `professionalQualifications` array has documents as URLs
- [ ] `qualificationDocs` is an array of URLs
- [ ] Password is hashed (not plain text)

---

## 🐛 Troubleshooting

### Issue: Files not uploading

**Check 1: Cloudinary Configuration**
```bash
# Check .env file
cat backend/.env | grep CLOUDINARY

# Should have:
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

**Check 2: File size**
- Files must be under 10MB
- Supported formats: JPG, PNG, PDF

**Check 3: Console logs**
- Look for "Upload failed" messages
- Check network tab for upload requests

---

### Issue: Fields not saving

**Check 1: Schema updates**
```bash
# Restart backend after schema changes
cd backend
npm start
```

**Check 2: Database connection**
```bash
# Test connection
mongosh "mongodb://localhost:27017/school_db"
```

**Check 3: Field names**
- UI field names must match database schema
- Check `handleSubmit` function transforms data correctly

---

### Issue: Test script fails

**Common fixes:**
```bash
# Make sure MongoDB is running
sudo systemctl status mongod  # Linux
brew services list | grep mongodb  # Mac

# Check Node version (should be 18+)
node --version

# Reinstall dependencies
cd backend
rm -rf node_modules package-lock.json
npm install
```

---

## 📊 Expected Test Results

### ✅ Success Indicators

1. **Automated Test:**
   - All checks show ✅ green checkmarks
   - Final message: "🎉 ALL TESTS PASSED!"
   - No ❌ red errors

2. **Manual UI Test:**
   - Form submits without errors
   - Toast notification: "Student/Staff created successfully"
   - Files upload without warnings
   - Data appears in the list view

3. **Database Verification:**
   - All fields present in MongoDB document
   - URLs start with `https://res.cloudinary.com/`
   - Arrays contain expected number of items
   - Password is hashed (long random string)

---

## 🎯 What to Look For

### Student Document Example:
```javascript
{
  _id: ObjectId("..."),
  name: "John Doe",
  admissionId: "ADM-2024-0001",
  aadhaarNumber: "123456789012",  // ✅ NEW FIELD
  mediumOfInstruction: "English",  // ✅ NEW FIELD
  house: "Red House",              // ✅ NEW FIELD
  parents: [                        // ✅ Array
    { name: "Father", relationship: "Father", phone: "..." },
    { name: "Mother", relationship: "Mother", phone: "..." }
  ],
  photo: "https://res.cloudinary.com/...", // ✅ URL not File
  // ... other fields
}
```

### Staff Document Example:
```javascript
{
  _id: ObjectId("..."),
  name: "Jane Smith",
  code: "EMP001",
  emergencyContacts: [              // ✅ NEW ARRAY
    { name: "Contact 1", relationship: "Spouse", phone: "..." },
    { name: "Contact 2", relationship: "Parent", phone: "..." }
  ],
  roleInOrganization: "Senior Teacher",  // ✅ NEW FIELD
  customDocuments: [                // ✅ NEW ARRAY
    "https://res.cloudinary.com/...",
    "https://res.cloudinary.com/..."
  ],
  picture: "https://res.cloudinary.com/...",
  idDocuments: {                    // ✅ OBJECT (not array)
    "Aadhar Card": "https://res.cloudinary.com/...",
    "PAN Card": "https://res.cloudinary.com/..."
  },
  professionalQualifications: [
    {
      name: "B.Ed",
      year: "2012",
      documents: [                  // ✅ URLs not Files
        "https://res.cloudinary.com/..."
      ]
    }
  ],
  password: "$2b$10$...",           // ✅ Hashed
  // ... other fields
}
```

---

## 📝 Test Report Template

Use this to document your testing:

```
## Test Execution Report

**Date:** _____________
**Tester:** _____________
**Environment:** Development / Production

### Automated Test Results
- [ ] Test script ran successfully
- [ ] All student fields verified ✅
- [ ] All staff fields verified ✅
- [ ] Password hashing works ✅

### Manual UI Testing

#### Student Creation
- [ ] Form loads correctly
- [ ] All fields are editable
- [ ] Photo upload works
- [ ] Aadhaar field saves
- [ ] Medium & House fields save
- [ ] Multiple parents can be added
- [ ] Submit succeeds
- [ ] Data in database matches form

**Issues found:** _____________

#### Staff Creation
- [ ] Form loads correctly
- [ ] Profile picture uploads to Cloudinary
- [ ] Multiple emergency contacts can be added
- [ ] Role in organization field saves
- [ ] ID documents upload to Cloudinary
- [ ] Qualification docs upload to Cloudinary
- [ ] Custom documents upload to Cloudinary
- [ ] Submit succeeds
- [ ] All URLs in database (no File objects)

**Issues found:** _____________

### Overall Status
- [ ] All tests passed ✅
- [ ] Ready for production
- [ ] Issues need fixing

**Notes:** _____________
```

---

## 🆘 Getting Help

If tests fail or you encounter issues:

1. **Check console logs** (both browser and backend)
2. **Review the test output** for specific error messages
3. **Verify database connection** and Cloudinary credentials
4. **Check file formats and sizes**
5. **Restart both frontend and backend** after code changes

---

## 🎉 Success Criteria

Your implementation is successful when:

✅ Automated test script shows "ALL TESTS PASSED"  
✅ Students can be created with aadhaarNumber, medium, house  
✅ Staff can be created with multiple emergency contacts  
✅ All files upload to Cloudinary (no local storage)  
✅ Database contains URLs (not File objects)  
✅ Passwords are hashed  
✅ No console errors during submission  

---

## 🧹 Cleanup

After testing, remove test data:

```bash
# Using the automated script (leaves data for inspection)
# Manually delete via MongoDB:
mongosh school_db
db.students.deleteMany({ name: /Test/ })
db.staffs.deleteMany({ name: /Test/ })
db.classes.deleteMany({ name: "Class 10", section: "A" })

# Delete test files
cd backend
rm tmp_rovodev_*
```

---

**Happy Testing! 🚀**
