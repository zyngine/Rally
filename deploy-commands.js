const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Event scheduling system')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new event')
        .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Date (YYYY-MM-DD)').setRequired(true))
        .addStringOption(opt => opt.setName('time').setDescription('Time (HH:MM) in 24h format').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Event description'))
        .addStringOption(opt => opt.setName('location').setDescription('Event location or link'))
        .addIntegerOption(opt => opt.setName('max-attendees').setDescription('Max number of attendees').setMinValue(1))
        .addNumberOption(opt => opt.setName('utc-offset').setDescription('Your UTC offset (e.g. -5 for EST, -6 for CST, -8 for PST). Default: -5'))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Upload an image for the event'))
        .addStringOption(opt => opt.setName('image-url').setDescription('Or paste an image URL instead'))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List upcoming events')
    )
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Cancel an event')
        .addIntegerOption(opt => opt.setName('id').setDescription('Event ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('View details of an event')
        .addIntegerOption(opt => opt.setName('id').setDescription('Event ID').setRequired(true))
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering global slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Global slash commands registered successfully.');
  } catch (error) {
    console.error(error);
  }
})();
