# Kill any process using port 3001
Write-Host "🔍 Checking for processes on port 3001..." -ForegroundColor Cyan

$processes = netstat -ano | findstr :3001 | findstr LISTENING
if ($processes) {
    $pid = ($processes -split '\s+')[-1]
    Write-Host "⚠️  Found process $pid using port 3001" -ForegroundColor Yellow
    Write-Host "🔪 Killing process..." -ForegroundColor Red
    taskkill /F /PID $pid
    Write-Host "✅ Port 3001 is now free!" -ForegroundColor Green
} else {
    Write-Host "✅ Port 3001 is already free!" -ForegroundColor Green
}
