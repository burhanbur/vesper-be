export function sanitizeCurrencyString(val: unknown): unknown {
  if (typeof val === 'number') return val.toString();
  if (typeof val !== 'string') return val;
  let str = val.trim();
  if (!str) return str;

  const isNegative =
    str.startsWith('-') ||
    /-\s*(?:rp\.?|idr)/i.test(str) ||
    /(?:rp\.?|idr)\s*-\s*/i.test(str);

  str = str.replace(/^[-+]\s*/, '').trim();
  str = str.replace(/^(?:rp\.?|idr)\s*/i, '').trim();
  str = str.replace(/^[-+]\s*/, '').trim();
  str = str.replace(/,-\s*$/, '').trim();

  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(str)) {
    str = str.replace(/,/g, '');
  } else if (/^\d+,\d+$/.test(str)) {
    str = str.replace(',', '.');
  }

  return isNegative ? `-${str}` : str;
}

export function sanitizeGoalMoneyString(val: unknown): unknown {
  const sanitized = sanitizeCurrencyString(val);
  if (typeof sanitized !== 'string' || !sanitized) return sanitized;
  if (/^-?(?:0|[1-9]\d{0,17})$/.test(sanitized)) {
    return `${sanitized}.00`;
  }
  if (/^-?(?:0|[1-9]\d{0,17})\.\d$/.test(sanitized)) {
    return `${sanitized}0`;
  }
  return sanitized;
}
