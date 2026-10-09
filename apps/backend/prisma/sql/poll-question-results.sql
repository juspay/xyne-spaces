-- Prisma db push cannot create PostgreSQL triggers. This file is run after every
-- local db push and is deliberately idempotent so a developer can restart safely.
CREATE OR REPLACE FUNCTION "public"."refresh_poll_question_result"()
RETURNS TRIGGER AS $$
DECLARE
    affected_question_id TEXT;
BEGIN
    affected_question_id := COALESCE(NEW."questionId", OLD."questionId");
    PERFORM pg_advisory_xact_lock(hashtextextended(affected_question_id, 0));

    INSERT INTO "public"."poll_question_results" (
        "questionId", "workspaceId", "pollId", "voterCount", "optionCounts",
        "responseCount", "rankTotals", "rankResponseCount", "ratingCounts",
        "ratingTotal", "updatedAt"
    )
    SELECT
        question."id", question."workspaceId", question."pollId",
        (SELECT COUNT(*)::INTEGER FROM "public"."poll_votes" AS ballot
          WHERE ballot."questionId" = question."id"),
        COALESCE((
            SELECT jsonb_object_agg(option_vote."optionId", option_vote."voteCount")
              FROM (
                  SELECT selected."optionId", COUNT(*)::INTEGER AS "voteCount"
                    FROM "public"."poll_votes" AS ballot
                    CROSS JOIN LATERAL jsonb_array_elements_text(ballot."optionIds") AS selected("optionId")
                   WHERE ballot."questionId" = question."id"
                   GROUP BY selected."optionId"
              ) AS option_vote
        ), '{}'::jsonb),
        (SELECT COUNT(*)::INTEGER FROM "public"."poll_votes" AS response
          WHERE response."questionId" = question."id"),
        COALESCE((
            SELECT jsonb_object_agg(ranked."optionId", ranked."rankTotal")
              FROM (
                  SELECT ranking."optionId", SUM(ranking.ordinality)::INTEGER AS "rankTotal"
                    FROM "public"."poll_votes" AS ballot
                    CROSS JOIN LATERAL jsonb_array_elements_text(ballot."rankedOptionIds")
                      WITH ORDINALITY AS ranking("optionId", ordinality)
                   WHERE ballot."questionId" = question."id"
                     AND ballot."rankedOptionIds" IS NOT NULL
                   GROUP BY ranking."optionId"
              ) AS ranked
        ), '{}'::jsonb),
        (SELECT COUNT(*)::INTEGER FROM "public"."poll_votes" AS response
          WHERE response."questionId" = question."id"
            AND response."rankedOptionIds" IS NOT NULL),
        COALESCE((
            SELECT jsonb_object_agg(rated."rating", rated."ratingCount")
              FROM (
                  SELECT response."rating", COUNT(*)::INTEGER AS "ratingCount"
                    FROM "public"."poll_votes" AS response
                   WHERE response."questionId" = question."id"
                     AND response."rating" IS NOT NULL
                   GROUP BY response."rating"
              ) AS rated
        ), '{}'::jsonb),
        COALESCE((SELECT SUM(response."rating")::INTEGER FROM "public"."poll_votes" AS response
          WHERE response."questionId" = question."id"), 0),
        CURRENT_TIMESTAMP
      FROM "public"."poll_questions" AS question
     WHERE question."id" = affected_question_id
    ON CONFLICT ("questionId") DO UPDATE SET
        "voterCount" = EXCLUDED."voterCount",
        "optionCounts" = EXCLUDED."optionCounts",
        "responseCount" = EXCLUDED."responseCount",
        "rankTotals" = EXCLUDED."rankTotals",
        "rankResponseCount" = EXCLUDED."rankResponseCount",
        "ratingCounts" = EXCLUDED."ratingCounts",
        "ratingTotal" = EXCLUDED."ratingTotal",
        "updatedAt" = EXCLUDED."updatedAt";

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "poll_votes_refresh_question_result" ON "public"."poll_votes";
CREATE TRIGGER "poll_votes_refresh_question_result"
AFTER INSERT OR UPDATE OR DELETE ON "public"."poll_votes"
FOR EACH ROW EXECUTE FUNCTION "public"."refresh_poll_question_result"();
