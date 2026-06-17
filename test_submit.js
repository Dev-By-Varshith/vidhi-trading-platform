// Wait, Node.js 18+ has native FormData.
// Wait, Node.js 18+ has native FormData.

async function run() {
  const code = `
def trade(state):
    return "BUY", 100
`;

  const form = new FormData();
  form.append('code', new Blob([code], { type: 'text/x-python' }), 'trader.py');
  form.append('user_id', 'test');
  form.append('round_id', 'round1');
  
  // Submit
  const res = await fetch('http://vidhi-alb-141110176.us-east-1.elb.amazonaws.com/api/submit', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  console.log("Submit:", data);
  const runId = data.run_id;

  if (!runId) return;

  // Poll
  for(let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const poll = await fetch(`http://vidhi-alb-141110176.us-east-1.elb.amazonaws.com/api/runs/${runId}`);
    const r = await poll.json();
    console.log("Poll:", r.status);
    if (r.status === 'error' || r.status === 'complete') {
        break;
    }
  }

  // Get log
  const logRes = await fetch(`http://vidhi-alb-141110176.us-east-1.elb.amazonaws.com/api/runs/${runId}/execution-log`);
  const logTxt = await logRes.text();
  console.log("--- EXECUTION LOG ---");
  console.log(logTxt);
}

run().catch(console.error);
