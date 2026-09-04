BEGIN;

TRUNCATE TABLE
  dpip.reports_v2,
  dpip.screenings_v2,
  dpip.cluster_external_entities_v2,
  dpip.external_entity_identifiers_v2,
  dpip.cluster_identifiers_v2,
  dpip.party_identifiers_v2,
  dpip.entities_by_customer_v2;

COMMIT;
