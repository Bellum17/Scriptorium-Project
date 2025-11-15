// Gestionnaire d'IA avec OpenRouter
const axios = require('axios');

class AIManager {
    constructor(database) {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.db = database;
        
        // Instructions par défaut pour l'IA
        this.defaultInstructions = `Tu es Scriptorium, un assistant IA pour un serveur Discord de jeu de rôle littéraire.

TES CAPACITÉS :
• Analyser le serveur Discord (salons, membres, bots présents, rôles)
• Analyser les messages et tendances du serveur
• Répondre à des questions sur la configuration du serveur
• Aider les joueurs avec leurs écrits et histoires
• Conseiller sur les stratégies de jeu et les méchaniques
• Analyser les décisions et les erreurs de jeu

TON RÔLE :
Tu dois être un assistant cultivé, professionnel et créatif.
Tu aides avec le roleplay littéraire, les stratégies de jeu, et l'analyse de serveur.

RÈGLES DE FORMATAGE :
• Sépare les idées avec des tirets et sauts de ligne
• Utilise des listes numérotées pour les étapes
• Met en gras les points importants
• Évite les pavés de texte, préfère les sections courtes
• Aère ta réponse avec des espaces

EXEMPLE DE FORMAT BON :
Voici les étapes :
1. **Première étape** - Brève description
2. **Deuxième étape** - Brève description

Non pas : Un long pavé de texte qui mélange tout.`;
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

            // Nettoyer la réponse en enlevant les tokens spéciaux
            let content = response.data.choices[0].message.content;
            
            if (!content || content.trim().length === 0) {
                console.warn('⚠️ Réponse IA vide reçue');
                throw new Error('L\'IA a renvoyé une réponse vide.');
            }
            
            console.log('🔍 Réponse brute (premiers 100 chars):', content.substring(0, 100));
            
            // Nettoyer les tokens au début (avant le contenu réel)
            content = content.replace(/^[\s<>[\]/INSTOUT]*/, '');
            
            // Nettoyer les tokens à la fin (après le contenu réel)
            content = content.replace(/[\s<>[\]/INSTOUT]*$/, '');
            
            // Enlever les tokens spéciaux isolés (mais pas si c'est du texte normal)
            // Remplacer <s>, </s>, [INST], [/INST], [OUT] par rien
            content = content.replace(/<s>|<\/s>|\[INST\]|\[\/INST\]|\[OUT\]/gi, ' ');
            
            // Nettoyer les espaces multiples et trim
            content = content.replace(/\s+/g, ' ').trim();
            
            console.log('🧹 Réponse nettoyée (premiers 100 chars):', content.substring(0, 100));
            
            // Vérifier qu'il reste du contenu après nettoyage
            if (!content || content.length === 0) {
                console.warn('⚠️ Réponse vide après nettoyage');
                throw new Error('La réponse de l\'IA est vide après nettoyage.');
            }
            
            console.log('✅ Réponse valide, longueur:', content.length);
            return content;
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
