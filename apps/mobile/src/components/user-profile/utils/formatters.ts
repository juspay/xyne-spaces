const formatDate = (value: number | null | undefined): string => {
  if (!value) return '';
  return new Date(value)
    .toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    .replace(',', '');
};

const formatRelativeYears = (value: number | null | undefined): string => {
  if (!value) return '';
  const now = Date.now();
  const diffYears = (now - value) / (1000 * 60 * 60 * 24 * 365.25);
  if (diffYears < 1) {
    const months = Math.max(0, Math.round(diffYears * 12));
    if (months <= 0) return '(this month)';
    return `(${months} ${months === 1 ? 'month' : 'months'} ago)`;
  }
  const years = Math.round(diffYears * 10) / 10;
  return `(${years} ${years === 1 ? 'year' : 'years'} ago)`;
};

export { formatDate, formatRelativeYears };
