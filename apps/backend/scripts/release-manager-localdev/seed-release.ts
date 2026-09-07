#!/usr/bin/env npx tsx

/**
 * Release Management Seeding Script
 *
 * Idempotent seeding of system-level data the Release Manager v2 feature
 * relies on:
 *   1. TICKET_TYPE lookup values (Fix / Feature / Hotfix / Release / Support)
 *      → drives the Ticket Type dropdown in CreateTicketModal.
 *   2. Release ticket spec forms per workspace:
 *      - xyne_release_specs_form with branch / deployedCommitId / newCommitId
 *        fields → renders the commit-range form when creating a Release ticket.
 *      - xyne_release_version_specs_form with releaseVersion
 *        field → renders the version form for version-tracked releases.
 *   3. forms_context_mapping rows binding every existing RELEASE board to the
 *      commit or version form selected by its main release board.
 *
 * Boards created AFTER this seeder runs get their mapping inserted automatically
 * by the `saveReleaseBoardConfig` Zero mutator — this seeder is for backfill /
 * fresh-install setup only.
 *
 * Run via:  npx tsx backend/scripts/release-manager/seed-release.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  BaseTicketType,
  LookupType,
  FormFieldType,
  FormContextType,
  FormEntityType,
  BoardType,
  ReleaseTrackingMode,
} from '@xyne/shared';
import { XyneFormSchemaProvider, XyneChangeType } from '../../src/services/release/xyne/xyneReleaseForm';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function seedTicketTypeLookups(): Promise<void> {
  console.log('\n📌 Ensuring TICKET_TYPE lookup values...');
  for (const value of Object.values(BaseTicketType)) {
    await prisma.lookupValue.upsert({
      where: { type_value: { type: LookupType.TICKET_TYPE, value } },
      update: {},
      create: { type: LookupType.TICKET_TYPE, value },
    });
  }
  console.log(`  ✅ ${Object.values(BaseTicketType).length} TICKET_TYPE rows present`);
}

async function ensureBoardTicketForm(input: {
  workspaceId: string;
  seederUserId: string;
  formName: string;
  formDescription: string;
  schema: NonNullable<ReturnType<XyneFormSchemaProvider['getFormSchema']>>;
}): Promise<{ formId: string; created: boolean }> {
  let form = await prisma.form.findFirst({
    where: {
      formName: input.formName,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
      workspaceId: input.workspaceId,
    },
  });

  let created = false;
  if (!form) {
    form = await prisma.form.create({
      data: {
        id: uuidv4(),
        formName: input.formName,
        formDescription: input.formDescription,
        entityType: FormEntityType.TICKET,
        contextType: FormContextType.BOARD,
        workspaceId: input.workspaceId,
        createdBy: input.seederUserId,
        updatedAt: new Date(),
      },
    });
    created = true;
  }

  for (const field of input.schema.fields) {
    await prisma.formFields.upsert({
      where: { formId_fieldName: { formId: form.id, fieldName: field.name } },
      update: {},
      create: {
        id: uuidv4(),
        formId: form.id,
        fieldName: field.name,
        fieldType: field.type as FormFieldType,
        isOptional: !field.required,
        workspaceId: input.workspaceId,
        updatedAt: new Date(),
      },
    });
  }

  return { formId: form.id, created };
}

async function seedReleaseSpecsFormAndMappings(): Promise<void> {
  console.log('\n📝 Ensuring release ticket spec forms + board mappings...');

  const RELEASE_SPEC_FORM_NAME = 'xyne_release_specs_form';
  const RELEASE_VERSION_SPEC_FORM_NAME = 'xyne_release_version_specs_form';
  const schemaProvider = new XyneFormSchemaProvider();
  const specsSchema = schemaProvider.getFormSchema(XyneChangeType.DEPLOYEDMENT_SPECS);
  const versionSpecsSchema = schemaProvider.getFormSchema(XyneChangeType.VERSION_SPECS);
  if (!specsSchema) {
    throw new Error('XyneFormSchemaProvider returned no schema for DEPLOYEDMENT_SPECS');
  }
  if (!versionSpecsSchema) {
    throw new Error('XyneFormSchemaProvider returned no schema for VERSION_SPECS');
  }

  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  let formsCreated = 0;
  let mappingsCreated = 0;

  for (const ws of workspaces) {
    const seederUser = await prisma.user.findFirst({
      where: { workspaceId: ws.id },
      select: { id: true },
    });
    if (!seederUser) {
      console.warn(`  ⚠️  No users in workspace ${ws.id} — skipping release spec form seed`);
      continue;
    }

    const commitForm = await ensureBoardTicketForm({
      workspaceId: ws.id,
      seederUserId: seederUser.id,
      formName: RELEASE_SPEC_FORM_NAME,
      formDescription: 'Form for getting release specs (branch, deployedCommitId, newCommitId)',
      schema: specsSchema,
    });
    if (commitForm.created) formsCreated++;

    const versionForm = await ensureBoardTicketForm({
      workspaceId: ws.id,
      seederUserId: seederUser.id,
      formName: RELEASE_VERSION_SPEC_FORM_NAME,
      formDescription: 'Form for getting release specs (releaseVersion)',
      schema: versionSpecsSchema,
    });
    if (versionForm.created) formsCreated++;

    // Release boards store their mode directly. Ownership lookup is retained
    // only as a safe fallback for legacy application boards.
    const releaseBoards = await prisma.board.findMany({
      where: { boardType: BoardType.RELEASE, workspaceId: ws.id },
      select: {
        id: true,
        releaseTrackingMode: true,
      },
    });
    for (const board of releaseBoards) {
      let effectiveMode = board.releaseTrackingMode;
      if (!effectiveMode) {
        const application = await prisma.application.findFirst({
          where: { boardId: board.id },
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

      const targetFormId =
        effectiveMode === ReleaseTrackingMode.VERSION
          ? versionForm.formId
          : commitForm.formId;

      const result = await prisma.formContextMapping.upsert({
        where: {
          contextId_entityType: {
            contextId: board.id,
            entityType: FormEntityType.TICKET,
          },
        },
        update: {
          formId: targetFormId,
          contextType: FormContextType.BOARD,
        },
        create: {
          id: uuidv4(),
          formId: targetFormId,
          contextId: board.id,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET,
          workspaceId: ws.id,
        },
      });
      // Prisma upsert doesn't tell us whether it created or updated; count
      // create-paths heuristically by checking the mapping's row count delta
      // later if needed. For now, just count every successful upsert.
      void result;
      mappingsCreated++;
    }
  }

  console.log(`  ✅ Release spec forms created: ${formsCreated}`);
  console.log(`  ✅ Release-form per-board mappings ensured: ${mappingsCreated}`);
}

async function seedReleaseChangeForms(): Promise<void> {
  console.log('\n📝 Ensuring xyne_release_env_form + xyne_release_migration_form...');

  const kinds: Array<{
    kind: XyneChangeType.ENV | XyneChangeType.MIGRATION;
    formName: string;
    entityType: FormEntityType;
    description: string;
  }> = [
    {
      kind: XyneChangeType.ENV,
      formName: 'xyne_release_env_form',
      entityType: FormEntityType.RELEASE_ENV_FORM,
      description: 'Form for tracking environment variable changes in releases',
    },
    {
      kind: XyneChangeType.MIGRATION,
      formName: 'xyne_release_migration_form',
      entityType: FormEntityType.RELEASE_MIGRATION_FORM,
      description: 'Form for tracking database migrations in releases',
    },
  ];

  const schemaProvider = new XyneFormSchemaProvider();
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  let formsCreated = 0;

  for (const ws of workspaces) {
    const seederUser = await prisma.user.findFirst({
      where: { workspaceId: ws.id },
      select: { id: true },
    });
    if (!seederUser) {
      console.warn(`  ⚠️  No users in workspace ${ws.id} — skipping env/mig form seed`);
      continue;
    }

    for (const k of kinds) {
      const schema = schemaProvider.getFormSchema(k.kind);
      if (!schema) {
        console.warn(`  ⚠️  No schema for ${k.kind} — skipping`);
        continue;
      }

      // Ensure the form row exists (idempotent). Don't `continue` if it
      // does — we still need to verify the field set is complete, because
      // an earlier failed seeder run may have created the form but never
      // got around to inserting all fields.
      let form = await prisma.form.findFirst({
        where: {
          formName: k.formName,
          contextType: FormContextType.RELEASE_CHANGE,
          entityType: k.entityType,
          workspaceId: ws.id,
        },
      });
      if (!form) {
        form = await prisma.form.create({
          data: {
            id: uuidv4(),
            formName: k.formName,
            formDescription: k.description,
            entityType: k.entityType,
            contextType: FormContextType.RELEASE_CHANGE,
            workspaceId: ws.id,
            createdBy: seederUser.id,
            updatedAt: new Date(),
          },
        });
        formsCreated++;
      }

      for (const field of schema.fields) {
        await prisma.formFields.upsert({
          where: { formId_fieldName: { formId: form.id, fieldName: field.name } },
          update: {},
          create: {
            id: uuidv4(),
            formId: form.id,
            fieldName: field.name,
            fieldType: field.type as FormFieldType,
            isOptional: !field.required,
            workspaceId: ws.id,
            updatedAt: new Date(),
          },
        });
      }
    }
  }

  console.log(`  ✅ Env/migration forms created: ${formsCreated}`);
}

async function main(): Promise<void> {
  console.log('🚀 Starting Release Management seeding...');
  try {
    await seedTicketTypeLookups();
    await seedReleaseSpecsFormAndMappings();
    await seedReleaseChangeForms();
    console.log('\n✅ Release Management seeding completed.');
  } catch (error) {
    console.error('\n❌ Release Management seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Execute when run directly (e.g. `npx tsx scripts/release-manager/seed-release.ts`).
main().catch(error => {
  console.error('Seeding script failed:', error);
  process.exit(1);
});

export { main as seedReleaseManagement };
