// Désactiver les warnings expérimentaux
process.removeAllListeners('warning');

// Chargement des variables d'environnement
require('dotenv').config();

// Import de Discord.js et axios pour les requêtes HTTP
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, StreamType, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const express = require('express');
const DatabaseManager = require('./database');
const StatsGenerator = require('./stats');
const AIManager = require('./ai');

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
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildMembers, // Nécessaire pour tracker les arrivées/départs
        GatewayIntentBits.GuildVoiceStates // Nécessaire pour détecter les salons vocaux
    ],
    rest: {
        timeout: 30000, // Augmenter le timeout à 30 secondes
        retries: 5 // Réessayer 5 fois en cas d'échec
    }
});

// Initialiser la base de données
const db = new DatabaseManager();

// Initialiser le générateur de statistiques
const statsGen = new StatsGenerator();

// Initialiser le gestionnaire d'IA (avec la base de données)
let ai;

// Cache des webhooks par channel
const webhookCache = new Map();

// Gestion de la musique - Map des queues par serveur
const musicQueues = new Map();

// Structure d'une queue musicale
class MusicQueue {
    constructor(guildId) {
        this.guildId = guildId;
        this.songs = [];
        this.currentSong = null;
        this.connection = null;
        this.player = null;
        this.isPlaying = false;
    }

    addSong(song) {
        this.songs.push(song);
    }

    getNextSong() {
        return this.songs.shift();
    }

    clear() {
        this.songs = [];
        this.currentSong = null;
    }

    destroy() {
        if (this.connection) {
            this.connection.destroy();
        }
        if (this.player) {
            this.player.stop();
        }
        this.clear();
    }
}

// Événement déclenché quand le bot est prêt
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Bot connecté en tant que ${readyClient.user.tag}`);
    console.log(`🤖 Bot actif sur ${readyClient.guilds.cache.size} serveur(s)`);
    
    // Initialiser la base de données
    try {
        await db.init();
        // Initialiser l'IA après la base de données avec le client Discord
        ai = new AIManager(db, client);
        console.log('✅ Gestionnaire d\'IA initialisé');
    } catch (error) {
        console.error('❌ Impossible d\'initialiser la base de données:', error);
        process.exit(1);
    }

    // Enregistrer les commandes slash
    await registerCommands(readyClient);
    
    // Définir le statut du bot
    client.user.setActivity('les écrits des joueurs 📖', { type: 3 }); // 3 = WATCHING
    console.log('📖 Statut défini : "Regarde les écrits des joueurs"');

    // Initialiser le compteur de membres pour chaque serveur
    for (const [guildId, guild] of readyClient.guilds.cache) {
        const memberCount = guild.memberCount;
        await db.logMemberCount(guildId, memberCount);
        console.log(`👥 Membres initialisés pour ${guild.name}: ${memberCount}`);
    }

    // Mettre à jour le compteur de membres toutes les heures
    setInterval(async () => {
        for (const [guildId, guild] of client.guilds.cache) {
            const memberCount = guild.memberCount;
            await db.logMemberCount(guildId, memberCount);
            console.log(`🔄 Compteur mis à jour pour ${guild.name}: ${memberCount}`);
        }
    }, 60 * 60 * 1000); // Toutes les heures
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
            ),
        new SlashCommandBuilder()
            .setName('statistiques')
            .setDescription('Afficher les statistiques')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('messages')
                    .setDescription('Statistiques des messages du serveur')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('utilisateur')
                    .setDescription('Statistiques de vos messages')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('membres')
                    .setDescription('Statistiques des arrivées et départs de membres')
            ),
        new SlashCommandBuilder()
            .setName('ia')
            .setDescription('Discuter avec l\'IA Scriptorium')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('message')
                    .setDescription('Envoyer un message à l\'IA')
                    .addStringOption(option =>
                        option
                            .setName('message')
                            .setDescription('Votre message à l\'IA')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('salon')
                    .setDescription('Définir le salon autorisé pour l\'IA')
                    .addChannelOption(option =>
                        option
                            .setName('salon')
                            .setDescription('Salon où l\'IA sera autorisée')
                            .setRequired(true)
                    )
            ),
        new SlashCommandBuilder()
            .setName('instruction')
            .setDescription('Modifier les instructions de l\'IA pour ce serveur')
            .addStringOption(option =>
                option
                    .setName('instructions')
                    .setDescription('Nouvelles instructions système pour l\'IA')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('emoji')
            .setDescription('Gérer les emojis personnalisés du serveur')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Ajouter un emoji personnalisé au serveur')
                    .addStringOption(option =>
                        option
                            .setName('emoji')
                            .setDescription('Emoji à ajouter (Discord custom ou Unicode)')
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('nom')
                            .setDescription('Nom de l\'emoji (2-32 caractères, lettres/chiffres/underscores)')
                            .setRequired(true)
                            .setMinLength(2)
                            .setMaxLength(32)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('image')
                    .setDescription('Obtenir l\'image d\'un emoji')
                    .addStringOption(option =>
                        option
                            .setName('emoji')
                            .setDescription('L\'emoji dont vous voulez l\'image (emoji Discord ou Unicode)')
                            .setRequired(true)
                    )
            ),
        new SlashCommandBuilder()
            .setName('play')
            .setDescription('Jouer une musique YouTube dans le salon vocal')
            .addStringOption(option =>
                option
                    .setName('video')
                    .setDescription('Lien YouTube de la vidéo à jouer')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('Passer à la musique suivante'),
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('Arrêter la musique et quitter le vocal'),
        new SlashCommandBuilder()
            .setName('queue')
            .setDescription('Afficher la file d\'attente des musiques')
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

// Gestion des commandes slash et interactions
client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
    } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
    } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
    }
});

// Gestionnaire de commandes
async function handleCommand(interaction) {
    try {
        if (interaction.commandName === 'personnage') {
            const subcommand = interaction.options.getSubcommand();
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
        } else if (interaction.commandName === 'statistiques') {
            const subcommand = interaction.options.getSubcommand();
            switch (subcommand) {
                case 'messages':
                    await showServerStats(interaction);
                    break;
                case 'utilisateur':
                    await showUserStats(interaction);
                    break;
                case 'membres':
                    await showMemberStats(interaction);
                    break;
            }
        } else if (interaction.commandName === 'ia') {
            const subcommand = interaction.options.getSubcommand();
            switch (subcommand) {
                case 'message':
                    await handleAIChat(interaction);
                    break;
                case 'salon':
                    await handleSetAIChannel(interaction);
                    break;
            }
        } else if (interaction.commandName === 'instruction') {
            await handleSetInstructions(interaction);
        } else if (interaction.commandName === 'emoji') {
            const subcommand = interaction.options.getSubcommand();
            switch (subcommand) {
                case 'add':
                    await handleAddEmoji(interaction);
                    break;
                case 'image':
                    await handleEmojiImage(interaction);
                    break;
            }
        } else if (interaction.commandName === 'play') {
            await handlePlay(interaction);
        } else if (interaction.commandName === 'skip') {
            await handleSkip(interaction);
        } else if (interaction.commandName === 'stop') {
            await handleStop(interaction);
        } else if (interaction.commandName === 'queue') {
            await handleQueue(interaction);
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

// Afficher les statistiques du serveur
async function showServerStats(interaction) {
    await interaction.deferReply();

    try {
        const hours = 24; // 24 dernières heures
        const channelId = null; // Pas de filtre par channel

        // Récupérer les données statistiques par heure
        const stats = await db.getMessageStatsByHour(interaction.guildId, hours, channelId);

        // Vérifier qu'il y a des données
        if (stats.length === 0) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> Aucune donnée disponible pour cette période. Le système de tracking est nouveau, les statistiques s\'accumuleront au fil du temps !'
            });
            return;
        }

        // Générer le graphique principal
        const chartBuffer = await statsGen.generateActivityChart(stats);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'stats.png' });

        // Créer le menu déroulant pour changer de période
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('stats_period')
            .setPlaceholder('Choisir une période')
            .addOptions([
                {
                    label: '7 Jours',
                    value: 'period_7d'
                },
                {
                    label: '14 Jours',
                    value: 'period_14d'
                },
                {
                    label: '1 Mois',
                    value: 'period_1m'
                },
                {
                    label: '6 Mois',
                    value: 'period_6m'
                },
                {
                    label: '1 An',
                    value: 'period_1y'
                }
            ]);

        const row = new ActionRowBuilder()
            .addComponents(selectMenu);

        // Envoyer l'image avec le menu déroulant
        await interaction.editReply({
            files: [attachment],
            components: [row]
        });

    } catch (error) {
        console.error('❌ Erreur lors de la génération des statistiques:', error);
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> Erreur lors de la génération des statistiques: ${error.message}`
        });
    }
}

// Afficher les statistiques de l'utilisateur
async function showUserStats(interaction) {
    await interaction.deferReply();

    try {
        const hours = 24; // 24 dernières heures par défaut
        const userId = interaction.user.id;
        const username = interaction.user.username;
        
        // Récupérer l'URL de l'avatar de l'utilisateur
        const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });

        // Récupérer les données statistiques par heure
        const stats = await db.getUserMessageStatsByHour(interaction.guildId, userId, hours);

        // Vérifier qu'il y a des données
        if (stats.length === 0) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> Aucune donnée disponible pour cette période. Le système de tracking est nouveau, les statistiques s\'accumuleront au fil du temps !'
            });
            return;
        }

        // Générer le graphique utilisateur avec photo de profil
        const chartBuffer = await statsGen.generateUserActivityChart(stats, avatarUrl, username);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'stats.png' });

        // Créer le menu déroulant pour changer de période
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('user_stats_period')
            .setPlaceholder('Choisir une période')
            .addOptions([
                {
                    label: '7 Jours',
                    value: 'period_7d'
                },
                {
                    label: '14 Jours',
                    value: 'period_14d'
                },
                {
                    label: '1 Mois',
                    value: 'period_1m'
                },
                {
                    label: '6 Mois',
                    value: 'period_6m'
                },
                {
                    label: '1 An',
                    value: 'period_1y'
                }
            ]);

        const row = new ActionRowBuilder()
            .addComponents(selectMenu);

        // Envoyer l'image avec le menu déroulant
        await interaction.editReply({
            files: [attachment],
            components: [row]
        });

    } catch (error) {
        console.error('❌ Erreur lors de la génération des statistiques utilisateur:', error);
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> Erreur lors de la génération des statistiques: ${error.message}`
        });
    }
}

// Afficher les statistiques des membres (arrivées/départs)
async function showMemberStats(interaction) {
    await interaction.deferReply();

    try {
        const hours = 24; // 24 dernières heures par défaut

        // Récupérer les données statistiques par heure
        const stats = await db.getMemberStatsByHour(interaction.guildId, hours);

        // Vérifier qu'il y a des données
        if (stats.length === 0) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> Aucune donnée disponible pour cette période. Le système de tracking est nouveau, les statistiques s\'accumuleront au fil du temps !'
            });
            return;
        }

        // Générer le graphique membres avec Membres.png
        const chartBuffer = await statsGen.generateMemberChart(stats, 'Membres.png');
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'member-stats.png' });

        // Créer le menu déroulant pour changer de période
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('member_stats_period')
            .setPlaceholder('Choisir une période')
            .addOptions([
                {
                    label: '7 Jours',
                    value: 'period_7d'
                },
                {
                    label: '14 Jours',
                    value: 'period_14d'
                },
                {
                    label: '1 Mois',
                    value: 'period_1m'
                },
                {
                    label: '6 Mois',
                    value: 'period_6m'
                },
                {
                    label: '1 An',
                    value: 'period_1y'
                }
            ]);

        const row = new ActionRowBuilder()
            .addComponents(selectMenu);

        // Envoyer l'image avec le menu déroulant
        await interaction.editReply({
            files: [attachment],
            components: [row]
        });

    } catch (error) {
        console.error('❌ Erreur lors de la génération des statistiques membres:', error);
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> Erreur lors de la génération des statistiques: ${error.message}`
        });
    }
}

// Gérer une conversation avec l'IA
async function handleAIChat(interaction) {
    await interaction.deferReply();

    try {
        // Vérifier si le salon est autorisé
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;
        const allowedChannelId = await ai.getAllowedChannel(guildId);
        if (allowedChannelId && allowedChannelId !== channelId) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> La commande /ia n\'est autorisée que dans le salon configuré par un administrateur.'
            });
            return;
        }

        const userMessage = interaction.options.getString('message');
        // Envoyer le message à l'IA avec le contexte du serveur et de l'interaction
        const response = await ai.chat(guildId, userMessage, [], interaction);

        // Vérifier que la réponse n'est pas vide
        if (!response || response.trim().length === 0) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> L\'IA n\'a pas pu générer de réponse. Veuillez réessayer.'
            });
            return;
        }

        // Créer un embed pour la réponse
        const embed = new EmbedBuilder()
            .setColor(0x729bb6)
            .setAuthor({ 
                name: 'Scriptorium', 
                iconURL: client.user.displayAvatarURL() 
            })
            .setDescription(response)
            .setFooter({ 
                text: `Demande de ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Erreur lors de la discussion avec l\'IA:', error);
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> ${error.message}`
        });
    }
}

// Modifier les instructions de l'IA
async function handleSetInstructions(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Vérifier les permissions (admin uniquement)
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> Seuls les administrateurs peuvent modifier les instructions de l\'IA.'
            });
            return;
        }

        const instructions = interaction.options.getString('instructions');
        // Mettre à jour les instructions
        ai.setInstructions(interaction.guildId, instructions);

        const embed = new EmbedBuilder()
            .setColor(0x729bb6)
            .setTitle('<:DO_Check:1436967853801869322> Instructions mises à jour !')
            .setDescription(`Les nouvelles instructions pour **Scriptorium** ont été enregistrées.\n\n**Instructions :**\n> ${instructions}`)
            .setFooter({ text: 'L\'IA utilisera ces instructions pour toutes les futures conversations.' });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Erreur lors de la modification des instructions:', error);
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> ${error.message}`
        });
    }

}

// Handler pour la sous-commande /ia salon (admin only)
async function handleSetAIChannel(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Vérifier les permissions (admin uniquement)
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> Seuls les administrateurs peuvent définir le salon autorisé pour l\'IA.'
            });
            return;
        }

        const channel = interaction.options.getChannel('salon');
        if (!channel || !channel.isTextBased()) {
            await interaction.editReply({
                content: '<:DO_Cross:1436967855273803826> Veuillez sélectionner un salon textuel valide.'
            });
            return;
        }

        // Enregistrer le salon autorisé dans l'AIManager
        ai.setAllowedChannel(interaction.guildId, channel.id);

        const embed = new EmbedBuilder()
            .setColor(0x729bb6)
            .setTitle('<:DO_Check:1436967853801869322> Salon IA défini !')
            .setDescription(`La commande **/ia** ne sera utilisable que dans le salon <#${channel.id}>.`)
            .setFooter({ text: 'Seuls les administrateurs peuvent modifier ce paramètre.' });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Erreur lors de la définition du salon IA:', error);
        await interaction.editReply({
            content: `<:DO_Cross:1436967855273803826> ${error.message}`
        });
    }
}

// Gestionnaire de menu déroulant
async function handleSelectMenu(interaction) {
    if (interaction.customId === 'stats_period') {
        await interaction.deferUpdate();

        try {
            const period = interaction.values[0];
            let days;

            // Déterminer le nombre de jours selon la période
            switch (period) {
                case 'period_7d':
                    days = 7;
                    break;
                case 'period_14d':
                    days = 14;
                    break;
                case 'period_1m':
                    days = 30;
                    break;
                case 'period_6m':
                    days = 180;
                    break;
                case 'period_1y':
                    days = 365;
                    break;
                default:
                    days = 30;
            }

            // Récupérer les nouvelles données (par jour pour les périodes > 24h)
            const stats = await db.getMessageStatsByDay(interaction.guildId, days, null);

            // Générer le graphique même si toutes les valeurs sont à 0
            // (la requête SQL remplit automatiquement les jours manquants)
            const chartBuffer = await statsGen.generateActivityChart(stats);
            const attachment = new AttachmentBuilder(chartBuffer, { name: 'stats.png' });

            // Recréer le menu déroulant
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('stats_period')
                .setPlaceholder('Choisir une période')
                .addOptions([
                    {
                        label: '7 Jours',
                        value: 'period_7d'
                    },
                    {
                        label: '14 Jours',
                        value: 'period_14d'
                    },
                    {
                        label: '1 Mois',
                        value: 'period_1m'
                    },
                    {
                        label: '6 Mois',
                        value: 'period_6m'
                    },
                    {
                        label: '1 An',
                        value: 'period_1y'
                    }
                ]);

            const row = new ActionRowBuilder()
                .addComponents(selectMenu);

            // Mettre à jour le message avec le nouveau graphique
            await interaction.editReply({
                files: [attachment],
                components: [row]
            });

        } catch (error) {
            console.error('❌ Erreur lors du changement de période:', error);
            await interaction.editReply({
                content: `<:DO_Cross:1436967855273803826> Erreur: ${error.message}`,
                components: []
            });
        }
    } else if (interaction.customId === 'user_stats_period') {
        await interaction.deferUpdate();

        try {
            const period = interaction.values[0];
            let days;

            // Déterminer le nombre de jours selon la période
            switch (period) {
                case 'period_7d':
                    days = 7;
                    break;
                case 'period_14d':
                    days = 14;
                    break;
                case 'period_1m':
                    days = 30;
                    break;
                case 'period_6m':
                    days = 180;
                    break;
                case 'period_1y':
                    days = 365;
                    break;
                default:
                    days = 30;
            }

            const userId = interaction.user.id;
            const username = interaction.user.username;
            const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });

            // Récupérer les nouvelles données (par jour pour les périodes > 24h)
            const stats = await db.getUserMessageStatsByDay(interaction.guildId, userId, days);

            // Générer le graphique utilisateur
            const chartBuffer = await statsGen.generateUserActivityChart(stats, avatarUrl, username);
            const attachment = new AttachmentBuilder(chartBuffer, { name: 'stats.png' });

            // Recréer le menu déroulant
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('user_stats_period')
                .setPlaceholder('Choisir une période')
                .addOptions([
                    {
                        label: '7 Jours',
                        value: 'period_7d'
                    },
                    {
                        label: '14 Jours',
                        value: 'period_14d'
                    },
                    {
                        label: '1 Mois',
                        value: 'period_1m'
                    },
                    {
                        label: '6 Mois',
                        value: 'period_6m'
                    },
                    {
                        label: '1 An',
                        value: 'period_1y'
                    }
                ]);

            const row = new ActionRowBuilder()
                .addComponents(selectMenu);

            // Mettre à jour le message avec le nouveau graphique
            await interaction.editReply({
                files: [attachment],
                components: [row]
            });

        } catch (error) {
            console.error('❌ Erreur lors du changement de période:', error);
            await interaction.editReply({
                content: `<:DO_Cross:1436967855273803826> Erreur: ${error.message}`,
                components: []
            });
        }
    } else if (interaction.customId === 'member_stats_period') {
        await interaction.deferUpdate();

        try {
            const period = interaction.values[0];
            let days;

            // Déterminer le nombre de jours selon la période
            switch (period) {
                case 'period_7d':
                    days = 7;
                    break;
                case 'period_14d':
                    days = 14;
                    break;
                case 'period_1m':
                    days = 30;
                    break;
                case 'period_6m':
                    days = 180;
                    break;
                case 'period_1y':
                    days = 365;
                    break;
                default:
                    days = 30;
            }

            // Récupérer les nouvelles données (par jour pour les périodes > 24h)
            const stats = await db.getMemberStatsByDay(interaction.guildId, days);

            // Générer le graphique membres
            const chartBuffer = await statsGen.generateMemberChart(stats, 'Membres.png');
            const attachment = new AttachmentBuilder(chartBuffer, { name: 'member-stats.png' });

            // Recréer le menu déroulant
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('member_stats_period')
                .setPlaceholder('Choisir une période')
                .addOptions([
                    {
                        label: '7 Jours',
                        value: 'period_7d'
                    },
                    {
                        label: '14 Jours',
                        value: 'period_14d'
                    },
                    {
                        label: '1 Mois',
                        value: 'period_1m'
                    },
                    {
                        label: '6 Mois',
                        value: 'period_6m'
                    },
                    {
                        label: '1 An',
                        value: 'period_1y'
                    }
                ]);

            const row = new ActionRowBuilder()
                .addComponents(selectMenu);

            // Mettre à jour le message avec le nouveau graphique
            await interaction.editReply({
                files: [attachment],
                components: [row]
            });

        } catch (error) {
            console.error('❌ Erreur lors du changement de période:', error);
            await interaction.editReply({
                content: `<:DO_Cross:1436967855273803826> Erreur: ${error.message}`,
                components: []
            });
        }
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

// Gestion des arrivées de membres
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const memberCount = member.guild.memberCount;
        await db.logMemberEvent(member.user.id, member.guild.id, 'join', memberCount);
        console.log(`✅ Membre rejoint: ${member.user.tag} (${member.guild.name}) - Total: ${memberCount}`);
    } catch (error) {
        console.error('❌ Erreur lors du log d\'arrivée de membre:', error);
    }
});

// Gestion des départs de membres
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        const memberCount = member.guild.memberCount;
        await db.logMemberEvent(member.user.id, member.guild.id, 'leave', memberCount);
        console.log(`👋 Membre parti: ${member.user.tag} (${member.guild.name}) - Total: ${memberCount}`);
    } catch (error) {
        console.error('❌ Erreur lors du log de départ de membre:', error);
    }
});

// Gestion des messages pour le proxying
client.on(Events.MessageCreate, async (message) => {
    // Ignorer les messages du bot lui-même
    if (message.author.id === client.user.id) return;
    
    // Ignorer les messages vides
    if (!message.content || message.content.trim().length === 0) return;

    try {
        // Logger le message pour les statistiques (sauf webhooks)
        if (!message.webhookId && !message.author.bot) {
            await db.logMessage(
                message.author.id,
                message.guildId,
                message.channelId,
                message.id,
                false,
                null
            );
        }

        // Ignorer les messages des webhooks pour le proxying
        if (message.webhookId || message.author.bot) return;

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
        let repliedToMessage = null;
        let mentionUserId = null;
        
        if (message.reference) {
            try {
                repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
                
                // Si c'est une réponse à un message de webhook (personnage)
                if (repliedToMessage.webhookId) {
                    // Chercher le créateur du personnage en parsant le nom du webhook
                    const characterName = repliedToMessage.author.username;
                    
                    // Chercher dans la base de données quel utilisateur a créé ce personnage
                    const originalCharacter = await db.getCharacterByName(null, message.guildId, characterName);
                    
                    if (originalCharacter) {
                        mentionUserId = originalCharacter.user_id;
                    }
                }
            } catch (error) {
                console.error('⚠️ Impossible de récupérer le message d\'origine:', error);
            }
        }

        // Préparer le contenu avec la mention si nécessaire
        let finalContent = content;
        if (repliedToMessage && mentionUserId) {
            finalContent = `*↩️ <@${mentionUserId}>*\n${content}`;
        }

        // Envoyer le message via le webhook
        const webhookMessage = await webhook.send({
            content: finalContent,
            username: character.name,
            avatarURL: character.avatar_url || message.author.displayAvatarURL(),
            allowedMentions: {
                parse: ['users', 'roles'],
                repliedUser: true
            }
        });

        // Logger le message de personnage pour les statistiques
        await db.logMessage(
            message.author.id,
            message.guildId,
            message.channelId,
            webhookMessage.id,
            true,
            character.name
        );

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

// Gestionnaire pour ajouter un emoji personnalisé
async function handleAddEmoji(interaction) {
    try {
        // Vérifier les permissions (besoin de MANAGE_GUILD_EXPRESSIONS)
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
            await interaction.reply({
                content: '❌ Vous devez avoir la permission "Gérer les expressions" pour ajouter des emojis.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Récupérer les options
        const emojiInput = interaction.options.getString('emoji');
        const emojiName = interaction.options.getString('nom');

        // Valider le nom de l'emoji (lettres, chiffres, underscores seulement)
        const nameRegex = /^[a-zA-Z0-9_]+$/;
        if (!nameRegex.test(emojiName)) {
            await interaction.reply({
                content: '❌ Le nom de l\'emoji ne peut contenir que des lettres, chiffres et underscores.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Différer la réponse car la récupération et création d'emoji peut prendre du temps
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            let imageUrl = null;

            // Détecter si c'est un emoji Discord custom
            const discordEmojiRegex = /<a?:(\w+):(\d+)>/;
            const discordMatch = emojiInput.match(discordEmojiRegex);

            if (discordMatch) {
                // Emoji Discord custom
                const emojiId = discordMatch[2];
                const isAnimated = emojiInput.startsWith('<a:');
                const extension = isAnimated ? 'gif' : 'png';
                imageUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?quality=lossless`;
                
                console.log(`📥 Récupération de l'emoji Discord: ${imageUrl}`);

            } else {
                // Emoji Unicode - convertir en codepoints pour Twemoji
                const codePoints = [];
                for (let i = 0; i < emojiInput.length; i++) {
                    const codePoint = emojiInput.codePointAt(i);
                    if (codePoint) {
                        codePoints.push(codePoint.toString(16));
                        // Si c'est un caractère surrogate pair, sauter le suivant
                        if (codePoint > 0xFFFF) i++;
                    }
                }

                if (codePoints.length === 0) {
                    await interaction.editReply({
                        content: '❌ Emoji invalide. Veuillez fournir un emoji Discord custom (<:nom:id>) ou un emoji Unicode (😀).'
                    });
                    return;
                }

                // Construire l'URL Twemoji
                const codePointString = codePoints.join('-');
                imageUrl = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codePointString}.png`;
                
                console.log(`📥 Récupération de l'emoji Unicode: ${imageUrl}`);

                // Vérifier que l'URL Twemoji existe
                try {
                    const response = await axios.head(imageUrl);
                    if (response.status !== 200) {
                        throw new Error('Image non trouvée');
                    }
                } catch (error) {
                    await interaction.editReply({
                        content: '❌ Impossible de récupérer l\'image de cet emoji Unicode. Essayez avec un emoji Discord custom.'
                    });
                    return;
                }
            }

            // Créer l'emoji sur le serveur avec l'URL récupérée
            const emoji = await interaction.guild.emojis.create({
                attachment: imageUrl,
                name: emojiName,
                reason: `Emoji ajouté par ${interaction.user.tag}`
            });

            // Répondre avec succès
            await interaction.editReply({
                content: `✅ Emoji ${emoji} \`:${emoji.name}:\` ajouté avec succès !`
            });

            console.log(`✅ Emoji ${emoji.name} ajouté au serveur ${interaction.guild.name} par ${interaction.user.tag}`);

        } catch (error) {
            console.error('❌ Erreur lors de la création de l\'emoji:', error);
            
            let errorMessage = '❌ Erreur lors de l\'ajout de l\'emoji.';
            
            if (error.code === 30008) {
                errorMessage = '❌ Le serveur a atteint le nombre maximum d\'emojis.';
            } else if (error.code === 50035) {
                errorMessage = '❌ Format d\'image invalide ou nom d\'emoji invalide.';
            } else if (error.message.includes('Missing Permissions')) {
                errorMessage = '❌ Le bot n\'a pas la permission "Gérer les expressions".';
            } else if (error.message.includes('File cannot be larger than')) {
                errorMessage = '❌ L\'image de l\'emoji est trop grande (max 256KB).';
            }
            
            await interaction.editReply({ content: errorMessage });
        }

    } catch (error) {
        console.error('❌ Erreur dans handleAddEmoji:', error);
        
        const errorResponse = {
            content: '❌ Une erreur est survenue lors de l\'ajout de l\'emoji.',
            flags: MessageFlags.Ephemeral
        };
        
        if (interaction.deferred) {
            await interaction.editReply(errorResponse);
        } else {
            await interaction.reply(errorResponse);
        }
    }
}

// Gestionnaire pour obtenir l'image d'un emoji
async function handleEmojiImage(interaction) {
    try {
        const emojiInput = interaction.options.getString('emoji');

        // Différer la réponse pour avoir le temps de traiter
        await interaction.deferReply();

        // Regex pour détecter un emoji personnalisé Discord : <:nom:id> ou <a:nom:id>
        const customEmojiRegex = /<a?:(\w+):(\d+)>/;
        const match = emojiInput.match(customEmojiRegex);

        if (match) {
            // C'est un emoji personnalisé Discord
            const emojiName = match[1];
            const emojiId = match[2];
            const isAnimated = emojiInput.startsWith('<a:');
            
            // Construire l'URL de l'emoji
            const extension = isAnimated ? 'gif' : 'png';
            const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}`;

            // Créer un embed avec l'image
            const embed = new EmbedBuilder()
                .setTitle(`🖼️ Image de l'emoji :${emojiName}:`)
                .setDescription(`**Nom:** \`:${emojiName}:\`\n**ID:** \`${emojiId}\`\n**Type:** ${isAnimated ? 'Animé (GIF)' : 'Statique (PNG)'}`)
                .setImage(emojiUrl)
                .setColor(0x5865F2)
                .setFooter({ text: `Demandé par ${interaction.user.tag}` })
                .setTimestamp();

            // Répondre avec l'embed
            await interaction.editReply({
                embeds: [embed],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Ouvrir l\'image')
                            .setURL(emojiUrl)
                            .setStyle(ButtonStyle.Link)
                    )
                ]
            });

            console.log(`✅ Image de l'emoji ${emojiName} (${emojiId}) envoyée à ${interaction.user.tag}`);

        } else {
            // C'est peut-être un emoji Unicode
            // On va essayer de le convertir en codepoint pour obtenir l'image depuis une API
            
            // Vérifier si c'est un caractère emoji valide
            const emojiChar = emojiInput.trim();
            
            // Convertir en codepoints Unicode
            const codePoints = [];
            for (const char of emojiChar) {
                codePoints.push(char.codePointAt(0).toString(16));
            }
            
            if (codePoints.length === 0) {
                await interaction.editReply({
                    content: '❌ Emoji invalide. Veuillez fournir un emoji Discord (ex: <:nom:id>) ou un emoji Unicode (ex: 😀).'
                });
                return;
            }

            // Utiliser l'API Twemoji de Discord pour obtenir l'image
            const codePointsString = codePoints.join('-');
            const twemojiUrl = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${codePointsString}.png`;

            // Vérifier que l'image existe en faisant une requête HEAD
            try {
                const response = await axios.head(twemojiUrl);
                
                if (response.status === 200) {
                    // L'image existe, créer un embed
                    const embed = new EmbedBuilder()
                        .setTitle(`🖼️ Image de l'emoji ${emojiChar}`)
                        .setDescription(`**Emoji Unicode:** ${emojiChar}\n**Codepoint:** \`U+${codePoints.join(' U+').toUpperCase()}\``)
                        .setImage(twemojiUrl)
                        .setColor(0x5865F2)
                        .setFooter({ text: `Demandé par ${interaction.user.tag}` })
                        .setTimestamp();

                    await interaction.editReply({
                        embeds: [embed],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setLabel('Ouvrir l\'image')
                                    .setURL(twemojiUrl)
                                    .setStyle(ButtonStyle.Link)
                            )
                        ]
                    });

                    console.log(`✅ Image de l'emoji Unicode ${emojiChar} envoyée à ${interaction.user.tag}`);
                } else {
                    throw new Error('Image non trouvée');
                }
            } catch (error) {
                // Si l'image n'existe pas, essayer une approche alternative
                // Utiliser l'API EmojiAPI
                const emojiApiUrl = `https://emojiapi.dev/api/v1/${encodeURIComponent(emojiChar)}`;
                
                try {
                    const apiResponse = await axios.get(emojiApiUrl);
                    
                    if (apiResponse.data && apiResponse.data.images) {
                        const imageUrl = apiResponse.data.images[0]?.url || twemojiUrl;
                        
                        const embed = new EmbedBuilder()
                            .setTitle(`🖼️ Image de l'emoji ${emojiChar}`)
                            .setDescription(`**Emoji Unicode:** ${emojiChar}\n**Nom:** ${apiResponse.data.name || 'Inconnu'}`)
                            .setImage(imageUrl)
                            .setColor(0x5865F2)
                            .setFooter({ text: `Demandé par ${interaction.user.tag}` })
                            .setTimestamp();

                        await interaction.editReply({
                            embeds: [embed],
                            components: [
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel('Ouvrir l\'image')
                                        .setURL(imageUrl)
                                        .setStyle(ButtonStyle.Link)
                                )
                            ]
                        });

                        console.log(`✅ Image de l'emoji Unicode ${emojiChar} envoyée à ${interaction.user.tag}`);
                    } else {
                        throw new Error('API ne retourne pas de données');
                    }
                } catch (apiError) {
                    // Dernier recours : utiliser l'URL Twemoji même si on n'a pas confirmé qu'elle existe
                    const embed = new EmbedBuilder()
                        .setTitle(`🖼️ Image de l'emoji ${emojiChar}`)
                        .setDescription(`**Emoji Unicode:** ${emojiChar}\n**Codepoint:** \`U+${codePoints.join(' U+').toUpperCase()}\`\n\n⚠️ Image potentiellement indisponible`)
                        .setImage(twemojiUrl)
                        .setColor(0xFFA500)
                        .setFooter({ text: `Demandé par ${interaction.user.tag}` })
                        .setTimestamp();

                    await interaction.editReply({
                        embeds: [embed]
                    });

                    console.log(`⚠️ Image de l'emoji Unicode ${emojiChar} (non vérifiée) envoyée à ${interaction.user.tag}`);
                }
            }
        }

    } catch (error) {
        console.error('❌ Erreur dans handleEmojiImage:', error);
        
        const errorResponse = {
            content: '❌ Une erreur est survenue lors de la récupération de l\'image de l\'emoji.'
        };
        
        if (interaction.deferred) {
            await interaction.editReply(errorResponse);
        } else {
            await interaction.reply({ ...errorResponse, flags: MessageFlags.Ephemeral });
        }
    }
}

// ========================================
// SYSTÈME DE MUSIQUE
// ========================================

// Fonction pour nettoyer et normaliser les URLs YouTube
function cleanYouTubeURL(url) {
    try {
        // Supprimer les paramètres inutiles (playlist, start_radio, etc.)
        const urlObj = new URL(url);
        
        // Gérer les liens courts youtu.be
        if (urlObj.hostname === 'youtu.be' || urlObj.hostname === 'www.youtu.be') {
            const videoId = urlObj.pathname.slice(1); // Enlever le premier "/"
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        
        // Gérer les liens youtube.com/watch
        if (urlObj.hostname === 'youtube.com' || urlObj.hostname === 'www.youtube.com') {
            const videoId = urlObj.searchParams.get('v');
            if (videoId) {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
        }
        
        // Si on ne peut pas parser, retourner l'URL originale
        return url;
    } catch (error) {
        // Si l'URL n'est pas valide, retourner telle quelle
        return url;
    }
}

// Gestionnaire de la commande /play
async function handlePlay(interaction) {
    try {
        // Vérifier que l'utilisateur est dans un salon vocal
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            await interaction.reply({
                content: '❌ Vous devez être dans un salon vocal pour utiliser cette commande !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Vérifier les permissions du bot
        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
            await interaction.reply({
                content: '❌ Je n\'ai pas les permissions pour rejoindre et parler dans ce salon vocal !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply();

        let videoUrl = interaction.options.getString('video');

        // Nettoyer l'URL (supporter les liens de partage, playlists, etc.)
        videoUrl = cleanYouTubeURL(videoUrl);

        // Valider l'URL YouTube avec ytdl-core
        if (!ytdl.validateURL(videoUrl)) {
            await interaction.editReply({
                content: '❌ Lien YouTube invalide ! Veuillez fournir un lien YouTube valide.'
            });
            return;
        }

        try {
            // Récupérer les informations de la vidéo avec ytdl-core
            const videoInfo = await ytdl.getInfo(videoUrl, {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                }
            });

            const song = {
                title: videoInfo.videoDetails.title,
                url: videoInfo.videoDetails.video_url,
                duration: formatDuration(parseInt(videoInfo.videoDetails.lengthSeconds)),
                thumbnail: videoInfo.videoDetails.thumbnails[0].url,
                requestedBy: interaction.user
            };

            // Obtenir ou créer la queue pour ce serveur
            let queue = musicQueues.get(interaction.guildId);

            if (!queue) {
                // Créer une nouvelle queue
                queue = new MusicQueue(interaction.guildId);
                musicQueues.set(interaction.guildId, queue);

                // Rejoindre le salon vocal
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guildId,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                    selfDeaf: true,
                    selfMute: false
                });

                queue.connection = connection;

                // Créer un audio player
                const player = createAudioPlayer();
                queue.player = player;

                // Connecter le player à la connexion
                connection.subscribe(player);

                // Gérer les événements du player
                player.on(AudioPlayerStatus.Idle, () => {
                    // Quand une musique se termine, jouer la suivante
                    playNextSong(queue, interaction);
                });

                player.on('error', error => {
                    console.error('❌ Erreur du lecteur audio:', error);
                    playNextSong(queue, interaction);
                });

                // Ajouter la musique et commencer à jouer
                queue.addSong(song);
                await playSong(queue, interaction);

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🎵 Lecture en cours')
                    .setDescription(`**${song.title}**`)
                    .setThumbnail(song.thumbnail)
                    .addFields(
                        { name: 'Durée', value: song.duration, inline: true },
                        { name: 'Demandé par', value: song.requestedBy.username, inline: true }
                    )
                    .setFooter({ text: 'Utilisez /queue pour voir la file d\'attente' });

                await interaction.editReply({ embeds: [embed] });

            } else {
                // Ajouter la musique à la queue existante
                queue.addSong(song);

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('✅ Ajouté à la file d\'attente')
                    .setDescription(`**${song.title}**`)
                    .setThumbnail(song.thumbnail)
                    .addFields(
                        { name: 'Position', value: `#${queue.songs.length}`, inline: true },
                        { name: 'Durée', value: song.duration, inline: true },
                        { name: 'Demandé par', value: song.requestedBy.username, inline: true }
                    );

                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('❌ Erreur lors de la récupération de la vidéo:', error);
            await interaction.editReply({
                content: '❌ Impossible de récupérer les informations de cette vidéo. Assurez-vous que le lien est correct et que la vidéo est accessible.'
            });
        }

    } catch (error) {
        console.error('❌ Erreur dans handlePlay:', error);
        
        const errorResponse = {
            content: '❌ Une erreur est survenue lors de la lecture de la musique.'
        };
        
        if (interaction.deferred) {
            await interaction.editReply(errorResponse);
        } else {
            await interaction.reply({ ...errorResponse, flags: MessageFlags.Ephemeral });
        }
    }
}

// Jouer une musique
async function playSong(queue, interaction) {
    const song = queue.getNextSong();
    
    if (!song) {
        // Plus de musiques dans la queue
        queue.isPlaying = false;
        queue.currentSong = null;
        
        // Quitter le vocal après 2 minutes d'inactivité
        setTimeout(() => {
            if (!queue.isPlaying && queue.songs.length === 0) {
                queue.destroy();
                musicQueues.delete(queue.guildId);
                console.log('🔇 Bot déconnecté du vocal par inactivité');
            }
        }, 120000); // 2 minutes
        
        return;
    }

    queue.currentSong = song;
    queue.isPlaying = true;

    try {
        // Créer un stream audio depuis YouTube avec ytdl-core
        const stream = ytdl(song.url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25, // 32MB buffer
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }
        });

        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        // Ajuster le volume (optionnel)
        if (resource.volume) {
            resource.volume.setVolume(0.5); // 50% du volume
        }

        // Jouer la musique
        queue.player.play(resource);

        console.log(`🎵 Lecture: ${song.title}`);

    } catch (error) {
        console.error('❌ Erreur lors de la lecture de la musique:', error);
        queue.isPlaying = false;
        // Passer à la musique suivante
        playNextSong(queue, interaction);
    }
}

// Jouer la musique suivante
async function playNextSong(queue, interaction) {
    if (queue.songs.length > 0) {
        await playSong(queue, interaction);
    } else {
        queue.isPlaying = false;
        queue.currentSong = null;
        
        // Quitter le vocal après 2 minutes d'inactivité
        setTimeout(() => {
            if (!queue.isPlaying && queue.songs.length === 0) {
                queue.destroy();
                musicQueues.delete(queue.guildId);
                console.log('🔇 Bot déconnecté du vocal par inactivité');
            }
        }, 120000);
    }
}

// Gestionnaire de la commande /skip
async function handleSkip(interaction) {
    try {
        const queue = musicQueues.get(interaction.guildId);

        if (!queue || !queue.isPlaying) {
            await interaction.reply({
                content: '❌ Aucune musique n\'est en cours de lecture !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Vérifier que l'utilisateur est dans le même salon vocal
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel || voiceChannel.id !== queue.connection.joinConfig.channelId) {
            await interaction.reply({
                content: '❌ Vous devez être dans le même salon vocal que le bot !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Arrêter la musique actuelle (déclenchera automatiquement la suivante)
        queue.player.stop();

        await interaction.reply({
            content: '⏭️ Musique passée !',
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        console.error('❌ Erreur dans handleSkip:', error);
        await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: MessageFlags.Ephemeral
        });
    }
}

// Gestionnaire de la commande /stop
async function handleStop(interaction) {
    try {
        const queue = musicQueues.get(interaction.guildId);

        if (!queue) {
            await interaction.reply({
                content: '❌ Aucune musique n\'est en cours de lecture !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Vérifier que l'utilisateur est dans le même salon vocal
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel || voiceChannel.id !== queue.connection.joinConfig.channelId) {
            await interaction.reply({
                content: '❌ Vous devez être dans le même salon vocal que le bot !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Détruire la queue et quitter le vocal
        queue.destroy();
        musicQueues.delete(interaction.guildId);

        await interaction.reply({
            content: '⏹️ Lecture arrêtée et file d\'attente vidée. À bientôt ! 👋',
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        console.error('❌ Erreur dans handleStop:', error);
        await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: MessageFlags.Ephemeral
        });
    }
}

// Gestionnaire de la commande /queue
async function handleQueue(interaction) {
    try {
        const queue = musicQueues.get(interaction.guildId);

        if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
            await interaction.reply({
                content: '❌ La file d\'attente est vide !',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        let description = '';

        // Musique en cours
        if (queue.currentSong) {
            description += `**🎵 En cours:**\n`;
            description += `[${queue.currentSong.title}](${queue.currentSong.url})\n`;
            description += `*Durée: ${queue.currentSong.duration} | Demandé par: ${queue.currentSong.requestedBy.username}*\n\n`;
        }

        // File d'attente
        if (queue.songs.length > 0) {
            description += `**📋 File d'attente (${queue.songs.length} musique(s)):**\n\n`;
            
            queue.songs.slice(0, 10).forEach((song, index) => {
                description += `**${index + 1}.** [${song.title}](${song.url})\n`;
                description += `*Durée: ${song.duration} | Demandé par: ${song.requestedBy.username}*\n\n`;
            });

            if (queue.songs.length > 10) {
                description += `*... et ${queue.songs.length - 10} autre(s) musique(s)*`;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📜 File d\'attente musicale')
            .setDescription(description)
            .setFooter({ text: 'Utilisez /play pour ajouter une musique' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Erreur dans handleQueue:', error);
        await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: MessageFlags.Ephemeral
        });
    }
}

// Fonction utilitaire pour formater la durée
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
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
