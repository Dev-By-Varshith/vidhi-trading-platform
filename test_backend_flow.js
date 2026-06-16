const fs = require('fs');

async function testBackend() {
  console.log("1. Provisioning API Key...");
  const resKey = await fetch('http://localhost:8080/api/apikey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 'test_user_agent' })
  });
  
  if (!resKey.ok) {
    console.error("Failed to get API key:", await resKey.text());
    return;
  }
  
  const keyData = await resKey.json();
  const apiKey = keyData.api_key;
  console.log("Got API Key:", apiKey);

  console.log("2. Submitting Code...");
  const code = `def on_tick(state, orders):
    if state.mid_price < state.underlying_signal - 0.5:
        if state.position < 100:
            orders.market_buy(10)
    elif state.mid_price > state.underlying_signal + 0.5:
        if state.position > -100:
            orders.market_sell(10)
`;

  const formData = new FormData();
  formData.append('code', new Blob([code], { type: 'text/x-python' }), 'trader.py');
  formData.append('user_id', 'test_user_agent');
  formData.append('round_id', 'round1');

  const resSubmit = await fetch('http://localhost:8080/api/submit', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: formData
  });

  if (!resSubmit.ok) {
    console.error("Submit failed:", await resSubmit.text());
    return;
  }
  
  const submitData = await resSubmit.json();
  console.log("Submit Response:", submitData);
  const runId = submitData.run_id;

  console.log("3. Polling Run Status...");
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resPoll = await fetch(`http://localhost:8080/api/runs/${runId}`, {
      headers: { 'X-API-Key': apiKey }
    });
    const pollData = await resPoll.json();
    console.log(`[POLL] Status: ${pollData.status}, Ticks: ${pollData.total_ticks}`);
    if (pollData.status === 'done' || pollData.status === 'error') {
      break;
    }
  }
}

testBackend().catch(console.error);
