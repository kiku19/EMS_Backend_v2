# Start Backend Server (with port cleanup)
Write-Host "🚀 Starting Backend Server..." -ForegroundColor Cyan
Write-Host ""

# Kill any existing process on port 3001
Write-Host "🔍 Checking for existing processes on port 3001..." -ForegroundColor Yellow
$processes = netstat -ano | findstr :3001 | findstr LISTENING
if ($processes) {
    $pid = ($processes -split '\s+')[-1]
    Write-Host "⚠️  Found process $pid using port 3001" -ForegroundColor Yellow
    Write-Host "🔪 Killing process..." -ForegroundColor Red
    taskkill /F /PID $pid | Out-Null
    Start-Sleep -Seconds 1
    Write-Host "✅ Port 3001 is now free!" -ForegroundColor Green
    Write-Host ""
}

# Start the server
Write-Host "🚀 Starting server on port 3001..." -ForegroundColor Cyan
Write-Host ""
node server.js
