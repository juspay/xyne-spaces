-- Channel ↔ Project decoupling (phase 2): channels.projectId becomes nullable.
-- Channels may now exist without a project; board membership lives in
-- channel_board_mappings. The FK to projects is retained (NULL is allowed).
ALTER TABLE "channels" ALTER COLUMN "projectId" DROP NOT NULL;
