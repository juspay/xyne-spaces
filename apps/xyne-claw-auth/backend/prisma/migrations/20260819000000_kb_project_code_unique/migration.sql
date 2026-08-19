-- projectCode is the pipeline's routing key: the GCS findings partition
-- (people-kb/findings/dt=<day>/<CODE>/), the KB path segment
-- (projects/<CODE>/...), and what every by-code lookup in extract/merge/
-- reconcile resolves against. Without this constraint two rows could share a
-- code and each stage would pick one arbitrarily — writing a project's findings
-- into another project's collection.
CREATE UNIQUE INDEX "kb_projects_projectCode_key" ON "kb_projects"("projectCode");
