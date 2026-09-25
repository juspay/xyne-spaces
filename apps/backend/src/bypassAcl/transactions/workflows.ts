import { transaction } from '../base';
import { TicketRepository, WorkflowRepository } from '@/database/repositories/workflows';


export function deleteTx(self: TicketRepository, id: string) {
  return transaction(['EmailRead', 'Ticket'], 'delete: ticket delete with email-read cleanup must commit atomically; tx is not ACL-wrapped', self.db, async tx => {
    await tx.emailRead.deleteMany({ where: { ticketId: id } });
    return tx.ticket.delete({ where: { id } });
  });
}
export function approveProposalTx(self: WorkflowRepository, proposalId: string) {
  return transaction(['Workflow'], 'approveProposal: proposal disable plus sibling auto-revoke must commit atomically; tx is not ACL-wrapped', self.db, async tx => {
    const proposal = await tx.workflow.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.workflowType !== 'Automations') {
      throw new Error(`Cannot approve proposal ${proposalId}: not an automation row.`);
    }
    const rootId = proposal.automationSeriesId ?? proposal.id;

    const approved =
      proposal.status === 'DISABLED'
        ? proposal
        : await tx.workflow.update({
            where: { id: proposal.id },
            data: { status: 'DISABLED' },
          });

    const siblings = await tx.workflow.findMany({
      where: {
        workflowType: 'Automations',
        automationSeriesId: rootId,
        status: 'PENDING_APPROVAL',
        id: { not: proposal.id },
      },
    });
    const autoRevoked = await Promise.all(
      siblings.map(s =>
        tx.workflow.update({
          where: { id: s.id },
          data: { status: 'AUTO_REVOKED' },
        }),
      ),
    );

    return { approved, autoRevoked };
  });
}
