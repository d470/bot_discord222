// ================== SETUP ==================
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

require("dotenv").config();
const config = require("./config.json");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const TOKEN = process.env.DISCORD_TOKEN;

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const prefix = "&";
const invites = new Map();
const userMessages = new Map();
let db;

// ================== DATABASE ==================
(async () => {
  try {
    db = await open({
      filename: "./leveling.db",
      driver: sqlite3.Database,
    });

    await db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        level INTEGER DEFAULT 1,
        xp INTEGER DEFAULT 0
      )
    `);

    console.log("🗄️ Database ready!");
  } catch (err) {
    console.error("Database error:", err);
  }
})();

// ================== ANTI SPAM / FILTER ==================
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const member = message.member;
  if (!member) return;

  if (
    config.bypassRoleIds &&
    member.roles.cache.some((r) => config.bypassRoleIds.includes(r.id))
  )
    return;

  const content = message.content.toLowerCase();
  const now = Date.now();

  async function punishUser(reason, durationMs = 5000) {
    try {
      if (member.moderatable) {
        await member.timeout(durationMs, reason);
      }

      const embed = new EmbedBuilder()
        .setTitle("⚠️ تم إعطاؤك تايم أوت")
        .setColor("Red")
        .addFields(
          { name: "السبب", value: reason },
          { name: "المدة", value: `${durationMs / 1000} ثانية` },
          { name: "الرسالة", value: message.content || "—" }
        )
        .setTimestamp();

      await member.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error("Punish error:", err);
    }
  }

  // كلمات سيئة
  if (config.badWords?.some((w) => content.includes(w))) {
    await punishUser("كلمات مسيئة");
    return;
  }

  // everyone
  if (message.mentions.everyone) {
    await punishUser("منشن everyone");
    return;
  }

  // روابط
  if (/https?:\/\/|discord\.gg|www\.|\.com|\.net|\.org|\.io|\.gg/i.test(content)) {
    await punishUser("نشر روابط");
    return;
  }

  // إيموجي سبام
  const emojiCount =
    (content.match(/<a?:\w+:\d+>|[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;

  if (emojiCount >= (config.emojiSpamLimit || 10)) {
    await punishUser("إيموجي سبام");
    return;
  }

  // سبام رسائل
  const timestamps = userMessages.get(member.id) || [];
  const filtered = timestamps.filter(
    (t) => now - t < (config.timeWindow || 5000)
  );
  filtered.push(now);
  userMessages.set(member.id, filtered);

  if (filtered.length >= (config.spamLimit || 5)) {
    await punishUser("سبام رسائل");
  }
});

// ================== READY ==================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "online", type: 0 }],
    status: "online",
  });

  // Load invites
  client.guilds.cache.forEach(async (guild) => {
    try {
      const invs = await guild.invites.fetch();
      invites.set(guild.id, new Map(invs.map((i) => [i.code, i.uses])));
    } catch {}
  });
});

// ================== INVITES ==================
client.on("inviteCreate", (invite) => {
  const map = invites.get(invite.guild.id);
  if (map) map.set(invite.code, invite.uses);
});

client.on("inviteDelete", (invite) => {
  const map = invites.get(invite.guild.id);
  if (map) map.delete(invite.code);
});

// ================== WELCOME ==================
client.on("guildMemberAdd", async (member) => {
  const channel = member.guild.channels.cache.get(config.welcomeChannelId);
  const role = member.guild.roles.cache.get(config.autoRoleId);

  if (role) member.roles.add(role).catch(() => {});

  let newInvites = [];
  try {
    newInvites = await member.guild.invites.fetch();
  } catch {}

  const usedInvite = newInvites.find((i) => {
    const old = invites.get(member.guild.id)?.get(i.code) || 0;
    return i.uses > old;
  });

  const inviter = usedInvite?.inviter
    ? `<@${usedInvite.inviter.id}>`
    : "Unknown";

  const embed = new EmbedBuilder()
    .setColor("#05131f")
    .setTitle("Welcome!")
    .setDescription(`مرحباً ${member}`)
    .addFields(
      { name: "Invited By", value: inviter, inline: true },
      { name: "Members", value: `${member.guild.memberCount}`, inline: true }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  if (channel) channel.send({ embeds: [embed] });

  invites.set(
    member.guild.id,
    new Map(newInvites.map((i) => [i.code, i.uses]))
  );
});

// ================== COMMANDS ==================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "ping") {
    return message.reply("🏓 البوت شغال!");
  }

  if (command === "مسح") {
    if (
      !message.member.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      )
    )
      return message.reply("❌ ما عندك صلاحية");

    const amount = parseInt(args[0]);
    if (!amount || amount > 100)
      return message.reply("❌ رقم من 1 إلى 100");

    await message.channel.bulkDelete(amount, true);
  }
});

// ================== RULE BUTTON ==================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "accept_rules") {
    await interaction.reply({
      content: "✅ وافقت على القوانين",
      ephemeral: true,
    });

    const role = interaction.guild.roles.cache.get(config.rulesRoleId);
    if (role) interaction.member.roles.add(role).catch(() => {});
  }
});

// ================== LOGIN ==================
client.login(TOKEN);
