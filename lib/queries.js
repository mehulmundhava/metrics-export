// Curated, load-diagnosis-focused queries. `checkMetric` is the bare metric
// name the script verifies exists (via label discovery) before running the
// query, so a renamed/missing metric just gets skipped-with-a-warning
// instead of erroring the whole export out.

module.exports = [
  // --- System (node_exporter) ---
  { id: 'cpu_usage_percent', checkMetric: 'node_cpu_seconds_total',
    promql: '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' },
  { id: 'cpu_iowait_percent', checkMetric: 'node_cpu_seconds_total',
    promql: 'avg by (instance) (rate(node_cpu_seconds_total{mode="iowait"}[5m])) * 100' },
  { id: 'cpu_steal_percent', checkMetric: 'node_cpu_seconds_total',
    promql: 'avg by (instance) (rate(node_cpu_seconds_total{mode="steal"}[5m])) * 100' },
  { id: 'load1', checkMetric: 'node_load1', promql: 'node_load1' },
  { id: 'load5', checkMetric: 'node_load5', promql: 'node_load5' },
  { id: 'load15', checkMetric: 'node_load15', promql: 'node_load15' },
  { id: 'memory_available_bytes', checkMetric: 'node_memory_MemAvailable_bytes',
    promql: 'node_memory_MemAvailable_bytes' },
  { id: 'memory_total_bytes', checkMetric: 'node_memory_MemTotal_bytes',
    promql: 'node_memory_MemTotal_bytes' },
  { id: 'swap_used_bytes', checkMetric: 'node_memory_SwapTotal_bytes',
    promql: 'node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes' },
  { id: 'disk_io_time_seconds', checkMetric: 'node_disk_io_time_seconds_total',
    promql: 'rate(node_disk_io_time_seconds_total[5m])' },
  { id: 'disk_read_bytes', checkMetric: 'node_disk_read_bytes_total',
    promql: 'rate(node_disk_read_bytes_total[5m])' },
  { id: 'disk_written_bytes', checkMetric: 'node_disk_written_bytes_total',
    promql: 'rate(node_disk_written_bytes_total[5m])' },
  { id: 'filesystem_avail_bytes', checkMetric: 'node_filesystem_avail_bytes',
    promql: 'node_filesystem_avail_bytes{fstype!="tmpfs"}' },
  { id: 'network_receive_bytes', checkMetric: 'node_network_receive_bytes_total',
    promql: 'rate(node_network_receive_bytes_total[5m])' },
  { id: 'network_transmit_bytes', checkMetric: 'node_network_transmit_bytes_total',
    promql: 'rate(node_network_transmit_bytes_total[5m])' },

  // --- Kafka (kafka_exporter, mqtt-server only) ---
  { id: 'kafka_lag_by_group', checkMetric: 'kafka_consumergroup_lag',
    promql: 'sum by (consumergroup) (kafka_consumergroup_lag)' },
  { id: 'kafka_lag_total', checkMetric: 'kafka_consumergroup_lag',
    promql: 'sum(kafka_consumergroup_lag)' },

  // --- Postgres (postgres_exporter, postgre-db only) ---
  { id: 'pg_up', checkMetric: 'pg_up', promql: 'pg_up' },
  { id: 'pg_active_connections', checkMetric: 'pg_stat_activity_count',
    promql: 'sum by (state) (pg_stat_activity_count)' },
  { id: 'pg_locks_by_mode', checkMetric: 'pg_locks_count',
    promql: 'sum by (mode) (pg_locks_count)' },
  { id: 'pg_xact_commit_rate', checkMetric: 'pg_stat_database_xact_commit',
    promql: 'rate(pg_stat_database_xact_commit[5m])' },
  { id: 'pg_xact_rollback_rate', checkMetric: 'pg_stat_database_xact_rollback',
    promql: 'rate(pg_stat_database_xact_rollback[5m])' },
  { id: 'pg_blks_read_rate', checkMetric: 'pg_stat_database_blks_read',
    promql: 'rate(pg_stat_database_blks_read[5m])' },
  { id: 'pg_blks_hit_rate', checkMetric: 'pg_stat_database_blks_hit',
    promql: 'rate(pg_stat_database_blks_hit[5m])' },
  { id: 'pg_temp_bytes_rate', checkMetric: 'pg_stat_database_temp_bytes',
    promql: 'rate(pg_stat_database_temp_bytes[5m])' },
  { id: 'pg_deadlocks', checkMetric: 'pg_stat_database_deadlocks',
    promql: 'pg_stat_database_deadlocks' },
  { id: 'pg_replication_lag_seconds', checkMetric: 'pg_replication_lag_seconds',
    promql: 'pg_replication_lag_seconds' },
  { id: 'pg_stat_statements_calls_rate', checkMetric: 'pg_stat_statements_calls_total',
    promql: 'sum(rate(pg_stat_statements_calls_total[5m]))' },
  { id: 'pg_stat_statements_time_rate', checkMetric: 'pg_stat_statements_seconds_total',
    promql: 'sum(rate(pg_stat_statements_seconds_total[5m]))' },

  // --- App-level (mqtt-server + api-server custom instrumentation) ---
  { id: 'location_api_p95_latency', checkMetric: 'location_api_http_request_duration_seconds_bucket',
    promql: 'histogram_quantile(0.95, sum by (le, route) (rate(location_api_http_request_duration_seconds_bucket[5m])))' },
  { id: 'stage2_p95_latency', checkMetric: 'location_pipeline_stage2_latency_seconds_bucket',
    promql: 'histogram_quantile(0.95, sum by (le) (rate(location_pipeline_stage2_latency_seconds_bucket[5m])))' },
  { id: 'stage2_k_inserted_rate', checkMetric: 'location_pipeline_stage2_k_inserted_total',
    promql: 'rate(location_pipeline_stage2_k_inserted_total[5m])' },
  { id: 'stage2_k_insert_failed_rate', checkMetric: 'location_pipeline_stage2_k_insert_failed_total',
    promql: 'rate(location_pipeline_stage2_k_insert_failed_total[5m])' },
  { id: 'stage2_message_drop_rate', checkMetric: 'location_pipeline_stage2_message_drop_total',
    promql: 'sum by (stage, reason, caller) (rate(location_pipeline_stage2_message_drop_total[5m]))' },
];

// Prefix-based auto-discovery for exporters whose exact metric names weren't
// pinned down in project notes (pm2-prom-module, process_exporter). The
// script finds every metric matching these prefixes and pulls history for
// each — no query_range errors possible since names come straight from
// Prometheus's own label index.
module.exports.autoDiscoverPrefixes = ['pm2_', 'namedprocess_namegroup_'];
