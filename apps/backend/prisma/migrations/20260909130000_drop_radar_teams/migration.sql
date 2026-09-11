-- Radar teams move to the browser. A team is one viewer's private shorthand
-- for a set of people used to filter their own feed; it never needed a row
-- everyone's queries had to carry. The server-side lens that justified the
-- table was removed in #1570 and nothing has written here since.
DROP TABLE IF EXISTS "non_zero"."radar_teams";
