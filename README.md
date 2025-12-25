# School Backend API

Node.js + Express backend with MongoDB Atlas.

## Deploy to Render (Free)

1. **Push to GitHub**: Create a new repo and push the `backend` folder

2. **Create Render Account**: Go to [render.com](https://render.com) and sign up

3. **New Web Service**:
   - Click "New" → "Web Service"
   - Connect your GitHub repo
   - Select the `backend` folder as root directory
   - Settings:
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`

4. **Add Environment Variable**:
   - Key: `MONGODB_URI`
   - Value: `mongodb+srv://eguser1:kttjJ9YiAZUWVnKe@cluster0.vy5smtv.mongodb.net/school_db`

5. **Deploy**: Click "Create Web Service"

Your API will be live at: `https://your-app-name.onrender.com`

## After Deployment

Update the API URLs in:
- `Teacher app/teacher-app/src/config.js`
- `school-dashboard/.env` (create if needed)

Example:
```js
export const API_URL = 'https://your-app-name.onrender.com/api';
```

## Local Development

```bash
npm install
npm run dev
```

## Seed Database

```bash
npm run seed
```

## API Endpoints

- `POST /api/auth/login` - Login with phone + password
- `GET /api/staff` - Get all staff
- `GET /api/students` - Get all students
- `GET /api/classes` - Get all classes
- `POST /api/attendance/bulk` - Mark attendance
