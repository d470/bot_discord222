// ================== SETUP ==================
const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");

const config = require("./config.json");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
require("dotenv").config();
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
let db;

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const member = message.member;
  if (!member) return;

  if (config.bypassRoleIds && member.roles.cache.some(r => config.bypassRoleIds.includes(r.id))) return;

  const content = message.content.toLowerCase();
  const now = Date.now();

  async function punishUser(reason, durationMs) {
    try {
      if (member.moderatable && durationMs) await member.timeout(durationMs, reason);

      const dmEmbed = new EmbedBuilder()
        .setTitle("⚠️ تم إعطاءك تايم أوت")
        .setColor("Red")
        .addFields(
          { name: "السبب", value: reason },
          { name: "المدة", value: durationMs ? `${durationMs / 1000} ثانية` : "غير محدد" },
          { name: "نص الرسالة", value: message.content || "لا توجد" }
        )
        .setTimestamp();

      await member.send({ embeds: [dmEmbed] }).catch(() => {});
    } catch (err) {
      console.error("Error punishing user:", err);
    }
  }

  // كلمات سيئة
  if (config.badWords?.some(word => content.includes(word))) {
    await punishUser("كلمات مسيئة", config.punishDurations?.other || 5000);
    return;
  }

  // منشن @everyone
  if (message.mentions.everyone) {
    await punishUser("منشن @everyone", config.punishDurations?.other || 5000);
    return;
  }

  // روابط
  if (/https?:\/\/|discord\.gg|www\.|\.com|\.net|\.org|\.io|\.me|\.gg/i.test(content)) {
    await punishUser("نشر روابط", config.punishDurations?.other || 5000);
    return;
  }

  // إيموجي سبام
  const emojiCount = (content.match(/<a?:.+?:\d+>|[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
  if (emojiCount >= (config.emojiSpamLimit || 10)) {
    await punishUser("إيموجي سبام", config.punishDurations?.other || 5000);
    return;
  }

  // سبام رسائل
  const timestamps = userMessages.get(member.id) || [];
  const updated = timestamps.filter(t => now - t < (config.timeWindow || 5000));
  updated.push(now);
  userMessages.set(member.id, updated);

  if (updated.length >= (config.spamLimit || 5)) {
    await punishUser("سبام رسائل", config.punishDurations?.other || 5000);
    return;
  }
});


// ================== Welcome & Invite System ==================
client.once('ready', async () => {
  console.log('Bot is online!');
  console.log('Code by bandar.dev!');
  console.log('https://discord.gg/Y7ysBGFtQs');

  client.guilds.cache.forEach(async (guild) => {
    try {
      const currentInvites = await guild.invites.fetch();
      invites.set(guild.id, new Map(currentInvites.map(inv => [inv.code, inv.uses])));
      console.log(`Loaded ${currentInvites.size} invites for guild: ${guild.name}`);
    } catch (err) {
      console.log(`Failed to load invites for guild: ${guild.name}`);
      console.error(err);
    }
  });
});

client.on('inviteCreate', async (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

client.on('inviteDelete', async (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.delete(invite.code);
});

client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
  const role = member.guild.roles.cache.get(config.autoRoleId);

  if (role) member.roles.add(role).catch(console.error);

  let newInvites;
  try {
    newInvites = await member.guild.invites.fetch();
  } catch {
    newInvites = [];
  }

  const usedInvite = newInvites.find(inv => {
    const prevUses = invites.get(member.guild.id)?.get(inv.code) || 0;
    return inv.uses > prevUses;
  });

  let inviterMention = 'Unknown';
  if (usedInvite && usedInvite.inviter) inviterMention = `<@${usedInvite.inviter.id}>`;

  const welcomeEmbed = new EmbedBuilder()
    .setColor('#05131f')
    .setTitle('Welcome to the Server!')
    .setDescription(`مرحباً ${member}, أهلاً بك في **${member.guild.name}**! نتمنى لك إقامة ممتعة.`)
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

  invites.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));
});

// ================== UTILS ==================
function sendBoth(message, arabic, english) {
  return message.reply({ content: `${arabic}\n${english}` });
}

// دالة التحقق من صلاحيات الأوامر
function hasPermission(member, command) {
  if (!member) return false;
  if (member.permissions.has("Administrator")) return true;

  const restrictedCommands = ["kick", "ban", "unban", "lock", "unlock", "مسح"];
  if (restrictedCommands.includes(command)) {
    return member.permissions.has("KickMembers") || member.permissions.has("BanMembers") || member.permissions.has("ManageChannels");
  }
  return true; // باقي الأوامر متاحة للجميع
}

// ================== COMMANDS ==================
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot || !message.guild) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (!hasPermission(message.member, command))
    return message.reply("❌ ما عندك صلاحية استخدام هذا الأمر.");

  // ---------------- PING ----------------
  if (command === "ping") {
    return sendBoth(message, "🏓 البوت شغال تمام!", "🏓 Bot is up and running!");
  }

  // ---------------- LOCK / UNLOCK ----------------
  if (command === "lock" || command === "اقفل") {
    try {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return sendBoth(message, "🔒 تم قفل القناة.", "🔒 Channel locked.");
    } catch {
      return sendBoth(message, "❌ لا أملك صلاحية لإغلاق القناة.", "❌ I don't have permission to lock the channel.");
    }
  }

  if (command === "unlock" || command === "افتح") {
    try {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
      return sendBoth(message, "🔓 تم فتح القناة.", "🔓 Channel unlocked.");
    } catch {
      return sendBoth(message, "❌ لا أملك صلاحية لفتح القناة.", "❌ I don't have permission to unlock the channel.");
    }
  }

  // ---------------- CLEAR ----------------
  if (command === "مسح") {
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return sendBoth(message, "❌ رقم بين 1-100", "❌ Number between 1-100.");
    try {
      await message.channel.bulkDelete(amount, true);
      return sendBoth(message, `✅ تم حذف ${amount} رسالة.`, `✅ Deleted ${amount} messages.`);
    } catch {
      return sendBoth(message, "❌ لا يمكن حذف الرسائل القديمة.", "❌ Cannot delete old messages.");
    }
  }

  // ---------------- KICK ----------------
  if (command === "kick" || command === "كيك") {
    const member = message.mentions.members.first();
    if (!member) return sendBoth(message, "❌ لم يتم ذكر العضو.", "❌ No member mentioned.");
    if (!member.kickable) return sendBoth(message, "❌ لا يمكن طرده.", "❌ Cannot kick this user.");
    if (member.roles.highest.position >= message.guild.members.me.roles.highest.position)
      return sendBoth(message, "❌ لا يمكن طرد هذا العضو بسبب الرتب.", "❌ Cannot kick this member due to roles.");
    try {
      await member.kick();
      return sendBoth(message, `✅ تم طرد ${member.user.tag}.`, `✅ Kicked ${member.user.tag}.`);
    } catch {
      return sendBoth(message, "❌ حدث خطأ أثناء الطرد.", "❌ Error while kicking the member.");
    }
  }

  // ---------------- BAN ----------------
  if (command === "ban" || command === "باند") {
    const member = message.mentions.members.first();
    if (!member) return sendBoth(message, "❌ لم يتم ذكر العضو.", "❌ No member mentioned.");
    if (!member.bannable) return sendBoth(message, "❌ لا يمكن حظره.", "❌ Cannot ban this user.");
    if (member.roles.highest.position >= message.guild.members.me.roles.highest.position)
      return sendBoth(message, "❌ لا يمكن حظر هذا العضو بسبب الرتب.", "❌ Cannot ban this member due to roles.");
    try {
      await member.ban();
      return sendBoth(message, `✅ تم حظر ${member.user.tag}.`, `✅ Banned ${member.user.tag}.`);
    } catch {
      return sendBoth(message, "❌ حدث خطأ أثناء الحظر.", "❌ Error while banning the member.");
    }
  }

  // ---------------- UNBAN ----------------
  if (command === "unban" || command === "فك-باند") {
    const userId = args[0]?.replace(/[<@!>]/g, "");
    if (!userId) return sendBoth(message, "❌ اكتب ID العضو.", "❌ Provide user ID.");
    try {
      await message.guild.bans.remove(userId);
      return sendBoth(message, `✅ تم فك الحظر عن ${userId}.`, `✅ Unbanned ${userId}.`);
    } catch {
      return sendBoth(message, "❌ العضو غير محظور أو ID خاطئ.", "❌ User not banned or invalid ID.");
    }
  }

 // ---------------- RULES ----------------
if (command === "قوانين") {
  if (!args.length) return message.reply("❌ اكتب محتوى القوانين بعد الأمر.");
  const content = args.join(" ");
  await message.delete().catch(() => {}); // حماية لو ما عنده صلاحية

  const embed = new EmbedBuilder()
    .setTitle("📜 قوانين السيرفر")
    .setDescription(content)
    .setColor("Blue")
    .setThumbnail(message.guild.iconURL({ dynamic: true }) || null)
    .setImage(config.serverImageUrl)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("accept_rules")
      .setLabel("✅ أوافق على القوانين")
      .setStyle(ButtonStyle.Success)
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
    .setThumbnail(message.guild.iconURL({ dynamic: true }) || null)
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
    .setAuthor({ name: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true }) || null })
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

// ---------------- RULE BUTTON ----------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "accept_rules") {
    await interaction.reply({ content: "✅ لقد وافقت على القوانين بنجاح.", ephemeral: true });

    // تحقق من أن العضو موجود والبوت قادر على إعطاء الرتبة
    if (interaction.member && interaction.guild.roles.cache.has(config.rulesRoleId)) {
      await interaction.member.roles.add(config.rulesRoleId).catch(console.error);
    }
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

// ================== READY & PRESENCE ==================
client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [{ name: "online", type: 0 }],
        status: "online",
    });
});

// تسجيل الدخول
client.login(TOKEN);








