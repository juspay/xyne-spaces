/** Local calendar day. Date pills and grouping share this so UTC midnight is not a false break. */
export const dayKey = (createdAt: number): string => {
  const date = new Date(createdAt);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
