// Gestionnaire d'IA avec OpenRouter
const axios = require('axios');

class AIManager {
    constructor(database, discordClient) {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.db = database;
        this.client = discordClient;
        
        // Instructions par défaut pour l'IA
        this.defaultInstructions = "Tu es Scriptorium, un assistant RP littéraire élégant et cultivé. Tu aides les joueurs dans leurs écrits et histoires avec un ton professionnel et créatif.";
    }

    // Définir les instructions système pour un serveur
    async setInstructions(guildId, instructions) {
        await this.db.setAIInstructions(guildId, instructions);
    }

    // Récupérer les instructions pour un serveur
    async getInstructions(guildId) {
        const settings = await this.db.getAISettings(guildId);
        return settings?.instructions || this.defaultInstructions;
    }
    
    async setAllowedChannel(guildId, channelId) {
        await this.db.setAIAllowedChannel(guildId, channelId);
    }
    
    async getAllowedChannel(guildId) {
        const settings = await this.db.getAISettings(guildId);
        return settings?.allowed_channel_id || null;
    }

    // Collecter les informations du serveur
    async getGuildContext(guildId) {
        if (!this.client) return '';
        
        try {
            const guild = await this.client.guilds.fetch(guildId);
            if (!guild) return '';
            
            let context = `\n📊 **Contexte du serveur "${guild.name}":**\n`;
            context += `- Membres: ${guild.memberCount}\n`;
            
            // Salons textuels
            const textChannels = guild.channels.cache
                .filter(c => c.isTextBased() && !c.isDMBased())
                .map(c => `<#${c.id}>`)
                .slice(0, 10);
            
            if (textChannels.length > 0) {
                context += `- Salons: ${textChannels.join(', ')}${guild.channels.cache.filter(c => c.isTextBased()).size > 10 ? ' ...' : ''}\n`;
            }
            
            // Rôles
            const roles = guild.roles.cache
                .filter(r => !r.isManaged() && r.id !== guildId)
                .map(r => `<@&${r.id}>`)
                .slice(0, 10);
            
            if (roles.length > 0) {
                context += `- Rôles: ${roles.join(', ')}${guild.roles.cache.size > 11 ? ' ...' : ''}\n`;
            }
            
            return context;
        } catch (error) {
            console.error('❌ Erreur lors de la collecte du contexte:', error);
            return '';
        }
    }

    // Parser et analyser les liens de messages Discord
    async parseMessageLink(messageLink) {
        // Format: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
        const match = messageLink.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
        if (!match) return null;
        
        const [, guildId, channelId, messageId] = match;
        
        try {
            const guild = await this.client.guilds.fetch(guildId);
            const channel = await guild.channels.fetch(channelId);
            
            if (!channel || !channel.isTextBased()) return null;
            
            const message = await channel.messages.fetch(messageId);
            if (!message) return null;
            
            return {
                author: message.author.username,
                content: message.content,
                timestamp: message.createdAt,
                attachments: message.attachments.size > 0 ? `[${message.attachments.size} fichier(s)]` : null
            };
        } catch (error) {
            console.error('❌ Erreur lors de la récupération du message:', error);
            return null;
        }
    }

    // Extraire tous les liens de messages du texte
    extractMessageLinks(text) {
        const regex = /https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+/g;
        return text.match(regex) || [];
    }

    // Envoyer une requête à l'IA
    async chat(guildId, userMessage, conversationHistory = [], interaction = null) {
        if (!this.apiKey) {
            throw new Error('Clé API OpenRouter non configurée. Ajoutez OPENROUTER_API_KEY dans vos variables d\'environnement.');
        }

        try {
            // Récupérer les instructions depuis la base de données
            let instructions = await this.getInstructions(guildId);
            
            // Ajouter le contexte du serveur aux instructions
            let guildContext = '';
            if (interaction) {
                guildContext = await this.getGuildContext(guildId);
            }
            
            // Traiter les liens de messages
            let enhancedMessage = userMessage;
            const messageLinks = this.extractMessageLinks(userMessage);
            
            for (const link of messageLinks) {
                const messageData = await this.parseMessageLink(link);
                if (messageData) {
                    enhancedMessage += `\n\n📎 Message lié (de ${messageData.author}):\n"${messageData.content}"`;
                    if (messageData.attachments) {
                        enhancedMessage += `\n(${messageData.attachments})`;
                    }
                }
            }
            
            // Construire les messages avec l'historique
            const messages = [
                {
                    role: 'system',
                    content: instructions + guildContext
                },
                ...conversationHistory,
                {
                    role: 'user',
                    content: enhancedMessage
                }
            ];

            const response = await axios.post(
                this.baseUrl,
                {
                    model: 'mistralai/mistral-7b-instruct', // Modèle gratuit Mistral
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/your-repo', // Remplacer par votre repo
                        'X-Title': 'Scriptorium Bot'
                    }
                }
            );

            // Nettoyer la réponse (retirer les tokens spéciaux comme <s>)
            let responseText = response.data.choices[0].message.content;
            responseText = responseText.replace(/^<s>\s*/, '').trim();
            
            return responseText;
        } catch (error) {
            console.error('❌ Erreur lors de la requête IA:', error.response?.data || error.message);
            throw new Error('Impossible de contacter l\'IA. Vérifiez votre connexion et votre clé API.');
        }
    }

    // Modèles gratuits disponibles sur OpenRouter
    static getFreeModels() {
        return [
            'meta-llama/llama-3.1-8b-instruct:free', // Modèle stable et rapide
            'meta-llama/llama-3.1-70b-instruct:free',
            'google/gemma-2-9b-it:free',
            'microsoft/phi-3-medium-128k-instruct:free',
            'mistralai/mistral-7b-instruct:free',
            'nousresearch/hermes-3-llama-3.1-405b:free' // Puissant mais peut être rate-limited
        ];
    }
}

module.exports = AIManager;
