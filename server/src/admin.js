const config = require('./config');

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

const ADMIN_EMAILS = parseList(process.env.ADMIN_EMAILS);
const ADMIN_IDS = parseList(process.env.ADMIN_USER_IDS);

function isAdmin(user) {
  if (!user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  const id = String(user.id || '').trim().toLowerCase();
  return ADMIN_EMAILS.includes(email) || ADMIN_IDS.includes(id);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { isAdmin, requireAdmin };
