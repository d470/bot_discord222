// ================== SETUP ==================
const {
  Client, GatewayIntentBits, Partials, PermissionsBitField,
  EmbedBuilder, AuditLogEvent, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");

const config = require("./config.json");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

require("dotenv").config(); // لو بتجرب محلياً
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

const prefix = '&';
const invites = new Map();
const userMessages = new Map();

// ================== ANTI-SPAM / FILTER ==================
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;
  if (message.member.roles.cache.some(r => config.bypassRoleIds.includes(r.id))) return;

  const content = message.content.toLowerCase();
  const now = Date.now();

  // دالة لمعاقبة العضو بالتايم أوت وإرسال DM
  async function punishUser(reason, durationMs) {
    try {
      const member = message.member;
      await member.timeout(durationMs, reason);

      const dmEmbed = new EmbedBuilder()
        .setTitle("⚠️ تم إعطاءك تايم أوت")
        .setColor("Red")
        .addFields(
          { name: "السبب", value: reason },
          { name: "المدة", value: `${durationMs / 1000} ثانية` },
          { name: "نص الرسالة", value: message.content || "لا توجد" }
        )
        .setTimestamp();

      await member.send({ embeds: [dmEmbed] }).catch(() => {});

    } catch (err) {
      console.error("Error punishing user:", err);
    }
  }

  // كلمات سيئة
  if (config.badWords.some(word => content.includes(word))) {
    return punishUser("كلمات مسيئة", config.punishDurations.other);
  }

  // منشن @everyone
  if (message.mentions.everyone) {
    return punishUser("منشن @everyone", config.punishDurations.other);
  }

  // روابط
  if (/https?:\/\/|discord\.gg|www\.|\.com|\.net|\.org|\.io|\.me|\.gg/i.test(content)) {
    return punishUser("نشر روابط", config.punishDurations.other);
  }

  // إيموجي سبام
  const emojiCount = (content.match(/<a?:.+?:\d+>|[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
  if (emojiCount >= config.emojiSpamLimit) {
    return punishUser("إيموجي سبام", config.punishDurations.other);
  }

  // سبام رسائل
  const timestamps = userMessages.get(message.author.id) || [];
  const updated = timestamps.filter(t => now - t < config.timeWindow);
  updated.push(now);
  userMessages.set(message.author.id, updated);

  if (updated.length >= config.spamLimit) {
    return punishUser("سبام رسائل", config.punishDurations.other);
  }
});

// ================== Welcome & Invite System ==================
client.once('ready', async () => {
  console.log('Bot is online!');
  console.log('Code by bandar.dev!');
  console.log('https://discord.gg/Y7ysBGFtQs');

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const currentInvites = await guild.invites.fetch();
      invites.set(guildId, new Map(currentInvites.map(invite => [invite.code, invite.uses])));
      console.log(`Loaded ${currentInvites.size} invites for guild: ${guild.name}`);
    } catch (err) {
      console.log(`Failed to load invites for guild: ${guild.name}`);
      console.error(err);
    }
  }
});

client.on('inviteCreate', async invite => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

client.on('inviteDelete', async invite => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.delete(invite.code);
});

client.on('guildMemberAdd', async member => {
  const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
  const role = member.guild.roles.cache.get(config.autoRoleId);

  if (role) member.roles.add(role).catch(console.error);

  const newInvites = await member.guild.invites.fetch();
  const usedInvite = newInvites.find(inv => {
    const prevUses = (invites.get(member.guild.id)?.get(inv.code) || 0);
    return inv.uses > prevUses;
  });

  let inviterMention = 'Unknown';
  if (usedInvite && usedInvite.inviter) {
    inviterMention = `<@${usedInvite.inviter.id}>`;
  }

  const welcomeEmbed = new EmbedBuilder()
    .setColor('#05131f')
    .setTitle('Welcome to the Server!')
    .setDescription(`مرحباً ${member}، أهلاً بك في **${member.guild.name}**! نتمنى لك إقامة ممتعة.`)
    .addFields(
      { name: 'Username', value: member.user.tag, inline: true },
      { name: 'Invited By', value: inviterMention, inline: true },
      { name: 'Invite Used', value: usedInvite ? `||${usedInvite.code}||` : 'Direct Join', inline: true },
      { name: "You're Member", value: `${member.guild.memberCount}`, inline: true },
      { name: 'القوانين', value: '<#1402972324814389309>.', inline: true },
      { name: 'لتواصل مع الدعم', value: '<#1400602479728656434>.', inline: true }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  const bannerUrl = member.user.bannerURL?.({ dynamic: true, format: 'png', size: 1024 });
  if (bannerUrl) welcomeEmbed.setImage(bannerUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://discord.gg/QV2GNm72df').setLabel('FiveM').setEmoji('🎤'),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://discord.gg/8B4Cu2MW6z').setLabel('Risk').setEmoji('🎤'),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://discord.gg/TdnweETu9r').setLabel('Voice room').setEmoji('🎤')
  );

  if (welcomeChannel) welcomeChannel.send({ embeds: [welcomeEmbed], components: [row] }).catch(console.error);

  invites.set(member.guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
});

// ================== UTILS ==================
function sendBoth(message, arabic, english) {
  return message.reply({ content: `${arabic}\n${english}` });
}

// ================== COMMANDS ==================
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot || !message.guild) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (!hasPermission(message.member, command))
    return message.reply("❌ ما عندك صلاحية استخدام هذا الأمر.");

  // ---------------- PING ----------------
  if (command === "ping") return sendBoth(message, "🏓 البوت شغال تمام!", "🏓 Bot is up and running!");

  // ---------------- LOCK / UNLOCK ----------------
  if (command === "lock" || command === "اقفل") {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    return sendBoth(message, "🔒 تم قفل القناة.", "🔒 Channel locked.");
  }

  if (command === "unlock" || command === "افتح") {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
    return sendBoth(message, "🔓 تم فتح القناة.", "🔓 Channel unlocked.");
  }

  // ---------------- CLEAR ----------------
  if (command === "مسح") {
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return sendBoth(message, "❌ رقم بين 1-100", "❌ Number between 1-100.");
    await message.channel.bulkDelete(amount, true);
    return sendBoth(message, `✅ تم حذف ${amount} رسالة.`, `✅ Deleted ${amount} messages.`);
  }

  // ---------------- KICK ----------------
  if (command === "kick" || command === "كيك") {
    const member = message.mentions.members.first();
    if (!member || !member.kickable) return sendBoth(message, "❌ لا يمكن طرده.", "❌ Cannot kick this user.");
    await member.kick();
    return sendBoth(message, `✅ تم طرد ${member.user.tag}.`, `✅ Kicked ${member.user.tag}.`);
  }

  // ---------------- BAN ----------------
  if (command === "ban" || command === "باند") {
    const member = message.mentions.members.first();
    if (!member || !member.bannable) return sendBoth(message, "❌ لا يمكن حظره.", "❌ Cannot ban this user.");
    await member.ban();
    return sendBoth(message, `✅ تم حظر ${member.user.tag}.`, `✅ Banned ${member.user.tag}.`);
  }

  // ---------------- UNBAN ----------------
  if (command === "unban" || command === "فك-باند") {
    const userId = args[0]?.replace(/[<@!>]/g, "");
    if (!userId) return sendBoth(message, "❌ اكتب ID العضو.", "❌ Provide user ID.");
    try {
      await message.guild.bans.remove(userId);
      return sendBoth(message, `✅ تم فك الحظر عن ${userId}.`, `✅ Unbanned ${userId}.`);
    } catch {
      return sendBoth(message, "❌ فشل في فك الحظر.", "❌ Failed to unban.");
    }
  }

  // ---------------- RULES ----------------
  if (command === "قوانين") {
    if (!args.length) return message.reply("❌ اكتب محتوى القوانين بعد الأمر.");
    const content = args.join(" ");
    await message.delete().catch(() => {});
    const embed = new EmbedBuilder()
      .setTitle("📜 قوانين السيرفر")
      .setDescription(content)
      .setColor("Blue")
      .setThumbnail(message.guild.iconURL() || null)
      .setImage(config.serverImageUrl)
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("accept_rules").setLabel("✅ أوافق على القوانين").setStyle(ButtonStyle.Success)
    );
    return message.channel.send({ embeds: [embed], components: [row] });
  }

  // ---------------- ANNOUNCEMENT ----------------
  if (command === "اعلان") {
    if (!args.length) return message.reply("❌ اكتب محتوى الإعلان بعد الأمر.");
    const content = args.join(" ");
    await message.delete().catch(() => {});
    const announcementChannel = message.guild.channels.cache.get(config.announcementChannelId) || message.channel;
    const embed = new EmbedBuilder()
      .setTitle("📢 إعلان مجتمع C4")
      .setDescription(content)
      .setColor("Blue")
      .setThumbnail(message.guild.iconURL() || null)
      .setImage(config.serverImageUrl)
      .setTimestamp();
    return announcementChannel.send({ embeds: [embed] });
  }

  // ---------------- SAY ----------------
  if (command === "say") {
    if (!args.length) return message.reply("❌ اكتب الرسالة بعد الأمر.");
    const content = args.join(" ");
    await message.delete().catch(() => {});
    const embed = new EmbedBuilder()
      .setAuthor({ name: message.guild.name, iconURL: message.guild.iconURL() || null })
      .setDescription(content)
      .setColor("#2F3136")
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ---------------- HELP ----------------
  if (command === "help" || command === "مساعدة") {
    await message.delete().catch(() => {});
    return message.channel.send(`🔧 **Available Commands | الأوامر المتاحة:**
\`&ping\`
\`&اقفل / &افتح\`
\`&امسح 10\`
\`&كيك @user\`
\`&باند @user\`
\`&فك-باند @userId\`
\`&قوانين <نص>\`
\`&اعلان <نص>\`
\`&say <نص>\``);
  }
});

// ---------------- RULE BUTTON ----------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "accept_rules") {
    await interaction.reply({ content: "✅ لقد وافقت على القوانين بنجاح.", ephemeral: true });
    await interaction.member.roles.add(config.rulesRoleId).catch(console.error);
  }
});

// ================== DATABASE ==================
let db;
(async () => {
  try {
    db = await open({
      filename: "./leveling.db",
      driver: sqlite3.Database
    });
    await db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, level INTEGER, xp INTEGER)");
    console.log("Database ready!");
  } catch (err) {
    console.error("Database error:", err);
  }
})();

// ================== LEVELING FUNCTIONS ==================
function getRequiredXP(level) { return level * level * 100; }

async function sendLevelUpMessage(userId, newLevel) {
  try {
    const channel = await client.channels.fetch(config.levelUpChannelId);
    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("Level Up!")
      .setDescription(`<@${userId}> has reached level ${newLevel}! 🎉`)
      .setTimestamp();
    await channel.send({ embeds: [embed] });

    if (config.levelRoles[newLevel]) {
      const guild = channel.guild;
      const member = await guild.members.fetch(userId);
      const role = await guild.roles.fetch(config.levelRoles[newLevel]);
      if (role) await member.roles.add(role);
    }
  } catch (err) {
    console.error("Error in sendLevelUpMessage:", err);
  }
}

async function updateUserXP(userId, xpToAdd) {
  try {
    const row = await db.get("SELECT * FROM users WHERE id = ?", userId);
    if (row) {
      let newXP = row.xp + xpToAdd;
      let newLevel = row.level;
      let leveledUp = false;
      while (newXP >= getRequiredXP(newLevel)) {
        newXP -= getRequiredXP(newLevel);
        newLevel++;
        leveledUp = true;
      }
      if (leveledUp) await sendLevelUpMessage(userId, newLevel);
      await db.run("UPDATE users SET xp = ?, level = ? WHERE id = ?", newXP, newLevel, userId);
    } else {
      await db.run("INSERT INTO users (id, level, xp) VALUES (?, ?, ?)", userId, 1, xpToAdd);
    }
  } catch (err) {
    console.error("Error updating XP:", err);
  }
}

// ================== XP EVENTS ==================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  if (!message.content.startsWith("&") && message.channel.id !== config.levelUpChannelId) {
    await updateUserXP(message.author.id, 10);
  }

  if (message.content === "&xp") {
    const users = await db.all("SELECT * FROM users ORDER BY level DESC, xp DESC LIMIT 10");
    const embed = new EmbedBuilder().setColor("#0099ff").setTitle("XP Leaderboard").setDescription("Top users by XP").setTimestamp();
    users.forEach((user, index) => {
      embed.addFields({ name: `${index + 1}. ${user.id}`, value: `Level: ${user.level} | XP: ${user.xp}` });
    });
    message.channel.send({ embeds: [embed] });
  }

  if (message.content === "&rank") {
    const row = await db.get("SELECT * FROM users WHERE id = ?", message.author.id);
    if (row) {
      const users = await db.all("SELECT * FROM users ORDER BY level DESC, xp DESC");
      const rank = users.findIndex(u => u.id === message.author.id) + 1;
      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`${message.author.username}'s Rank`)
        .addFields(
          { name: "Rank", value: `#${rank}`, inline: true },
          { name: "Level", value: `${row.level}`, inline: true },
          { name: "XP", value: `${row.xp}`, inline: true }
        );
      message.channel.send({ embeds: [embed] });
    } else {
      message.channel.send("You don't have any XP yet.");
    }
  }
});

// ================== PRESENCE ==================
client.once("ready", () => {
  client.user.setPresence({
activities: [{ name: "online", type: 0 }], // PLAYING
status: "online",

  });
});

// ================== LOGIN ==================
client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});


