import Fuse from 'fuse.js';

interface Searchable {
  name: string;
  [key: string]: unknown;
}

interface UserLike extends Searchable {
  email: string;
}

export function searchUsers<T extends UserLike>(
  users: T[],
  query: string,
  limit = 10,
): T[] {
  if (!query.trim()) return users.slice(0, limit);

  const q = query.toLowerCase();

  const fuse = new Fuse(users, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'email', weight: 1 },
    ],
    threshold: 0.2,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
  });

  const results = fuse.search(query);

  const rescored = results.map(r => {
    const name = r.item.name.toLowerCase();
    const email = r.item.email.toLowerCase();

    let finalScore = r.score ?? 1;

    if (name.startsWith(q)) {
      finalScore -= 10;
    } else if (name.includes(' ' + q)) {
      finalScore -= 5;
    } else if (email.startsWith(q)) {
      finalScore -= 2;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  return rescored
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, limit)
    .map(r => r.item);
}

export function searchChannels<T extends Searchable>(
  channels: T[],
  query: string,
  limit = 10,
): T[] {
  if (!query.trim()) return channels.slice(0, limit);

  const q = query.toLowerCase();

  const fuse = new Fuse(channels, {
    keys: ['name'],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
  });

  const results = fuse.search(query);

  const rescored = results.map(r => {
    const name = r.item.name.toLowerCase();
    let finalScore = r.score ?? 1;

    if (name.startsWith(q)) {
      finalScore -= 10;
    } else if (name.includes(' ' + q)) {
      finalScore -= 5;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  return rescored
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, limit)
    .map(r => r.item);
}
