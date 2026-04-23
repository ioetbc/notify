export function formatRelativeTime(date: Date | null): string {
  if (!date) {
    return '-';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Less than 7 days ago
  if (diffDays < 7) {
    if (diffDays === 0) {
      return 'Today';
    }
    if (diffDays === 1) {
      return '1 day ago';
    }
    return `${diffDays} days ago`;
  }

  // 7-13 days ago
  if (diffDays < 14) {
    return '1 week';
  }

  // 14-20 days ago
  if (diffDays < 21) {
    return '2 weeks';
  }

  // 21-27 days ago
  if (diffDays < 28) {
    return '3 weeks';
  }

  // 28+ days, check year
  const currentYear = now.getFullYear();
  const dateYear = date.getFullYear();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const month = monthNames[date.getMonth()];
  const day = date.getDate();

  if (dateYear === currentYear) {
    return `${month} ${day}`;
  }

  return `${month} ${day}, ${dateYear}`;
}
