# Test login endpoint
$body = @{
    email = "vikram@school.com"
    password = "password123"
} | ConvertTo-Json

Write-Host "Testing login with Vikram Patel..."
Write-Host "Email: vikram@school.com"
Write-Host "Password: password123"
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/api/auth/login" -Method Post -Body $body -ContentType "application/json"
    
    Write-Host "Login Successful!"
    Write-Host ""
    Write-Host "User Details:"
    Write-Host "  Name: $($response.name)"
    Write-Host "  Email: $($response.email)"
    Write-Host "  Role: $($response.role)"
    Write-Host "  ID: $($response.id)"
    Write-Host ""
    Write-Host "Login endpoint is working correctly!"
} catch {
    Write-Host "Login Failed!"
    Write-Host $_.Exception.Message
}
