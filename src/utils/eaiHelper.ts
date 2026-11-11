import { EaiResponse } from '../types/orderBroadcast';

/**
 * Safely parse EAI response data.
 * MuleSoft EAI occasionally returns SOAP XML Faults (HTTP 200 with XML body)
 * or non-JSON strings when an endpoint/URLEntry is missing.
 */
export function parseEaiResponse(data: any): EaiResponse {
  if (!data) {
    return { status: 'E', message: 'Empty response received from EAI' };
  }

  // If already an object
  if (typeof data === 'object') {
    if (typeof data.status === 'string' && data.message !== undefined) {
      return {
        status: data.status,
        message: typeof data.message === 'string' ? data.message : JSON.stringify(data.message),
      };
    }
  }

  // If string (e.g. XML SOAP Fault or unparsed JSON)
  if (typeof data === 'string') {
    const trimmed = data.trim();

    // Try parsing as JSON first
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return {
            status: parsed.status || 'E',
            message: parsed.message || JSON.stringify(parsed),
          };
        }
      } catch {
        // Fall through
      }
    }

    // Extract SOAP faultstring if present
    const faultMatch = trimmed.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
    if (faultMatch) {
      return {
        status: 'E',
        message: faultMatch[1].trim(),
      };
    }

    // Strip generic HTML / XML tags
    const cleanStr = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      status: 'E',
      message: cleanStr.slice(0, 300) || 'Non-JSON response from EAI',
    };
  }

  return {
    status: (data && data.status) || 'E',
    message: (data && data.message) || String(data).slice(0, 300),
  };
}

/**
 * Extract clean error message from Axios error or network exception
 */
export function extractEaiErrorMessage(err: any): string {
  if (!err) return 'Unknown error';

  if (err.response && err.response.data) {
    const parsed = parseEaiResponse(err.response.data);
    if (parsed.message) {
      return parsed.message;
    }
  }

  return err.message || 'Unknown network error';
}
