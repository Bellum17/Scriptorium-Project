// Gestionnaire d'IA avec OpenRouter
const axios = require('axios');

class AIManager {
    constructor(database) {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.db = database;
        
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

    // Envoyer une requête à l'IA
    async chat(guildId, userMessage, conversationHistory = []) {
        if (!this.apiKey) {
            throw new Error('Clé API OpenRouter non configurée. Ajoutez OPENROUTER_API_KEY dans vos variables d\'environnement.');
        }

        try {
            // Récupérer les instructions depuis la base de données
            const instructions = await this.getInstructions(guildId);
            
            // Construire les messages avec l'historique
            const messages = [
                {
                    role: 'system',
                    content: instructions
                },
                ...conversationHistory,
                {
                    role: 'user',
                    content: userMessage
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
