const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/school-management')
    .then(() => mongoose.connection.db.collection('staffs').find({ name: 'vimal' }).toArray())
    .then(docs => {
        console.log(JSON.stringify(docs, null, 2));
        process.exit(0);
    });
