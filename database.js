// Gestionnaire de base de données PostgreSQL
const { Pool } = require('pg');

class DatabaseManager {
    constructor() {
        // Configuration de la connexion PostgreSQL
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? {
                rejectUnauthorized: false
            } : false
        });

        this.initialized = false;
    }

    // Initialiser la base de données et créer les tables
    async init() {
        if (this.initialized) return;

        try {
            console.log('🔄 Initialisation de la base de données...');

            // Créer la table des personnages
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS characters (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    prefix VARCHAR(50) NOT NULL,
                    avatar_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, guild_id, name)
                )
            `);

            // Créer un index pour optimiser les recherches
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_characters_user_guild 
                ON characters(user_id, guild_id)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_characters_prefix 
                ON characters(prefix)
            `);

            this.initialized = true;
            console.log('✅ Base de données initialisée avec succès');
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
            throw error;
        }
    }

    // Créer un personnage
    async createCharacter(userId, guildId, name, prefix, avatarUrl) {
        try {
            const result = await this.pool.query(
                `INSERT INTO characters (user_id, guild_id, name, prefix, avatar_url) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING *`,
                [userId, guildId, name, prefix, avatarUrl]
            );
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') { // Code d'erreur pour violation de contrainte unique
                throw new Error('Un personnage avec ce nom existe déjà');
            }
            throw error;
        }
    }

    // Récupérer tous les personnages d'un utilisateur sur un serveur
    async getUserCharacters(userId, guildId) {
        const result = await this.pool.query(
            `SELECT * FROM characters 
             WHERE user_id = $1 AND guild_id = $2 
             ORDER BY created_at DESC`,
            [userId, guildId]
        );
        return result.rows;
    }

    // Récupérer un personnage par son nom
    async getCharacterByName(userId, guildId, name) {
        const result = await this.pool.query(
            `SELECT * FROM characters 
             WHERE user_id = $1 AND guild_id = $2 AND name = $3`,
            [userId, guildId, name]
        );
        return result.rows[0];
    }

    // Récupérer un personnage par son prefix dans un serveur
    async getCharacterByPrefix(guildId, prefix) {
        const result = await this.pool.query(
            `SELECT * FROM characters 
             WHERE guild_id = $1 AND prefix = $2 
             LIMIT 1`,
            [guildId, prefix]
        );
        return result.rows[0];
    }

    // Mettre à jour un personnage
    async updateCharacter(userId, guildId, name, updates) {
        const fields = [];
        const values = [];
        let paramIndex = 1;

        if (updates.prefix) {
            fields.push(`prefix = $${paramIndex++}`);
            values.push(updates.prefix);
        }
        if (updates.avatarUrl !== undefined) {
            fields.push(`avatar_url = $${paramIndex++}`);
            values.push(updates.avatarUrl);
        }
        
        fields.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(userId, guildId, name);

        const result = await this.pool.query(
            `UPDATE characters 
             SET ${fields.join(', ')} 
             WHERE user_id = $${paramIndex++} AND guild_id = $${paramIndex++} AND name = $${paramIndex++}
             RETURNING *`,
            values
        );
        return result.rows[0];
    }

    // Supprimer un personnage
    async deleteCharacter(userId, guildId, name) {
        const result = await this.pool.query(
            `DELETE FROM characters 
             WHERE user_id = $1 AND guild_id = $2 AND name = $3 
             RETURNING *`,
            [userId, guildId, name]
        );
        return result.rows[0];
    }

    // Compter les personnages d'un utilisateur
    async countUserCharacters(userId, guildId) {
        const result = await this.pool.query(
            `SELECT COUNT(*) as count FROM characters 
             WHERE user_id = $1 AND guild_id = $2`,
            [userId, guildId]
        );
        return parseInt(result.rows[0].count);
    }

    // Fermer la connexion
    async close() {
        await this.pool.end();
    }
}

module.exports = DatabaseManager;
