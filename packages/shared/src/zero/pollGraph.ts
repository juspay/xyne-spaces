import type { Transaction } from "@rocicorp/zero";
import { buildPollRows, type PollRowsInput } from "../polls/graph.js";
import { zql } from "./builder.js";
import type { Schema } from "./schema.js";

export async function insertPollGraph(
  tx: Transaction<Schema>,
  input: PollRowsInput,
): Promise<void> {
  const rows = buildPollRows(input);
  await tx.mutate.polls.insert(rows.poll);
  for (const question of rows.questions) {
    await tx.mutate.poll_questions.insert(question);
  }
  for (const result of rows.results) {
    await tx.mutate.poll_question_results.insert(result);
  }
}

/** Deletes a poll and its rows explicitly; relationMode="prisma" means no DB cascades. */
export async function deletePollGraph(tx: Transaction<Schema>, pollId: string): Promise<void> {
  const [votes, results, questions] = await Promise.all([
    tx.run(zql.poll_votes.where("pollId", "=", pollId)),
    tx.run(zql.poll_question_results.where("pollId", "=", pollId)),
    tx.run(zql.poll_questions.where("pollId", "=", pollId)),
  ]);
  for (const vote of votes) {
    await tx.mutate.poll_votes.delete({ id: vote.id });
  }
  for (const result of results) {
    await tx.mutate.poll_question_results.delete({ questionId: result.questionId });
  }
  for (const question of questions) {
    await tx.mutate.poll_questions.delete({ id: question.id });
  }
  await tx.mutate.polls.delete({ id: pollId });
}
