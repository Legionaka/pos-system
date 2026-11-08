/** Read the clock in a request-time server component after `connection()`. */
export function getRequestTime() {
  return Date.now();
}
