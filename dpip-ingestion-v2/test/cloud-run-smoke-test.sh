set -eu

: "${DPIP_URL:?Set DPIP_URL to the deployed ingestion URL}"
: "${DPIP_SECRET:?Set DPIP_SECRET to the ingestion bearer secret}"

curl -sS -i --max-time 60 -X POST \
  "${DPIP_URL}" \
  -H "Authorization: Bearer ${DPIP_SECRET}" \
  -H 'Content-Type: text/plain; charset=utf-8' \
  --data-binary @- <<'JSON'
[
  {
    "table": "reports",
    "data": [
      ["identifier_type", "reported_date", "party_id", "sub_source", "status", "customer_type", "metrics_type", "metrics_value"],
      ["DPIP_TEST", "2026-07-23", "dpip-test-20260723", "manual", "TEST", "ALL", "reports_count", 4]
    ]
  },
  {
    "table": "screenings",
    "data": [
      ["screening_date", "party_id", "event_type", "screening_status", "count"],
      ["2026-07-23", "dpip-test-20260723", "TEST", "TEST", 1]
    ]
  },
  {
    "table": "cluster_external_entities",
    "data": [
      ["cluster_count", "num_external_entities", "last_updated_date"],
      [9000000001, 9000000002, "2026-07-23"]
    ]
  },
  {
    "table": "external_entity_identifiers",
    "data": [
      ["party_id", "external_entity_count", "num_identifiers", "last_updated_date"],
      ["dpip-test-20260723", 9000000002, 9000000003, "2026-07-23"]
    ]
  },
  {
    "table": "cluster_identifiers",
    "data": [
      ["cluster_count", "num_identifiers", "last_updated_date"],
      [9000000001, 9000000003, "2026-07-23"]
    ]
  },
  {
    "table": "party_identifiers",
    "data": [
      ["party_ids", "num_identifiers", "last_updated_date"],
      ["party-1, party-2", 9000000003, "2026-07-23"]
    ]
  },
  {
    "table": "entities_by_customer",
    "data": [
      ["customer_type", "entity_count", "last_updated_date"],
      ["ALL", 9000000004, "2026-07-23"]
    ]
  }
]
JSON
