import mongoose from 'mongoose';
mongoose.connect('mongodb://localhost:27017/school-management')
    .then(() => mongoose.connection.db.collection('staffs').find({
        $or: [{ name: /vimal/i }, { email: /vimal/i }]
    }).toArray())
    .then(docs => {
        console.log(JSON.stringify(docs, null, 2));
        process.exit(0);
    });
