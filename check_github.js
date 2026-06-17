async function run() {
  const res = await fetch('https://api.github.com/repos/Dev-By-Varshith/vidhi-trading-platform/actions/runs?per_page=1');
  const data = await res.json();
  const runId = data.workflow_runs[0].id;
  console.log("Run ID:", runId);
  const jobsRes = await fetch(`https://api.github.com/repos/Dev-By-Varshith/vidhi-trading-platform/actions/runs/${runId}/jobs`);
  const jobsData = await jobsRes.json();
  for (const job of jobsData.jobs) {
    if (job.conclusion === 'failure') {
      console.log("Failed Job:", job.name);
      for (const step of job.steps) {
        if (step.conclusion === 'failure') {
          console.log("Failed Step:", step.name);
        }
      }
    }
  }
}
run();
