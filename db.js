const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      creator_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_time TIMESTAMPTZ NOT NULL,
      location TEXT,
      max_attendees INTEGER,
      reminder_sent BOOLEAN DEFAULT FALSE,
      cancelled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvps (
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'going',
      PRIMARY KEY (event_id, user_id)
    )
  `);
  console.log('Database tables ready.');
}

async function createEvent({ guildId, channelId, creatorId, title, description, eventTime, location, maxAttendees }) {
  const res = await pool.query(
    `INSERT INTO events (guild_id, channel_id, creator_id, title, description, event_time, location, max_attendees)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [guildId, channelId, creatorId, title, description, eventTime, location, maxAttendees]
  );
  return res.rows[0].id;
}

async function setEventMessageId(eventId, messageId) {
  await pool.query('UPDATE events SET message_id = $1 WHERE id = $2', [messageId, eventId]);
}

async function getEvent(eventId) {
  const res = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
  return res.rows[0] || null;
}

async function getUpcomingEvents(guildId) {
  const res = await pool.query(
    `SELECT * FROM events WHERE guild_id = $1 AND event_time > NOW() AND cancelled = FALSE ORDER BY event_time ASC`,
    [guildId]
  );
  return res.rows;
}

async function cancelEvent(eventId) {
  await pool.query('UPDATE events SET cancelled = TRUE WHERE id = $1', [eventId]);
}

async function addRsvp(eventId, userId, status) {
  await pool.query(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3`,
    [eventId, userId, status]
  );
}

async function removeRsvp(eventId, userId) {
  await pool.query('DELETE FROM rsvps WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
}

async function getRsvps(eventId) {
  const res = await pool.query('SELECT user_id, status FROM rsvps WHERE event_id = $1', [eventId]);
  return res.rows;
}

async function getRsvpCount(eventId) {
  const res = await pool.query("SELECT COUNT(*) as count FROM rsvps WHERE event_id = $1 AND status = 'going'", [eventId]);
  return parseInt(res.rows[0].count);
}

async function getEventsNeedingReminder(minutesBefore) {
  const res = await pool.query(
    `SELECT * FROM events
     WHERE cancelled = FALSE
     AND reminder_sent = FALSE
     AND event_time > NOW()
     AND event_time <= NOW() + INTERVAL '1 minute' * $1`,
    [minutesBefore]
  );
  return res.rows;
}

async function markReminderSent(eventId) {
  await pool.query('UPDATE events SET reminder_sent = TRUE WHERE id = $1', [eventId]);
}

module.exports = {
  initDb, createEvent, setEventMessageId, getEvent, getUpcomingEvents,
  cancelEvent, addRsvp, removeRsvp, getRsvps, getRsvpCount,
  getEventsNeedingReminder, markReminderSent
};
