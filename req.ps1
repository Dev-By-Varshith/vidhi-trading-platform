$body = @{
    contestant_id = "test-contestant"
    contest_id = "test-contest"
    code = "extern `"C`" void update() {}"
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:8080/api/submit -Method Post -Body $body -ContentType "application/json"
