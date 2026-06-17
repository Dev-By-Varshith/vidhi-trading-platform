import urllib.request
import json

url = "https://api.github.com/repos/Dev-By-Varshith/vidhi-trading-platform/actions/runs"
req = urllib.request.Request(url)
req.add_header('User-Agent', 'Mozilla/5.0')
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    runs = data.get('workflow_runs', [])[:5]
    for r in runs:
        print(f"Run {r['id']}: {r['name']} | Status: {r['status']} | Conclusion: {r['conclusion']} | Created: {r['created_at']}")
