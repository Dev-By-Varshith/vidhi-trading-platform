import requests; res = requests.post("http://localhost:8080/api/submit", headers={"X-API-Key": "admin-key"}, files={"code": ("test.py", b"print(1)")}); print(res.status_code, res.text)
