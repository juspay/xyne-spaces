#!/usr/bin/env npx tsx
/**
 * READ-ONLY diagnostic: checks whether the Release Manager seed data is in
 * place (ticket-type lookups, release-specs forms, env/migration forms) and
 * whether each RELEASE board is bound to the commit specs form via
 * forms_context_mapping. Makes no writes.
 */
import {
  PrismaClient,
  BoardType,
  LookupType,
  FormContextType,
  FormEntityType,
  ReleaseTrackingMode,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1. TICKET_TYPE lookups (drives the ticket-type dropdown)
  const ticketTypes = await prisma.lookupValue.findMany({
    where: { type: LookupType.TICKET_TYPE },
    select: { value: true },
  });
  console.log(`\n📌 TICKET_TYPE lookups: ${ticketTypes.length ? ticketTypes.map(t => t.value).join(', ') : '(none — dropdown will be empty)'}`);

  // 2. release-specs forms per workspace
  const specsForms = await prisma.form.findMany({
    where: {
      formName: { in: ['xyne_release_specs_form', 'xyne_release_version_specs_form'] },
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    },
    select: { id: true, workspaceId: true, formName: true, _count: { select: { fields: true } } },
    orderBy: [{ workspaceId: 'asc' }, { formName: 'asc' }],
  });
  console.log(`\n📝 release spec form rows: ${specsForms.length}`);
  for (const f of specsForms) {
    console.log(`   - ${f.formName}  form=${f.id}  ws=${f.workspaceId}  fields=${f._count.fields}`);
  }
  const specsFormByWorkspaceAndMode = new Map(
    specsForms.map(form => [
      `${form.workspaceId}:${
        form.formName === 'xyne_release_version_specs_form'
          ? ReleaseTrackingMode.VERSION
          : ReleaseTrackingMode.COMMIT_RANGE
      }`,
      form.id,
    ]),
  );

  // 3. env / migration change forms
  for (const name of ['xyne_release_env_form', 'xyne_release_migration_form']) {
    const n = await prisma.form.count({ where: { formName: name } });
    console.log(`   - ${name}: ${n} row(s)`);
  }

  // 4. RELEASE boards + the form selected by their effective tracking mode.
  const boards = await prisma.board.findMany({
    where: { boardType: BoardType.RELEASE },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      releaseTrackingMode: true,
    },
    orderBy: { name: 'asc' },
  });
  console.log(`\n🗂️  RELEASE boards: ${boards.length}`);
  for (const b of boards) {
    let effectiveMode = b.releaseTrackingMode;
    if (!effectiveMode) {
      const application = await prisma.application.findFirst({
        where: { boardId: b.id },
        select: { mainReleaseBoardId: true },
      });
      if (application?.mainReleaseBoardId) {
        const mainBoard = await prisma.board.findUnique({
          where: { id: application.mainReleaseBoardId },
          select: { releaseTrackingMode: true },
        });
        effectiveMode = mainBoard?.releaseTrackingMode ?? null;
      }
    }
    effectiveMode ??= ReleaseTrackingMode.COMMIT_RANGE;

    const specsFormId = specsFormByWorkspaceAndMode.get(`${b.workspaceId}:${effectiveMode}`);
    let mapped = false;
    if (specsFormId) {
      const m = await prisma.formContextMapping.count({
        where: {
          contextId: b.id,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET,
          formId: specsFormId,
        },
      });
      mapped = m > 0;
    }
    const verdict = !specsFormId
      ? `❌ no ${effectiveMode} specs form in this workspace`
      : mapped
        ? `✅ bound to ${effectiveMode} specs form`
        : `❌ NOT bound to ${effectiveMode} specs form`;
    console.log(`   - ${b.name}  (ws=${b.workspaceId})  →  ${verdict}`);
  }

  console.log('\nDone (read-only).');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
