-- A messaging number link used to be taken at face value: whoever typed a
-- number owned it. Links now carry the moment the person proved the number is
-- theirs (a one-time code sent to it). Every existing row is left NULL on
-- purpose — none of them were ever proven, so messaging stops acting on them
-- until their owner verifies, and a real owner can reclaim one somebody else
-- typed in. Other surfaces sharing this table do not read the column.
ALTER TABLE "user_surface_identities" ADD COLUMN "verifiedAt" TIMESTAMP(3);
