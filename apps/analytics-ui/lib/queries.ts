export const queryTemplates = {
  overview: `select count(*) as total_requests, sum(case when action='block_input' then 1 else 0 end) as blocked_requests, sum(case when output_leak=true then 1 else 0 end) as leak_events, avg(latency_ms) as avg_latency_ms from events`,
  attackTrends: `select date_trunc('hour', timestamp) as hour, count(*) as blocked from events where action = 'block_input' group by 1 order by 1`,
  leakFrequency: `select u.leak_type, count(*) as cnt from events e, unnest(e.leak_types) as u(leak_type) where e.output_leak = true group by 1 order by cnt desc limit 20`,
  providerRisk: `select upstream, avg(input_score) as avg_risk, count(*) as reqs from events group by 1 order by avg_risk desc limit 20`,
  userBehavior: `select coalesce(user_id,'unknown') as user_id, count(*) as requests, sum(case when action='block_input' then 1 else 0 end) as blocks from events group by 1 order by requests desc limit 50`,
  criticalIncidents: `select timestamp, request_id, pii_tag, action, input_score from events where pii_tag='CRITICAL' or action='terminate_stream' order by timestamp desc limit 50`,
  decisionFeed: `select timestamp, request_id, coalesce(user_id,'unknown') as user_id, action, input_score, output_leak, leak_types, pii_tag, latency_ms, upstream from events order by timestamp desc limit 100`
};
