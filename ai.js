// Gestionnaire d'IA avec OpenRouter
const axios = require('axios');

class AIManager {
    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY || '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';
        this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        
        // Modèle gratuit sur OpenRouter (Mistral 7B)
        this.model = 'mistralai/mistral-7b-instruct:free';
        
        // Stockage des instructions par serveur
        this.instructions = new Map();
    }

    // Définir l'instruction système pour un serveur
    setInstruction(guildId, instruction) {
        this.instructions.set(guildId, instruction);
        console.log(`📝 Instruction définie pour le serveur ${guildId}`);
    }

    // Récupérer l'instruction d'un serveur
    getInstruction(guildId) {
        return this.instructions.get(guildId) || "Tu es Scriptorium, un assistant IA utile et amical. Tu réponds de manière concise et pertinente.";
    }

    // Supprimer l'instruction d'un serveur
    clearInstruction(guildId) {
        this.instructions.delete(guildId);
        console.log(`🗑️ Instruction supprimée pour le serveur ${guildId}`);
    }

    // Générer une réponse avec l'IA
    async generateResponse(guildId, userMessage, userName = 'Utilisateur') {
        try {
            const systemInstruction = this.getInstruction(guildId);

            const response = await axios.post(
                this.apiUrl,
                {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: systemInstruction
                        },
                        {
                            role: 'user',
                            content: `${userName}: ${userMessage}`
                        }
                    ],
                    max_tokens: 500, // Limite pour économiser
                    temperature: 0.7
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/scriptorium-bot',
                        'X-Title': 'Scriptorium Discord Bot'
                    },
                    timeout: 30000
                }
            );

            if (response.data && response.data.choices && response.data.choices.length > 0) {
                const aiResponse = response.data.choices[0].message.content;
                console.log(`🤖 Réponse IA générée (${response.data.usage?.total_tokens || '?'} tokens)`);
                return aiResponse;
            }

            throw new Error('Réponse invalide de l\'API');

        } catch (error) {
            console.error('❌ Erreur lors de la génération de réponse IA:', error.response?.data || error.message);
            
            if (error.response?.status === 429) {
                throw new Error('Limite de requêtes atteinte. Réessayez dans quelques instants.');
            } else if (error.response?.status === 401) {
                throw new Error('Clé API invalide.');
            } else {
                throw new Error('Impossible de générer une réponse pour le moment.');
            }
        }
    }

    // Vérifier si l'API fonctionne
    async testConnection() {
        try {
            await this.generateResponse('test', 'Dis bonjour', 'Test');
            console.log('✅ Connexion à OpenRouter réussie');
            return true;
        } catch (error) {
            console.error('⚠️ Erreur de connexion à OpenRouter:', error.message);
            return false;
        }
    }
}

module.exports = AIManager;
