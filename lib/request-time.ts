/** Read the clock in a request-time server component after `connection()`. */
export function getRequestTime() {
  return Date.now();
}

export function getJohannesburgDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function getJohannesburgDateDaysAgo(days: number) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - days * 86400000));
}
