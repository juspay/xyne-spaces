BEGIN;

TRUNCATE TABLE
  dpip.reports,
  dpip.screenings,
  dpip.cluster_external_entities,
  dpip.external_entity_identifiers,
  dpip.cluster_identifiers,
  dpip.party_identifiers,
  dpip.entities_by_customer;

COMMIT;
