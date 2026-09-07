import { DatabaseClient } from '@/database/client';
import { ReleaseChangeType, ReleaseEvent, Prisma, RCA, Impact, COE } from '@prisma/client';
import { FormContextType, FormEntityType, ReleaseEventType } from '@xyne/shared';
import { FormsRepository } from './formsRepository';
import { logger } from '@/utils/logger';
import type { ReleaseEventContext } from '@/services/release/core/types';

const prisma = DatabaseClient.getInstance();
const formsRepository = new FormsRepository();

export type RCAWithRelations = RCA & {
	impacts: Impact[];
	coes: COE[];
	ticketTitle?: string;
};

type FetchRCAOptions = {
	includeImpacts?: boolean;
	includeCOEs?: boolean;
};

export class ReleaseRepository {
	async createReleaseRepositories(rows: Prisma.ReleaseRepositoryCreateManyInput[]): Promise<void> {
		if (rows.length === 0) return;
		await prisma.releaseRepository.createMany({ data: rows, skipDuplicates: true });
	}

	async findReleaseChangeType(changeType: string, applicationId: string): Promise<ReleaseChangeType | null> {
		return await prisma.releaseChangeType.findFirst({
			where: { changeType, applicationId },
		});
	}

	/**
	 * Create a per-instance release change anchor. Each row pairs with a
	 * `form_entity_values` bag (entityId = the returned row's id) that carries
	 * the variable kind-specific fields. Linkage columns let release-detail
	 * reads filter by release / SubTicket / dev ticket / commit / file.
	 */
	async createReleaseChangeInstance(input: {
		applicationId: string;
		changeType: string;
		releaseId?: string | null;
		applicationReleaseId?: string | null;
		devTicketXyneId?: string | null;
		commitId?: string | null;
		filePath?: string | null;
	}): Promise<ReleaseChangeType> {
		// Idempotency: re-runs must not duplicate (release, app, changeType,
		// filePath, commitId). findFirst is the fast path; the partial unique
		// indexes close the concurrent-miss race. commitId in the key keeps
		// different commits' changes for the same file.
		const dedupeWhere =
			input.releaseId && input.filePath
				? {
						releaseId: input.releaseId,
						applicationId: input.applicationId,
						changeType: input.changeType,
						filePath: input.filePath,
						commitId: input.commitId ?? null,
					}
				: null;

		if (dedupeWhere) {
			const existing = await prisma.releaseChangeType.findFirst({ where: dedupeWhere });
			if (existing) {
				logger.info(
					`[ReleaseRepository] Reusing existing ReleaseChangeType ${existing.id} for ${input.changeType} ${input.filePath} on release=${input.releaseId}`,
				);
				return existing;
			}
		}

		// All release changes for an application share its workspace; stamp the
		// denormalized tenant key on insert (matches main's tenant stamping).
		const application = await prisma.application.findUniqueOrThrow({
			where: { id: input.applicationId },
			select: { workspaceId: true },
		});

		try {
			return await prisma.releaseChangeType.create({
				data: {
					applicationId: input.applicationId,
					workspaceId: application.workspaceId,
					changeType: input.changeType,
					releaseId: input.releaseId ?? null,
					applicationReleaseId: input.applicationReleaseId ?? null,
					devTicketXyneId: input.devTicketXyneId ?? null,
					commitId: input.commitId ?? null,
					filePath: input.filePath ?? null,
					createdAt: new Date(),
				},
			});
		} catch (error) {
			// A concurrent re-run won the race: the unique index rejected our insert
			// (P2002). Re-fetch and return the row it created.
			if (
				dedupeWhere &&
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === 'P2002'
			) {
				const existing = await prisma.releaseChangeType.findFirst({ where: dedupeWhere });
				if (existing) {
					logger.info(
						`[ReleaseRepository] Lost dedupe race for ${input.changeType} ${input.filePath} on release=${input.releaseId}; reusing ${existing.id}`,
					);
					return existing;
				}
			}
			throw error;
		}
	}

	async createReleaseEvent(
		input: Omit<Prisma.ReleaseEventCreateInput, 'id' | 'createdAt' | 'workspaceId'>,
		tx?: Prisma.TransactionClient,
	): Promise<ReleaseEvent> {
		const client = tx || prisma;
		const channel = await client.channel.findUniqueOrThrow({
			where: { id: input.channelId },
			select: { workspaceId: true },
		});
		return await client.releaseEvent.create({
			data: {
				releaseId: input.releaseId,
				applicationReleaseId: input.applicationReleaseId,
				workspaceId: channel.workspaceId,
				eventType: input.eventType,
				eventName: input.eventName,
				message: input.message,
				userId: input.userId,
				userName: input.userName,
				channelId: input.channelId,
				conversationId: input.conversationId,
				payload: input.payload,
			},
		});
	}

	/**
	 * Persist a release change's form values + a FORM_SAVED audit event atomically.
	 * Lives here (not on ReleaseService) so CommitAnalysisService can call it without
	 * constructing a ReleaseService — that wiring created a circular dependency.
	 */
	// Release forms are seed data — they only change when re-seeded. The
	// commit-analysis loops call saveReleaseFormValues once per changed file,
	// so cache the form + fields briefly instead of re-querying per file.
	private releaseFormCache = new Map<
		string,
		{ form: { id: string }; formFields: Awaited<ReturnType<typeof formsRepository.findFormFields>>; fetchedAt: number }
	>();

	private async getReleaseFormWithFields(
		formContext: FormContextType,
		formEntity: FormEntityType,
	): Promise<{ form: { id: string }; formFields: Awaited<ReturnType<typeof formsRepository.findFormFields>> } | null> {
		const cacheTtlMs = 60_000;
		const cacheKey = `${formContext}:${formEntity}`;
		const cached = this.releaseFormCache.get(cacheKey);
		if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
			return { form: cached.form, formFields: cached.formFields };
		}

		const form = await formsRepository.findFormByContextAndEntity(formContext, formEntity);
		if (!form) return null;
		const formFields = await formsRepository.findFormFields(form.id);
		this.releaseFormCache.set(cacheKey, { form, formFields, fetchedAt: Date.now() });
		return { form, formFields };
	}

	async saveReleaseFormValues(
		releaseChangeTypeId: string,
		payload: Record<string, unknown> | undefined,
		message: string | undefined,
		formValues: Record<string, unknown>,
		formContext: FormContextType,
		formEntity: FormEntityType,
		releaseContext: ReleaseEventContext,
	): Promise<void> {
		try {
			const formWithFields = await this.getReleaseFormWithFields(formContext, formEntity);
			if (!formWithFields) {
				throw new Error(`[ReleaseRepository] No form found for change type ${formEntity}`);
			}
			const { form, formFields } = formWithFields;

			if (formFields.length === 0) {
				logger.warn(`[ReleaseRepository] No form fields found for form ${form.id}`);
				return;
			}

			// Scope per release via contextId so the unique constraint
			// @@unique([entityId, entityType, fieldId, contextId]) doesn't silently
			// overwrite/fail across releases for the same change type.
			const formValuesRecord = formValues as Record<string, unknown>;
			const formEntityValuesData = formFields
				.filter(field => formValuesRecord[field.fieldName] !== undefined)
				.map(field => ({
					formId: form.id,
					entityId: releaseChangeTypeId,
					entityType: formEntity,
					fieldId: field.id,
					contextId: releaseContext.releaseId,
					fieldValue: '',
					actualFieldValue: formValuesRecord[field.fieldName] as Prisma.InputJsonValue,
				}));

			if (formEntityValuesData.length === 0) return;

			// Atomic: the form values and their FORM_SAVED audit event must commit
			// together. A bare Promise.all lets one write commit while the other
			// fails, leaving form_entity_values and the event out of sync.
			await prisma.$transaction(async tx => {
				await formsRepository.createManyFormEntityValues(formEntityValuesData, tx);
				await this.createReleaseEvent(
					{
						releaseId: releaseContext.releaseId,
						applicationReleaseId: releaseContext.applicationReleaseId ?? null,
						eventType: ReleaseEventType.SYSTEM,
						eventName: 'FORM_SAVED',
						message: message ?? `Saved form values for ${formEntityValuesData.length} fields`,
						userId: releaseContext.userId,
						userName: releaseContext.userName,
						channelId: releaseContext.channelId,
						conversationId: releaseContext.conversationId,
						payload: (payload ?? { formValues }) as Prisma.InputJsonValue,
					},
					tx,
				);
			});

			logger.info(
				`[ReleaseRepository] Saved ${formEntityValuesData.length} form values for release change ID ${releaseChangeTypeId} (${formEntity})`,
			);
		} catch (error) {
			logger.error(`[ReleaseRepository] Error saving form values for release change ID ${releaseChangeTypeId}:`, error);
			throw error;
		}
	}

	async getRCAById(
		rcaId: string,
		options: FetchRCAOptions = {}
	): Promise<RCA | RCAWithRelations | null> {
		const { includeImpacts = false, includeCOEs = false } = options;

		const rca = await prisma.rCA.findUnique({
			where: { id: rcaId },
		});

		if (!rca) {
			return null;
		}

		const ticket = await prisma.ticket.findUnique({
			where: { id: rca.ticketId },
			select: { title: true },
		});

		if (!includeImpacts && !includeCOEs) {
			return { ...rca, ticketTitle: ticket?.title };
		}

		const result: RCAWithRelations = { ...rca, impacts: [], coes: [], ticketTitle: ticket?.title };

		if (includeImpacts) {
			result.impacts = await prisma.impact.findMany({
				where: { rcaId },
			});
		}

		if (includeCOEs) {
			result.coes = await prisma.cOE.findMany({
				where: { rcaId },
			});
		}

		return result;
	}
}