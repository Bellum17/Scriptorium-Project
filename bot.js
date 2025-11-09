// Chargement des variables d'environnement
require('dotenv').config();

// Import de Discord.js et axios pour les requêtes HTTP
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const express = require('express');
const DatabaseManager = require('./database');

// Configuration du serveur Express pour Railway
const app = express();
const PORT = process.env.PORT || 3000;

// Route de santé pour Railway
app.get('/', (req, res) => {
    res.json({
        status: 'Bot Discord actif',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        guilds: client.guilds ? client.guilds.cache.size : 0
    });
});

// Route de santé
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Démarrer le serveur Express
app.listen(PORT, () => {
    console.log(`🌐 Serveur web démarré sur le port ${PORT}`);
});

// Création du client Discord avec les intentions de base
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks
    ],
    rest: {
        timeout: 30000, // Augmenter le timeout à 30 secondes
        retries: 5 // Réessayer 5 fois en cas d'échec
    }
});

// Initialiser la base de données
const db = new DatabaseManager();

// Cache des webhooks par channel
const webhookCache = new Map();

// Événement déclenché quand le bot est prêt
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Bot connecté en tant que ${readyClient.user.tag}`);
    console.log(`🤖 Bot actif sur ${readyClient.guilds.cache.size} serveur(s)`);
    
    // Initialiser la base de données
    try {
        await db.init();
    } catch (error) {
        console.error('❌ Impossible d\'initialiser la base de données:', error);
        process.exit(1);
    }

    // Enregistrer les commandes slash
    await registerCommands(readyClient);
    
    // Définir le statut du bot
    client.user.setActivity('les écrits des joueurs 📖', { type: 3 }); // 3 = WATCHING
    console.log('📖 Statut défini : "Regarde les écrits des joueurs"');
});

// Fonction pour enregistrer les commandes slash
async function registerCommands(client) {
    const commands = [
        new SlashCommandBuilder()
            .setName('personnage')
            .setDescription('Gestion des personnages')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('créer')
                    .setDescription('Créer un nouveau personnage')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('liste')
                    .setDescription('Afficher vos personnages')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('supprimer')
                    .setDescription('Supprimer un personnage')
                    .addStringOption(option =>
                        option
                            .setName('nom')
                            .setDescription('Nom du personnage à supprimer')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('info')
                    .setDescription('Afficher les informations d\'un personnage')
                    .addStringOption(option =>
                        option
                            .setName('nom')
                            .setDescription('Nom du personnage')
                            .setRequired(true)
                    )
            )
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Enregistrement des commandes slash...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Commandes slash enregistrées avec succès');
    } catch (error) {
        console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
    }
}

// Gestion des commandes slash
client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
    } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
    }
});

// Gestionnaire de commandes
async function handleCommand(interaction) {
    if (interaction.commandName !== 'personnage') return;

    const subcommand = interaction.options.getSubcommand();

    try {
        switch (subcommand) {
            case 'créer':
                await showCreateCharacterModal(interaction);
                break;
            case 'liste':
                await showCharacterList(interaction);
                break;
            case 'supprimer':
                await deleteCharacter(interaction);
                break;
            case 'info':
                await showCharacterInfo(interaction);
                break;
        }
    } catch (error) {
        console.error('❌ Erreur lors de l\'exécution de la commande:', error);
        const errorMessage = error.message || 'Une erreur est survenue';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: `<:DO_Cross:1436967855273803826> ${errorMessage}`, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: `<:DO_Cross:1436967855273803826> ${errorMessage}`, flags: MessageFlags.Ephemeral });
        }
    }
}

// Afficher le modal de création de personnage
async function showCreateCharacterModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('create_character_modal')
        .setTitle('Créer un personnage');

    const nameInput = new TextInputBuilder()
        .setCustomId('character_name')
        .setLabel('Nom du personnage')
        .setPlaceholder('Ex: Alice')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const prefixInput = new TextInputBuilder()
        .setCustomId('character_prefix')
        .setLabel('Prefix (pour déclencher le personnage)')
        .setPlaceholder('Ex: [Alice] ou a:')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

    const avatarInput = new TextInputBuilder()
        .setCustomId('character_avatar')
        .setLabel('URL de l\'avatar (optionnel)')
        .setPlaceholder('https://example.com/avatar.png')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    const row1 = new ActionRowBuilder().addComponents(nameInput);
    const row2 = new ActionRowBuilder().addComponents(prefixInput);
    const row3 = new ActionRowBuilder().addComponents(avatarInput);

    modal.addComponents(row1, row2, row3);

    await interaction.showModal(modal);
}

// Gérer la soumission du modal
async function handleModalSubmit(interaction) {
    if (interaction.customId === 'create_character_modal') {
        await createCharacterFromModal(interaction);
    }
}

// Créer un personnage à partir du modal
async function createCharacterFromModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const name = interaction.fields.getTextInputValue('character_name');
    const prefix = interaction.fields.getTextInputValue('character_prefix');
    const avatarUrl = interaction.fields.getTextInputValue('character_avatar') || null;

    // Validation de l'URL si fournie
    if (avatarUrl && !isValidUrl(avatarUrl)) {
        await interaction.editReply({
            content: '<:DO_Cross:1436967855273803826> L\'URL de l\'avatar n\'est pas valide. Elle doit commencer par http:// ou https://'
        });
        return;
    }

    try {
        const character = await db.createCharacter(
            interaction.user.id,
            interaction.guildId,
            name,
            prefix,
            avatarUrl
        );

        const embed = new EmbedBuilder()
            .setColor(0x729bb6)
            .setTitle('<:DO_Check:1436967853801869322> Personnage créé !')
            .setDescription(`Le personnage **${name}** a été créé avec succès.\n\n> <:DO_Icone_Cle:1436971786418786395> | **Préfix** : \`${prefix}\`\n> <:DO_Icone_FicheModifier:1436970642531680306> | **Nom** : ${name}`);

        if (avatarUrl) {
            embed.setThumbnail(avatarUrl);
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> ${error.message}`
        });
    }
}

// Afficher la liste des personnages
async function showCharacterList(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const characters = await db.getUserCharacters(interaction.user.id, interaction.guildId);

    if (characters.length === 0) {
        await interaction.editReply({
            content: '<:DO_Cross:1436967855273803826> Vous n\'avez aucun personnage. Utilisez `/personnage créer` pour en créer un !'
        });
        return;
    }

    let description = '';
    
    characters.forEach(char => {
        description += `**${char.name}**\n`;
        description += `> <:DO_Icone_Cle:1436971786418786395> | **Préfix** : \`${char.prefix}\`\n`;
        description += `> <:DO_Icone_FicheModifier:1436970642531680306> | **Nom** : ${char.name}\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x729bb6)
        .setTitle('<:DO_Icone_Liste:1436970080822099998> | Liste de vos personnages')
        .setDescription(description)
        .setFooter({ text: `Vous avez ${characters.length} personnage(s)` });

    await interaction.editReply({ embeds: [embed] });
}

// Supprimer un personnage
async function deleteCharacter(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const name = interaction.options.getString('nom');
    const deleted = await db.deleteCharacter(interaction.user.id, interaction.guildId, name);

    if (!deleted) {
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> Aucun personnage nommé "${name}" n'a été trouvé.`
        });
        return;
    }

    await interaction.editReply({
        content: `<:DO_Check:1436967853801869322> Le personnage **${name}** a été supprimé avec succès.`
    });
}

// Afficher les informations d'un personnage
async function showCharacterInfo(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const name = interaction.options.getString('nom');
    const character = await db.getCharacterByName(interaction.user.id, interaction.guildId, name);

    if (!character) {
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> Aucun personnage nommé "${name}" n'a été trouvé.`
        });
        return;
    }

    const description = `> <:DO_Icone_Cle:1436971786418786395> | **Préfix** : \`${character.prefix}\`\n> <:DO_Icone_FicheModifier:1436970642531680306> | **Nom** : ${character.name}\n> <:DO_Icone_Calendrier:1437018266966032466> | **Créé le** : ${new Date(character.created_at).toLocaleDateString('fr-FR')}\n> <:DO_Icone_Modification:1437017821031960656> | **Modifié le** : ${new Date(character.updated_at).toLocaleDateString('fr-FR')}`;

    const embed = new EmbedBuilder()
        .setColor(0x729bb6)
        .setTitle(`<:DO_Icone_Fiche:1436970640878993428> | ${character.name}`)
        .setDescription(description);

    if (character.avatar_url) {
        embed.setThumbnail(character.avatar_url);
    }

    await interaction.editReply({ embeds: [embed] });
}

// Fonction utilitaire pour valider une URL
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// Gestion des erreurs
client.on(Events.Error, (error) => {
    console.error('❌ Erreur Discord:', error);
});

// Gestion de la déconnexion
client.on(Events.Disconnect, () => {
    console.log('⚠️ Bot déconnecté - Reconnexion automatique par Discord.js...');
});

// Gestion de la reprise de connexion
client.on(Events.ShardResume, (id, replayedEvents) => {
    console.log(`✅ Connexion reprise (Shard ${id}, ${replayedEvents} événements rejoués)`);
});

// Gestion de la reconnexion
client.on(Events.ShardReconnecting, (id) => {
    console.log(`🔄 Reconnexion en cours (Shard ${id})...`);
});

// Gestion des messages pour le proxying
client.on(Events.MessageCreate, async (message) => {
    // Ignorer les messages du bot et des webhooks
    if (message.author.bot || message.webhookId) return;
    
    // Ignorer les messages vides
    if (!message.content || message.content.trim().length === 0) return;

    try {
        // Chercher un personnage correspondant au prefix
        const character = await findCharacterByPrefix(message);
        
        if (character) {
            await proxyMessage(message, character);
        }
    } catch (error) {
        console.error('❌ Erreur lors du proxying:', error);
    }
});

// Trouver un personnage par son prefix dans le message
async function findCharacterByPrefix(message) {
    const content = message.content;
    
    // Récupérer tous les personnages de l'utilisateur
    const characters = await db.getUserCharacters(message.author.id, message.guildId);
    
    // Chercher un personnage dont le prefix correspond au début du message
    for (const character of characters) {
        if (content.startsWith(character.prefix)) {
            return character;
        }
    }
    
    return null;
}

// Transformer le message via webhook
async function proxyMessage(message, character) {
    try {
        // Retirer le prefix du contenu
        const content = message.content.substring(character.prefix.length).trim();
        
        // Ignorer si le message est vide après avoir retiré le prefix
        if (!content) return;
        
        // Récupérer ou créer un webhook pour ce channel
        const webhook = await getOrCreateWebhook(message.channel);
        
        if (!webhook) {
            console.error('❌ Impossible de créer un webhook');
            return;
        }

        // Vérifier si c'est une réponse à un message
        let threadId = null;
        let mentionContent = '';
        
        if (message.reference) {
            try {
                const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                
                // Si c'est une réponse à un message de webhook (personnage)
                if (repliedMessage.webhookId) {
                    // Chercher le créateur du personnage en parsant le nom du webhook
                    const characterName = repliedMessage.author.username;
                    
                    // Chercher dans la base de données quel utilisateur a créé ce personnage
                    const originalCharacter = await db.getCharacterByName(null, message.guildId, characterName);
                    
                    if (originalCharacter) {
                        mentionContent = `*En réponse à <@${originalCharacter.user_id}>*`;
                    }
                }
                
                threadId = repliedMessage.id;
            } catch (error) {
                console.error('⚠️ Impossible de récupérer le message d\'origine:', error);
            }
        }

        // Envoyer le message via le webhook
        const webhookMessage = await webhook.send({
            content: content,
            username: character.name,
            avatarURL: character.avatar_url || message.author.displayAvatarURL(),
            threadId: threadId, // Répondre au message si c'est une reply
            allowedMentions: {
                parse: ['users', 'roles'],
                repliedUser: true
            }
        });

        // Si c'est une réponse à un personnage, envoyer la mention juste après
        if (mentionContent) {
            await message.channel.send({
                content: mentionContent,
                reply: { messageReference: webhookMessage.id, failIfNotExists: false },
                allowedMentions: { parse: ['users'] }
            });
        }

        // Supprimer le message original
        await message.delete().catch(err => {
            console.error('❌ Impossible de supprimer le message:', err);
        });

    } catch (error) {
        console.error('❌ Erreur lors du proxying du message:', error);
    }
}

// Récupérer ou créer un webhook pour un channel
async function getOrCreateWebhook(channel) {
    // Vérifier si on a un webhook en cache
    if (webhookCache.has(channel.id)) {
        const webhook = webhookCache.get(channel.id);
        // Vérifier que le webhook est toujours valide
        try {
            await webhook.fetch();
            return webhook;
        } catch (error) {
            // Le webhook n'existe plus, le retirer du cache
            webhookCache.delete(channel.id);
        }
    }

    // Vérifier les permissions
    if (!channel.permissionsFor(client.user).has(PermissionFlagsBits.ManageWebhooks)) {
        console.error('❌ Pas de permission pour gérer les webhooks dans ce channel');
        return null;
    }

    try {
        // Chercher un webhook existant créé par le bot
        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.owner.id === client.user.id && wh.name === 'Scriptorium');

        // Créer un nouveau webhook si aucun n'existe
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Scriptorium',
                reason: 'Webhook pour le système de personnages'
            });
            console.log(`✅ Webhook créé pour le channel ${channel.name}`);
        }

        // Mettre en cache
        webhookCache.set(channel.id, webhook);
        return webhook;

    } catch (error) {
        console.error('❌ Erreur lors de la création du webhook:', error);
        return null;
    }
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exception non capturée:', error);
    process.exit(1);
});

// Vérification de la présence du token
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERREUR: Variable d\'environnement DISCORD_TOKEN manquante');
    console.error('📝 Assurez-vous d\'avoir configuré la variable DISCORD_TOKEN sur Railway');
    process.exit(1);
}

// Fonction pour se connecter avec retry
async function connectWithRetry(maxRetries = 5, delay = 5000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🚀 Tentative de connexion... (${i + 1}/${maxRetries})`);
            await client.login(process.env.DISCORD_TOKEN);
            console.log('✅ Connexion réussie !');
            return;
        } catch (error) {
            console.error(`❌ Erreur lors de la connexion (tentative ${i + 1}/${maxRetries}):`, error.message);
            
            if (error.code === 'TOKEN_INVALID') {
                console.error('🔍 Token Discord invalide. Vérifiez votre variable DISCORD_TOKEN');
                process.exit(1);
            }
            
            if (i < maxRetries - 1) {
                console.log(`⏳ Nouvelle tentative dans ${delay / 1000} secondes...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('❌ Impossible de se connecter après plusieurs tentatives');
                console.error('🔍 Vérifiez votre connexion réseau et les paramètres Railway');
                process.exit(1);
            }
        }
    }
}

// Connexion du bot avec retry
connectWithRetry();

// Gestion de l'arrêt propre du bot
process.on('SIGINT', () => {
    console.log('\n⏹️ Arrêt du bot...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n⏹️ Arrêt du bot...');
    client.destroy();
    process.exit(0);
});
