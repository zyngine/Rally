const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function buildEventEmbed(event, rsvps) {
  const going = rsvps.filter(r => r.status === 'going');
  const interested = rsvps.filter(r => r.status === 'interested');

  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setColor(event.cancelled ? 0x95A5A6 : 0x3498DB)
    .setTimestamp(new Date(event.event_time));

  if (event.description) embed.setDescription(event.description);

  const timeUnix = Math.floor(new Date(event.event_time).getTime() / 1000);
  embed.addFields({ name: 'When', value: `<t:${timeUnix}:F> (<t:${timeUnix}:R>)`, inline: true });

  if (event.location) embed.addFields({ name: 'Where', value: event.location, inline: true });

  const spotsText = event.max_attendees ? `${going.length}/${event.max_attendees}` : `${going.length}`;
  embed.addFields({ name: 'Going', value: spotsText, inline: true });

  if (interested.length > 0) {
    embed.addFields({ name: 'Interested', value: `${interested.length}`, inline: true });
  }

  if (going.length > 0) {
    const goingList = going.map(r => `<@${r.user_id}>`).join(', ');
    embed.addFields({ name: 'Attendees', value: goingList.length > 1024 ? goingList.slice(0, 1020) + '...' : goingList });
  }

  if (event.cancelled) {
    embed.setTitle(`~~${event.title}~~ (Cancelled)`);
    embed.setColor(0x95A5A6);
  }

  embed.setFooter({ text: `Event #${event.id}` });

  return embed;
}

function buildEventButtons(eventId, cancelled) {
  if (cancelled) return [];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rsvp_going_${eventId}`)
      .setLabel('Going')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rsvp_interested_${eventId}`)
      .setLabel('Interested')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rsvp_cancel_${eventId}`)
      .setLabel('Not Going')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

// --- Reminder loop ---
async function checkReminders() {
  try {
    const events = await db.getEventsNeedingReminder(15);
    for (const event of events) {
      const rsvps = await db.getRsvps(event.id);
      const going = rsvps.filter(r => r.status === 'going' || r.status === 'interested');

      for (const rsvp of going) {
        const user = await client.users.fetch(rsvp.user_id).catch(() => null);
        if (user) {
          const timeUnix = Math.floor(new Date(event.event_time).getTime() / 1000);
          await user.send(`**Reminder:** **${event.title}** is starting <t:${timeUnix}:R>!${event.location ? `\nLocation: ${event.location}` : ''}`).catch(() => {});
        }
      }

      await db.markReminderSent(event.id);
    }
  } catch (err) {
    console.error('Reminder check error:', err);
  }
}

client.once('ready', async () => {
  await db.initDb();
  console.log(`Rally is online as ${client.user.tag}`);

  // Check for reminders every 60 seconds
  setInterval(checkReminders, 60_000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;

  const guildId = interaction.guild.id;

  try {
    // ---------- Slash Commands ----------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName !== 'event') return;

      const sub = interaction.options.getSubcommand();

      // --- /event create ---
      if (sub === 'create') {
        const title = interaction.options.getString('title');
        const dateStr = interaction.options.getString('date');
        const timeStr = interaction.options.getString('time');
        const description = interaction.options.getString('description');
        const location = interaction.options.getString('location');
        const maxAttendees = interaction.options.getInteger('max-attendees');

        // Parse date parts manually for reliability
        const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);

        if (!dateMatch || !timeMatch) {
          return interaction.reply({ content: 'Invalid format. Use `YYYY-MM-DD` for date and `HH:MM` for time.', ephemeral: true });
        }

        const [, year, month, day] = dateMatch;
        const [, hour, minute] = timeMatch;
        const eventTime = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));

        if (isNaN(eventTime.getTime())) {
          return interaction.reply({ content: 'Invalid date/time. Use `YYYY-MM-DD` for date and `HH:MM` for time.', ephemeral: true });
        }

        if (eventTime <= new Date()) {
          return interaction.reply({ content: 'Event time must be in the future.', ephemeral: true });
        }

        const eventId = await db.createEvent({
          guildId,
          channelId: interaction.channel.id,
          creatorId: interaction.user.id,
          title,
          description,
          eventTime,
          location,
          maxAttendees
        });

        const event = await db.getEvent(eventId);
        const embed = buildEventEmbed(event, []);
        const buttons = buildEventButtons(eventId, false);

        const reply = await interaction.reply({ embeds: [embed], components: buttons, fetchReply: true });
        await db.setEventMessageId(eventId, reply.id);
      }

      // --- /event list ---
      if (sub === 'list') {
        const events = await db.getUpcomingEvents(guildId);

        if (events.length === 0) {
          return interaction.reply({ content: 'No upcoming events.', ephemeral: true });
        }

        const list = events.map(e => {
          const timeUnix = Math.floor(new Date(e.event_time).getTime() / 1000);
          return `**#${e.id} — ${e.title}**\n<t:${timeUnix}:F> (<t:${timeUnix}:R>)${e.location ? `\nLocation: ${e.location}` : ''}`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
          .setTitle('Upcoming Events')
          .setColor(0x3498DB)
          .setDescription(list.length > 4096 ? list.slice(0, 4092) + '...' : list);

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // --- /event cancel ---
      if (sub === 'cancel') {
        const eventId = interaction.options.getInteger('id');
        const event = await db.getEvent(eventId);

        if (!event || event.guild_id !== guildId) {
          return interaction.reply({ content: 'Event not found.', ephemeral: true });
        }

        const isCreator = event.creator_id === interaction.user.id;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageEvents);

        if (!isCreator && !isAdmin) {
          return interaction.reply({ content: 'Only the event creator or someone with **Manage Events** permission can cancel.', ephemeral: true });
        }

        if (event.cancelled) {
          return interaction.reply({ content: 'This event is already cancelled.', ephemeral: true });
        }

        await db.cancelEvent(eventId);

        // Notify attendees
        const rsvps = await db.getRsvps(eventId);
        for (const rsvp of rsvps) {
          const user = await client.users.fetch(rsvp.user_id).catch(() => null);
          if (user) {
            await user.send(`**${event.title}** has been **cancelled**.`).catch(() => {});
          }
        }

        // Update the original message if possible
        if (event.message_id) {
          const channel = interaction.guild.channels.cache.get(event.channel_id);
          if (channel) {
            const msg = await channel.messages.fetch(event.message_id).catch(() => null);
            if (msg) {
              const updatedEvent = await db.getEvent(eventId);
              const embed = buildEventEmbed(updatedEvent, rsvps);
              await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
            }
          }
        }

        return interaction.reply({ content: `**${event.title}** has been cancelled. Attendees have been notified.`, ephemeral: true });
      }

      // --- /event info ---
      if (sub === 'info') {
        const eventId = interaction.options.getInteger('id');
        const event = await db.getEvent(eventId);

        if (!event || event.guild_id !== guildId) {
          return interaction.reply({ content: 'Event not found.', ephemeral: true });
        }

        const rsvps = await db.getRsvps(eventId);
        const embed = buildEventEmbed(event, rsvps);

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    // ---------- Button Interactions (RSVP) ----------
    if (interaction.isButton()) {
      const parts = interaction.customId.split('_');
      if (parts[0] !== 'rsvp') return;

      const action = parts[1];
      const eventId = parseInt(parts[2]);

      const event = await db.getEvent(eventId);
      if (!event || event.cancelled) {
        return interaction.reply({ content: 'This event is no longer active.', ephemeral: true });
      }

      if (action === 'cancel') {
        await db.removeRsvp(eventId, interaction.user.id);
        await interaction.reply({ content: `You've removed your RSVP for **${event.title}**.`, ephemeral: true });
      } else {
        // Check max attendees for "going"
        if (action === 'going' && event.max_attendees) {
          const count = await db.getRsvpCount(eventId);
          const rsvps = await db.getRsvps(eventId);
          const existing = rsvps.find(r => r.user_id === interaction.user.id);
          const alreadyGoing = existing && existing.status === 'going';

          if (!alreadyGoing && count >= event.max_attendees) {
            return interaction.reply({ content: `**${event.title}** is full (${event.max_attendees} spots).`, ephemeral: true });
          }
        }

        await db.addRsvp(eventId, interaction.user.id, action);
        const label = action === 'going' ? 'going to' : 'interested in';
        await interaction.reply({ content: `You're ${label} **${event.title}**!`, ephemeral: true });
      }

      // Update the event embed
      const rsvps = await db.getRsvps(eventId);
      const embed = buildEventEmbed(event, rsvps);
      await interaction.message.edit({ embeds: [embed], components: buildEventButtons(eventId, event.cancelled) }).catch(() => {});
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
