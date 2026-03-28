function requireFields(body, fields) {
  const missing = fields.filter(f => !body[f] && body[f] !== 0 && body[f] !== false);
  if (missing.length) return `Обязательные поля: ${missing.join(', ')}`;
  return null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

module.exports = { requireFields, isValidEmail, isUUID };
