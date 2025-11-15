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
                .filter(c => c.isTextBased && !c.isDMBased())
                .map(c => `<#${c.id}>`)
                .slice(0, 10);
            
            if (textChannels.length > 0) {
                context += `- Salons: ${textChannels.join(', ')}${guild.channels.cache.filter(c => c.isTextBased).size > 10 ? ' ...' : ''}\n`;
            }
            
            // Rôles
            const roles = guild.roles.cache
                .filter(r => !r.managed && r.id !== guildId)
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
            
            if (!channel || !channel.isTextBased) return null;
            
            const message = await channel.messages.fetch(messageId);
            if (!message) return null;
            
            // Extraire les informations du message
            const messageData = {
                author: message.author.username,
                content: message.content,
                timestamp: message.createdAt,
                attachments: [],
                embeds: []
            };
            
            // Extraire les fichiers joints (images, documents, etc.)
            if (message.attachments.size > 0) {
                message.attachments.forEach(attachment => {
                    if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                        // Pour les images, on note qu'il y a une image
                        messageData.attachments.push({
                            type: 'image',
                            url: attachment.url,
                            name: attachment.name,
                            size: attachment.size
                        });
                    } else {
                        // Pour les autres fichiers
                        messageData.attachments.push({
                            type: 'file',
                            url: attachment.url,
                            name: attachment.name,
                            size: attachment.size
                        });
                    }
                });
            }
            
            // Extraire les embeds (images incorporées, etc.)
            if (message.embeds.length > 0) {
                message.embeds.forEach(embed => {
                    if (embed.image) {
                        messageData.embeds.push({
                            type: 'image',
                            url: embed.image.url,
                            title: embed.title
                        });
                    }
                });
            }
            
            return messageData;
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

    // Envoyer une requête à l'IA avec fallback sur plusieurs modèles
    async chat(guildId, userMessage, conversationHistory = [], interaction = null) {
        if (!this.apiKey) {
            throw new Error('Clé API OpenRouter non configurée. Ajoutez OPENROUTER_API_KEY dans vos variables d\'environnement.');
        }

        // Liste des modèles à essayer dans l'ordre
        const models = [
            'mistralai/mistral-7b-instruct:free',       // Mistral 7B principal
            'nousresearch/hermes-3-llama-3.1-405b:free' // Hermes 3 en fallback
        ];

        try {
            // Récupérer les instructions depuis la base de données
            let instructions = await this.getInstructions(guildId);
            
            // Traiter les liens de messages
            let enhancedMessage = userMessage;
            const messageLinks = this.extractMessageLinks(userMessage);
            
            for (const link of messageLinks) {
                const messageData = await this.parseMessageLink(link);
                if (messageData) {
                    enhancedMessage += `\n\n📎 Message lié (de ${messageData.author}):\n"${messageData.content}"`;
                    
                    // Ajouter les informations sur les fichiers/images
                    if (messageData.attachments && messageData.attachments.length > 0) {
                        enhancedMessage += `\n\n📎 Fichiers joints:`;
                        messageData.attachments.forEach(attachment => {
                            if (attachment.type === 'image') {
                                enhancedMessage += `\n  🖼️ Image: ${attachment.name} (${(attachment.size / 1024).toFixed(2)} KB)`;
                                enhancedMessage += `\n     URL: ${attachment.url}`;
                            } else {
                                enhancedMessage += `\n  📄 Fichier: ${attachment.name} (${(attachment.size / 1024).toFixed(2)} KB)`;
                            }
                        });
                    }
                    
                    // Ajouter les embeds (images incorporées)
                    if (messageData.embeds && messageData.embeds.length > 0) {
                        enhancedMessage += `\n\n🖼️ Images incorporées:`;
                        messageData.embeds.forEach(embed => {
                            if (embed.title) {
                                enhancedMessage += `\n  ${embed.title}: ${embed.url}`;
                            } else {
                                enhancedMessage += `\n  ${embed.url}`;
                            }
                        });
                    }
                }
            }
            
            // Construire les messages avec l'historique
            const messages = [
                {
                    role: 'system',
                    content: instructions
                },
                ...conversationHistory,
                {
                    role: 'user',
                    content: enhancedMessage
                }
            ];

            // Essayer chaque modèle jusqu'à ce que l'un fonctionne
            let lastError = null;
            for (const model of models) {
                try {
                    const response = await axios.post(
                        this.baseUrl,
                        {
                            model: model,
                            messages: messages,
                            temperature: 0.7,
                            max_tokens: 1000
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${this.apiKey}`,
                                'Content-Type': 'application/json',
                                'HTTP-Referer': 'https://github.com/your-repo',
                                'X-Title': 'Scriptorium Bot'
                            }
                        }
                    );

                    // Nettoyer la réponse
                    let responseText = response.data.choices[0].message.content;
                    responseText = responseText
                        .replace(/^<s>\s*/g, '')
                        .replace(/\s*<\/s>\s*/g, '')
                        .replace(/^\[INST\]\s*/g, '')
                        .replace(/\s*\[\/INST\]\s*/g, '')
                        .replace(/^<\|.*?\|>\s*/g, '')
                        .trim();
                    
                    if (responseText && responseText.length > 0) {
                        console.log(`✅ Réponse reçue du modèle: ${model}`);
                        return responseText;
                    }
                } catch (error) {
                    lastError = error;
                    console.warn(`⚠️ Modèle ${model} échoué, essai du suivant...`);
                    continue;
                }
            }

            // Si aucun modèle n'a fonctionné
            if (lastError) {
                console.error('❌ Erreur lors de la requête IA:', lastError.response?.data || lastError.message);
                throw new Error('Impossible de contacter l\'IA. Vérifiez votre connexion et votre clé API.');
            }
            
            throw new Error('L\'IA n\'a pas pu générer de réponse.');
        } catch (error) {
            console.error('❌ Erreur lors de la requête IA:', error.response?.data || error.message);
            throw new Error('Impossible de contacter l\'IA. Vérifiez votre connexion et votre clé API.');
        }
    }

    // Modèles disponibles sur OpenRouter
    static getAvailableModels() {
        return [
            'meta-llama/llama-2-70b-chat', // Stable et fiable
            'meta-llama/llama-3.1-8b-instruct:free',
            'meta-llama/llama-3.1-70b-instruct:free',
            'google/gemma-2-9b-it:free',
            'microsoft/phi-3-medium-128k-instruct:free',
            'mistralai/mistral-7b-instruct',
            'nousresearch/hermes-3-llama-3.1-405b:free'
        ];
    }
}

module.exports = AIManager;
