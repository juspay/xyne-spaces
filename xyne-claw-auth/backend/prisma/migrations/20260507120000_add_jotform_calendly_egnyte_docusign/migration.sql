-- Add Calendly, DocuSign, Egnyte, and JotForm MCP servers.
-- Each row uses ON CONFLICT (type) DO UPDATE so the migration is idempotent
-- and safe to re-run if the same server already exists with stale fields.

INSERT INTO "mcp_servers" (
  "id", "type", "name", "url", "description", "transport",
  "writeToolPolicy", "healthcheckSpec", "connectorMeta",
  "createdAt", "updatedAt"
)
VALUES
  (
    gen_random_uuid()::text,
    'calendly',
    'Calendly',
    'https://mcp.calendly.com',
    'Calendly scheduling integration via mcp.calendly.com — manage event types, meetings, scheduling links, and organisation invitations, via OAuth 2.1.',
    'http',
    '{"mode":"allowlist","tools":["event_types-create_event_type","event_types-update_event_type","event_types-update_event_type_availability_schedule","meetings-cancel_event","meetings-create_invitee","meetings-create_invitee_no_show","meetings-delete_invitee_no_show","scheduling_links-create_single_use_scheduling_link","shares-create_share","organizations-create_organization_invitation","organizations-revoke_organization_invitation","organizations-delete_organization_membership"]}'::jsonb,
    '{"name":"users-get_current_user","params":{}}'::jsonb,
    '{"scope":"global","mode":"self-serve"}'::jsonb,
    NOW(), NOW()
  ),
  (
    gen_random_uuid()::text,
    'docusign',
    'DocuSign',
    '',
    'DocuSign eSignature integration via mcp.docusign.com — create/update envelopes, trigger and manage Maestro workflows, install data-verification apps, via OAuth 2.0.',
    'http',
    '{"mode":"allowlist","tools":["createEnvelope","updateEnvelope","triggerWorkflow","cancelWorkflowInstance","pauseNewWorkflowInstances","resumeWorkflow","installDVApps"]}'::jsonb,
    '{"name":"getUserInfo","params":{}}'::jsonb,
    '{"scope":"global","mode":"self-serve"}'::jsonb,
    NOW(), NOW()
  ),
  (
    gen_random_uuid()::text,
    'egnyte',
    'Egnyte',
    '',
    'Egnyte content platform integration via mcp-server.egnyte.com — browse filesystem, upload files, set metadata, create comments and links, via OAuth 2.0.',
    'http',
    '{"mode":"allowlist","tools":["create_folder","upload_file","set_file_metadata","create_comment","create_link"]}'::jsonb,
    '{"name":"list_filesystem_by_path","params":{"path":"/"}}'::jsonb,
    '{"scope":"global","mode":"self-serve"}'::jsonb,
    NOW(), NOW()
  ),
  (
    gen_random_uuid()::text,
    'jotform',
    'JotForm',
    'https://mcp.jotform.com',
    'JotForm integration via mcp.jotform.com — list, create and edit forms, create submissions, via OAuth 2.1.',
    'http',
    '{"mode":"allowlist","tools":["create_form","edit_form","create_submission"]}'::jsonb,
    '{"name":"form_list","params":{}}'::jsonb,
    '{"scope":"global","mode":"self-serve"}'::jsonb,
    NOW(), NOW()
  )
ON CONFLICT ("type") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "url"             = EXCLUDED."url",
  "description"     = EXCLUDED."description",
  "transport"       = EXCLUDED."transport",
  "writeToolPolicy" = EXCLUDED."writeToolPolicy",
  "healthcheckSpec" = EXCLUDED."healthcheckSpec",
  "connectorMeta"   = EXCLUDED."connectorMeta",
  "updatedAt"       = NOW();
