import mongoose from 'mongoose';
mongoose.connect('mongodb+srv://eguser1:dummy123@cluster0.vy5smtv.mongodb.net/school_db?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => mongoose.connection.db.collection('staffs').deleteMany({ code: 'EMP055' }))
    .then(res => { console.log('Deleted EMP055', res); })
    .then(() => mongoose.connection.db.collection('staffs').deleteMany({ code: 'EMP052' }))
    .then(res => { console.log('Deleted EMP052', res); })
    .then(() => mongoose.connection.db.collection('staffs').deleteMany({ name: /vimal/i }))
    .then(res => { console.log('Deleted vimal', res); })
    .then(() => mongoose.connection.db.collection('staffs').deleteMany({ email: /vimal/i }))
    .then(res => { console.log('Deleted vimal emails', res); })
    .then(() => mongoose.connection.db.collection('users').deleteMany({ email: /vimal/i }))
    .then(res => { console.log('Deleted users vimal emails', res); })
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
