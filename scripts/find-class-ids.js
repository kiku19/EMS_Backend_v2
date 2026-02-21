import mongoose from 'mongoose';
import { connectDB, Class } from '../database.js';

async function findClasses() {
  await connectDB();
  const ids = [
    '6972605d47f5721444d7afbd',
    '6972605d47f5721444d7afbe',
    '6972605d47f5721444d7afbf',
    '6972605d47f5721444d7afc0',
    '6972605d47f5721444d7afc1',
    '6972605d47f5721444d7afc2'
  ];

  console.log('Classes Anil teaches Physical Education to:\n');
  for (const id of ids) {
    const cls = await Class.findById(id);
    if (cls) {
      console.log(`${cls.name}-${cls.section} | ID: ${cls._id.toString()}`);
    } else {
      console.log(`NOT FOUND | ID: ${id}`);
    }
  }

  await mongoose.connection.close();
}

findClasses();
