# Deploy Backend to Render - Complete Guide

## Prerequisites

1. **GitHub Account** - Your code needs to be in a GitHub repository
2. **Render Account** - Sign up at https://render.com (free tier available)
3. **MongoDB Atlas** - Free cloud database at https://www.mongodb.com/atlas
4. **Cloudinary Account** - For file uploads at https://cloudinary.com (free tier)

## Step 1: Prepare MongoDB Atlas (5 minutes)

1. Go to https://www.mongodb.com/atlas
2. Sign up or log in
3. Create a **FREE** cluster (M0 Sandbox)
4. Click **"Connect"** on your cluster
5. Create a database user (username + password)
6. Choose **"Connect your application"**
7. Copy the connection string, it looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/school_db
   ```
8. Replace `<username>` and `<password>` with your actual credentials
9. Keep this connection string - you'll need it for Render

## Step 2: Get Cloudinary Credentials

1. Go to https://cloudinary.com
2. Sign up or log in
3. Go to Dashboard
4. Copy these three values:
   - **Cloud Name**
   - **API Key**
   - **API Secret**
5. Keep these handy for Render setup

## Step 3: Push Code to GitHub

Make sure your backend code is in a GitHub repository:

```bash
cd backend
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

## Step 4: Deploy to Render

### 4.1 Create New Web Service

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Select your repository
5. Configure the service:

   **Basic Settings:**
   - **Name:** `school-backend` (or your preferred name)
   - **Region:** Choose closest to your users
   - **Branch:** `main` (or your default branch)
   - **Root Directory:** `backend` (if backend is in a subfolder)
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`

   **Instance Type:**
   - Select **"Free"** (or paid plan if needed)

### 4.2 Add Environment Variables

Click **"Advanced"** and add these environment variables:

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | Already set in render.yaml |
| `PORT` | `3001` | Already set in render.yaml |
| `MONGODB_URI` | `mongodb+srv://...` | Your MongoDB Atlas connection string |
| `CLOUDINARY_CLOUD_NAME` | `your_cloud_name` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | `your_api_key` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | `your_api_secret` | From Cloudinary dashboard |

### 4.3 Deploy

1. Click **"Create Web Service"**
2. Render will start building and deploying
3. Wait 2-5 minutes for deployment to complete
4. You'll get a URL like: `https://school-backend.onrender.com`

## Step 5: Update Frontend to Use Render Backend

Update your frontend `.env` file:

```env
# Old (local)
VITE_API_URL=http://localhost:3001

# New (Render)
VITE_API_URL=https://your-app-name.onrender.com
```

Or update `school-dashboard/.env`:

```env
VITE_API_URL=https://school-backend.onrender.com
```

## Step 6: Test Your Deployment

1. Open your Render backend URL in browser: `https://your-app.onrender.com`
2. You should see a response (or 404 if no root route)
3. Test an API endpoint: `https://your-app.onrender.com/api/students`
4. Test from your frontend application

## Important Notes

### Free Tier Limitations

- **Render Free Tier:**
  - Service spins down after 15 minutes of inactivity
  - First request after spin-down takes 30-60 seconds (cold start)
  - 750 hours/month free (enough for one service)

- **MongoDB Atlas Free Tier:**
  - 512 MB storage
  - Shared CPU
  - Perfect for development/testing

- **Cloudinary Free Tier:**
  - 25 GB storage
  - 25 GB bandwidth/month
  - More than enough for most apps

### Keeping Service Awake (Optional)

To prevent cold starts, you can:

1. **Use a ping service** (free):
   - https://uptimerobot.com
   - https://cron-job.org
   - Ping your backend every 10 minutes

2. **Upgrade to paid plan** ($7/month):
   - No cold starts
   - Always running

### CORS Configuration

Make sure your backend allows requests from your frontend domain. In `server.js`:

```javascript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://your-frontend-domain.vercel.app',
    'https://school-backend.onrender.com'
  ],
  credentials: true
}));
```

## Troubleshooting

### Build Fails

- Check Node version in `package.json` matches Render's Node version
- Ensure all dependencies are in `package.json`
- Check build logs in Render dashboard

### Service Won't Start

- Check environment variables are set correctly
- Verify MongoDB connection string is correct
- Check logs in Render dashboard for errors

### Can't Connect from Frontend

- Verify CORS settings in backend
- Check frontend is using correct Render URL
- Ensure Render service is running (not sleeping)

### Database Connection Issues

- Verify MongoDB Atlas connection string
- Check IP whitelist in MongoDB Atlas (allow all: `0.0.0.0/0`)
- Ensure database user has correct permissions

## Monitoring & Logs

- **View Logs:** Render Dashboard → Your Service → Logs
- **Monitor Status:** Render Dashboard → Your Service → Events
- **Check Metrics:** Render Dashboard → Your Service → Metrics

## Updating Your Deployment

Render auto-deploys when you push to GitHub:

```bash
git add .
git commit -m "Update backend"
git push origin main
```

Render will automatically rebuild and redeploy (takes 2-5 minutes).

## Manual Deploy

If auto-deploy is disabled:
1. Go to Render Dashboard
2. Click your service
3. Click **"Manual Deploy"** → **"Deploy latest commit"**

## Environment Variables Management

To update environment variables:
1. Render Dashboard → Your Service → Environment
2. Add/Edit variables
3. Click **"Save Changes"**
4. Service will automatically restart

## Cost Estimate

**Free Setup (Recommended for Development):**
- Render: Free tier
- MongoDB Atlas: Free tier (M0)
- Cloudinary: Free tier
- **Total: $0/month**

**Production Setup:**
- Render: $7/month (Starter)
- MongoDB Atlas: $9/month (M2) or stay on free
- Cloudinary: Free tier (usually sufficient)
- **Total: $7-16/month**

## Next Steps

1. ✅ Deploy backend to Render
2. ✅ Update frontend to use Render URL
3. ✅ Test all API endpoints
4. ✅ Set up monitoring/alerts
5. ✅ Configure custom domain (optional)

## Support

- **Render Docs:** https://render.com/docs
- **MongoDB Atlas Docs:** https://docs.atlas.mongodb.com
- **Cloudinary Docs:** https://cloudinary.com/documentation

---

**Your backend is now live on Render! 🚀**
