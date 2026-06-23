/**
 * Sequence Matcher Utility
 * 
 * Used for matching user-provided channel names to actual channel names in the database.
 */

/**
 * Calculate similarity ratio between two strings using Longest Common Subsequence
 * @param a First string
 * @param b Second string
 * @returns Similarity ratio between 0 and 1
 */
export function calculateSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  
  if (aLower === bLower) return 1.0;
  if (aLower.length === 0 || bLower.length === 0) return 0.0;
  
  // Calculate Longest Common Subsequence length
  const lcsLength = longestCommonSubsequence(aLower, bLower);
  
  // Similarity ratio = 2 * LCS / (len(a) + len(b))
  return (2 * lcsLength) / (aLower.length + bLower.length);
}

/**
 * Calculate the length of the Longest Common Subsequence
 */
function longestCommonSubsequence(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  
  // Create a 2D array for dynamic programming
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  return dp[m][n];
}

/**
 * Find best matches for a query string from a list of candidates
 * @param query The query string to match
 * @param candidates List of candidate strings to match against
 * @param threshold Minimum similarity threshold (0-1)
 * @param maxResults Maximum number of results to return
 * @returns Array of matches sorted by similarity (highest first)
 */
export function findBestMatches(
  query: string,
  candidates: string[],
  threshold: number = 0.5,
  maxResults: number = 10
): Array<{ value: string; score: number }> {
  const matches = candidates
    .map(candidate => ({
      value: candidate,
      score: calculateSimilarity(query, candidate),
    }))
    .filter(match => match.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  
  return matches;
}