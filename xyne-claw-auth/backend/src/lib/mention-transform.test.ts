import { describe, expect, it } from "vitest";
import {
  expandSpacesMentions,
  resolveUnboundMentions,
  type MentionLookups,
} from "./mention-transform.js";

const USERS: Record<string, { id: string; name: string; email: string }> = {
  "bowmitha.c": {
    id: "usr_bowmitha00000000",
    name: "Bowmitha C",
    email: "john.doe@gmail.com",
  },
  "utkarsh.kumar": {
    id: "usr_utkarsh000000000",
    name: "Utkarsh Kumar",
    email: "john.doe@gmail.com",
  },
  "deepak.kushwaha": {
    id: "usr_deepak0000000000",
    name: "Deepak Kushwaha",
    email: "john.doe@gmail.com",
  },
};

const GROUPS: Record<string, { id: string; name: string; alias: string }> = {
  "data-intelligence": {
    id: "grp_dataintel000000",
    name: "Data Intelligence",
    alias: "data-intelligence",
  },
  "risk-platform": {
    id: "grp_riskplatform000",
    name: "Risk Platform",
    alias: "risk-platform",
  },
};

function lookups(): MentionLookups {
  return {
    byName: async (name) => {
      const hits = Object.values(USERS).filter((u) => u.name.startsWith(name));
      return hits.map((u) => ({ id: u.id, name: u.name }));
    },
    byEmail: async (email) => {
      const hits = Object.values(USERS).filter(
        (u) => u.email === email.toLowerCase(),
      );
      return hits.map((u) => ({ id: u.id, name: u.name }));
    },
    byHandle: async (handle) => {
      const hits = Object.values(USERS).filter((u) =>
        u.email.startsWith(`${handle.toLowerCase()}@`),
      );
      return hits.map((u) => ({ id: u.id, name: u.name }));
    },
    byGroupAlias: async (alias) => {
      const hits = Object.values(GROUPS).filter(
        (g) => g.alias === alias.toLowerCase(),
      );
      return hits.map((g) => ({ id: g.id, name: g.name, alias: g.alias }));
    },
  };
}

describe("resolveUnboundMentions — dotted handles", () => {
  it("resolves Bitbucket-style handles to bracketed mentions", async () => {
    const out = await resolveUnboundMentions(
      "Hey @bowmitha.c @utkarsh.kumar — PR #9220 is waiting for your review.",
      lookups(),
    );
    expect(out).toBe(
      `Hey @Bowmitha C[${USERS["bowmitha.c"]!.id}] @Utkarsh Kumar[${USERS["utkarsh.kumar"]!.id}] — PR #9220 is waiting for your review.`,
    );
  });

  it("leaves unknown handles untouched", async () => {
    const out = await resolveUnboundMentions(
      "Blocked by: @euler.bot (needs changes)",
      lookups(),
    );
    expect(out).toBe("Blocked by: @euler.bot (needs changes)");
  });

  it("does not partial-match a capitalised handle via the name pattern", async () => {
    // Without the name-pattern guard, `@Deepak.Kushwaha` would match `@Deepak`
    // by name and mangle the handle. The handle path must win.
    const out = await resolveUnboundMentions("cc @Deepak.Kushwaha", lookups());
    expect(out).toBe(`cc @Deepak Kushwaha[${USERS["deepak.kushwaha"]!.id}]`);
  });

  it("treats a full email as an email, not a handle", async () => {
    const out = await resolveUnboundMentions(
      "ping @john.doe@gmail.com please",
      lookups(),
    );
    expect(out).toBe(`ping @Bowmitha C[${USERS["bowmitha.c"]!.id}] please`);
  });

  it("does not partial-match unresolved full emails as handles", async () => {
    let handleLookups = 0;
    const lk: MentionLookups = {
      ...lookups(),
      byEmail: async () => [],
      byHandle: async () => {
        handleLookups += 1;
        return [{ id: "usr_wrong0000000000", name: "Wrong User" }];
      },
    };
    const input = "ping @john.doe@gmail.com please";
    expect(await resolveUnboundMentions(input, lk)).toBe(input);
    expect(handleLookups).toBe(0);
  });

  it("skips handles when byHandle lookup is not provided", async () => {
    const { byHandle: _omit, ...rest } = lookups();
    const out = await resolveUnboundMentions("Hey @bowmitha.c", rest);
    expect(out).toBe("Hey @bowmitha.c");
  });

  it("skips code fences", async () => {
    const input = "```\n@bowmitha.c\n```";
    expect(await resolveUnboundMentions(input, lookups())).toBe(input);
  });
});

describe("expandSpacesMentions — bracketed form to HTML span", () => {
  it("expands a resolved handle end-to-end into a notifying span", async () => {
    const resolved = await resolveUnboundMentions(
      "Hey @bowmitha.c!",
      lookups(),
    );
    const html = expandSpacesMentions(resolved);
    expect(html).toBe(
      `Hey <span data-mention="" data-mention-type="user" data-user-id="${USERS["bowmitha.c"]!.id}" data-username="Bowmitha C" class="chat-input-mention">@Bowmitha C</span>!`,
    );
  });

  it("is idempotent on already-expanded output", async () => {
    const html = expandSpacesMentions(
      await resolveUnboundMentions("Hey @bowmitha.c!", lookups()),
    );
    expect(expandSpacesMentions(html)).toBe(html);
  });
});

describe("resolveUnboundMentions — group aliases", () => {
  it("resolves plain group aliases to bracketed group mentions", async () => {
    const out = await resolveUnboundMentions(
      "Looping in @data-intelligence",
      lookups(),
    );
    expect(out).toBe(
      `Looping in @data-intelligence[group:${GROUPS["data-intelligence"]!.id}:Data Intelligence]`,
    );
  });

  it("expands a resolved group alias end-to-end into a notifying span", async () => {
    const resolved = await resolveUnboundMentions(
      "Looping in @data-intelligence",
      lookups(),
    );
    const html = expandSpacesMentions(resolved);
    expect(html).toBe(
      `Looping in <span data-mention="" data-mention-type="group" data-group-id="${GROUPS["data-intelligence"]!.id}" data-group-name="Data Intelligence" data-group-alias="data-intelligence" class="chat-input-mention">@data-intelligence</span>`,
    );
  });

  it("leaves unknown group aliases untouched", async () => {
    const out = await resolveUnboundMentions(
      "Looping in @unknown-group",
      lookups(),
    );
    expect(out).toBe("Looping in @unknown-group");
  });

  it("leaves ambiguous group aliases untouched", async () => {
    const ambiguousLookups: MentionLookups = {
      ...lookups(),
      byGroupAlias: async () => [
        {
          id: "grp_one0000000000",
          name: "Data Intelligence",
          alias: "data-intelligence",
        },
        {
          id: "grp_two0000000000",
          name: "Data Intelligence 2",
          alias: "data-intelligence",
        },
      ],
    };
    const out = await resolveUnboundMentions(
      "Looping in @data-intelligence",
      ambiguousLookups,
    );
    expect(out).toBe("Looping in @data-intelligence");
  });

  it("skips group aliases when byGroupAlias lookup is not provided", async () => {
    const { byGroupAlias: _omit, ...rest } = lookups();
    const out = await resolveUnboundMentions(
      "Looping in @data-intelligence",
      rest,
    );
    expect(out).toBe("Looping in @data-intelligence");
  });

  it("does not rewrite group aliases inside code fences", async () => {
    const input = "```\n@data-intelligence\n```";
    expect(await resolveUnboundMentions(input, lookups())).toBe(input);
  });
});

describe("resolveUnboundMentions — email workspace-scoping (prod bug: @email never resolved)", () => {
  // Prod repro: the same person is imported into TWO workspaces (two users rows,
  // same email) → an UNSCOPED byEmail returns 2 hits → the resolver must leave
  // the @email raw (never guess which account). The fix scopes byEmail to the
  // agent's workspace so it returns exactly one → the mention tags cleanly.
  const EMAIL = "@john.doe@gmail.com";

  it("leaves an @email untagged when byEmail is unscoped and returns 2 users (ambiguous)", async () => {
    const twoWorkspaceHits = [
      { id: "usr_prod00000000000", name: "Radheyshree Agrawal" },
      { id: "usr_stag00000000000", name: "Radheyshree Agrawal" },
    ];
    const lk: MentionLookups = { ...lookups(), byEmail: async () => twoWorkspaceHits };
    const out = await resolveUnboundMentions(`Looping in ${EMAIL} — review`, lk);
    expect(out).toBe(`Looping in ${EMAIL} — review`);
  });

  it("tags an @email when the workspace-scoped byEmail returns exactly 1 user", async () => {
    const one = [{ id: "usr_radheyshree0000", name: "Radheyshree Agrawal" }];
    const lk: MentionLookups = { ...lookups(), byEmail: async () => one };
    const out = await resolveUnboundMentions(`Looping in ${EMAIL} — review`, lk);
    expect(out).toBe("Looping in @Radheyshree Agrawal[usr_radheyshree0000] — review");
  });
});
