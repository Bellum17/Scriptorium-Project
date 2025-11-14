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

            // Créer la table des statistiques de messages
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS message_stats (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    channel_id VARCHAR(255) NOT NULL,
                    message_id VARCHAR(255) NOT NULL,
                    is_character BOOLEAN DEFAULT FALSE,
                    character_name VARCHAR(100),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(message_id)
                )
            `);

            // Index pour optimiser les requêtes de stats
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_message_stats_guild_timestamp 
                ON message_stats(guild_id, timestamp DESC)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_message_stats_channel 
                ON message_stats(channel_id, timestamp DESC)
            `);

            // Créer la table des statistiques de membres (arrivées/départs)
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS member_stats (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    event_type VARCHAR(20) NOT NULL, -- 'join' ou 'leave'
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, guild_id, event_type, timestamp)
                )
            `);

            // Index pour optimiser les requêtes de stats membres
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_member_stats_guild_timestamp 
                ON member_stats(guild_id, timestamp DESC)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_member_stats_event 
                ON member_stats(event_type, timestamp DESC)
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
        // Si userId est null, chercher uniquement par guild_id et name
        if (userId === null) {
            const result = await this.pool.query(
                `SELECT * FROM characters 
                 WHERE guild_id = $1 AND name = $2 
                 LIMIT 1`,
                [guildId, name]
            );
            return result.rows[0];
        }
        
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

    // ==================== STATISTIQUES ====================

    // Enregistrer un message pour les statistiques
    async logMessage(userId, guildId, channelId, messageId, isCharacter = false, characterName = null) {
        try {
            await this.pool.query(
                `INSERT INTO message_stats (user_id, guild_id, channel_id, message_id, is_character, character_name)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (message_id) DO NOTHING`,
                [userId, guildId, channelId, messageId, isCharacter, characterName]
            );
        } catch (error) {
            // Ignorer silencieusement les erreurs de log (ne pas bloquer le bot)
            console.error('⚠️ Erreur lors du log de message:', error.message);
        }
    }

    // Obtenir les statistiques par heure sur les dernières 24 heures (remplit les heures manquantes avec 0)
    async getMessageStatsByHour(guildId, hours = 24, channelId = null) {
        const query = channelId 
            ? `WITH hour_series AS (
                    SELECT generate_series(
                        DATE_TRUNC('hour', NOW() - INTERVAL '${hours} hours'),
                        DATE_TRUNC('hour', NOW()),
                        '1 hour'::interval
                    ) AS hour
                )
                SELECT 
                    hs.hour,
                    COALESCE(COUNT(ms.id), 0) as message_count,
                    COALESCE(COUNT(DISTINCT ms.user_id), 0) as unique_users,
                    COALESCE(COUNT(CASE WHEN ms.is_character THEN 1 END), 0) as character_messages
                FROM hour_series hs
                LEFT JOIN message_stats ms 
                    ON DATE_TRUNC('hour', ms.timestamp) = hs.hour 
                    AND ms.guild_id = $1 
                    AND ms.channel_id = $2
                GROUP BY hs.hour
                ORDER BY hs.hour ASC`
            : `WITH hour_series AS (
                    SELECT generate_series(
                        DATE_TRUNC('hour', NOW() - INTERVAL '${hours} hours'),
                        DATE_TRUNC('hour', NOW()),
                        '1 hour'::interval
                    ) AS hour
                )
                SELECT 
                    hs.hour,
                    COALESCE(COUNT(ms.id), 0) as message_count,
                    COALESCE(COUNT(DISTINCT ms.user_id), 0) as unique_users,
                    COALESCE(COUNT(CASE WHEN ms.is_character THEN 1 END), 0) as character_messages
                FROM hour_series hs
                LEFT JOIN message_stats ms 
                    ON DATE_TRUNC('hour', ms.timestamp) = hs.hour 
                    AND ms.guild_id = $1
                GROUP BY hs.hour
                ORDER BY hs.hour ASC`;

        const params = channelId ? [guildId, channelId] : [guildId];
        const result = await this.pool.query(query, params);
        return result.rows;
    }

    // Obtenir les statistiques par jour sur une période (remplit les jours manquants avec 0)
    async getMessageStatsByDay(guildId, days = 30, channelId = null) {
        const query = channelId 
            ? `WITH day_series AS (
                    SELECT generate_series(
                        DATE(NOW() - INTERVAL '${days} days'),
                        DATE(NOW()),
                        '1 day'::interval
                    ) AS date
                )
                SELECT 
                    ds.date,
                    COALESCE(COUNT(ms.id), 0) as message_count,
                    COALESCE(COUNT(DISTINCT ms.user_id), 0) as unique_users,
                    COALESCE(COUNT(CASE WHEN ms.is_character THEN 1 END), 0) as character_messages
                FROM day_series ds
                LEFT JOIN message_stats ms 
                    ON DATE(ms.timestamp) = ds.date 
                    AND ms.guild_id = $1 
                    AND ms.channel_id = $2
                GROUP BY ds.date
                ORDER BY ds.date ASC`
            : `WITH day_series AS (
                    SELECT generate_series(
                        DATE(NOW() - INTERVAL '${days} days'),
                        DATE(NOW()),
                        '1 day'::interval
                    ) AS date
                )
                SELECT 
                    ds.date,
                    COALESCE(COUNT(ms.id), 0) as message_count,
                    COALESCE(COUNT(DISTINCT ms.user_id), 0) as unique_users,
                    COALESCE(COUNT(CASE WHEN ms.is_character THEN 1 END), 0) as character_messages
                FROM day_series ds
                LEFT JOIN message_stats ms 
                    ON DATE(ms.timestamp) = ds.date 
                    AND ms.guild_id = $1
                GROUP BY ds.date
                ORDER BY ds.date ASC`;

        const params = channelId ? [guildId, channelId] : [guildId];
        const result = await this.pool.query(query, params);
        return result.rows;
    }

    // Obtenir les statistiques totales
    async getTotalStats(guildId, days = 30) {
        const result = await this.pool.query(
            `SELECT 
                COUNT(*) as total_messages,
                COUNT(DISTINCT user_id) as total_users,
                COUNT(DISTINCT channel_id) as total_channels,
                COUNT(CASE WHEN is_character THEN 1 END) as character_messages
            FROM message_stats
            WHERE guild_id = $1 
              AND timestamp >= NOW() - INTERVAL '${days} days'`,
            [guildId]
        );
        return result.rows[0];
    }

    // Obtenir les statistiques d'un utilisateur par heure
    async getUserMessageStatsByHour(guildId, userId, hours = 24) {
        const query = `WITH hour_series AS (
                SELECT generate_series(
                    DATE_TRUNC('hour', NOW() - INTERVAL '${hours} hours'),
                    DATE_TRUNC('hour', NOW()),
                    '1 hour'::interval
                ) AS hour
            )
            SELECT 
                hs.hour,
                COALESCE(COUNT(ms.id), 0) as message_count
            FROM hour_series hs
            LEFT JOIN message_stats ms 
                ON DATE_TRUNC('hour', ms.timestamp) = hs.hour 
                AND ms.guild_id = $1
                AND ms.user_id = $2
            GROUP BY hs.hour
            ORDER BY hs.hour ASC`;

        const result = await this.pool.query(query, [guildId, userId]);
        return result.rows;
    }

    // Obtenir les statistiques d'un utilisateur par jour
    async getUserMessageStatsByDay(guildId, userId, days = 30) {
        const query = `WITH day_series AS (
                SELECT generate_series(
                    DATE(NOW() - INTERVAL '${days} days'),
                    DATE(NOW()),
                    '1 day'::interval
                ) AS date
            )
            SELECT 
                ds.date,
                COALESCE(COUNT(ms.id), 0) as message_count
            FROM day_series ds
            LEFT JOIN message_stats ms 
                ON DATE(ms.timestamp) = ds.date 
                AND ms.guild_id = $1
                AND ms.user_id = $2
            GROUP BY ds.date
            ORDER BY ds.date ASC`;

        const result = await this.pool.query(query, [guildId, userId]);
        return result.rows;
    }

    // Obtenir le top des utilisateurs les plus actifs
    async getTopUsers(guildId, limit = 10, days = 30) {
        const result = await this.pool.query(
            `SELECT 
                user_id,
                COUNT(*) as message_count
            FROM message_stats
            WHERE guild_id = $1 
              AND timestamp >= NOW() - INTERVAL '${days} days'
            GROUP BY user_id
            ORDER BY message_count DESC
            LIMIT $2`,
            [guildId, limit]
        );
        return result.rows;
    }

    // Obtenir le top des personnages les plus utilisés
    async getTopCharacters(guildId, limit = 10, days = 30) {
        const result = await this.pool.query(
            `SELECT 
                character_name,
                COUNT(*) as message_count
            FROM message_stats
            WHERE guild_id = $1 
              AND is_character = TRUE
              AND timestamp >= NOW() - INTERVAL '${days} days'
            GROUP BY character_name
            ORDER BY message_count DESC
            LIMIT $2`,
            [guildId, limit]
        );
        return result.rows;
    }

    // Logger un événement membre (arrivée ou départ)
    async logMemberEvent(userId, guildId, eventType) {
        try {
            await this.pool.query(
                `INSERT INTO member_stats (user_id, guild_id, event_type)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, guild_id, event_type, timestamp) DO NOTHING`,
                [userId, guildId, eventType]
            );
        } catch (error) {
            console.error('⚠️ Erreur lors du log d\'événement membre:', error.message);
        }
    }

    // Obtenir les statistiques de membres par heure (arrivées et départs)
    async getMemberStatsByHour(guildId, hours = 24) {
        const query = `WITH hour_series AS (
                SELECT generate_series(
                    DATE_TRUNC('hour', NOW() - INTERVAL '${hours} hours'),
                    DATE_TRUNC('hour', NOW()),
                    '1 hour'::interval
                ) AS hour
            )
            SELECT 
                hs.hour,
                COALESCE(COUNT(CASE WHEN ms.event_type = 'join' THEN 1 END), 0) as joins,
                COALESCE(COUNT(CASE WHEN ms.event_type = 'leave' THEN 1 END), 0) as leaves
            FROM hour_series hs
            LEFT JOIN member_stats ms 
                ON DATE_TRUNC('hour', ms.timestamp) = hs.hour 
                AND ms.guild_id = $1
            GROUP BY hs.hour
            ORDER BY hs.hour ASC`;

        const result = await this.pool.query(query, [guildId]);
        return result.rows;
    }

    // Obtenir les statistiques de membres par jour (arrivées et départs)
    async getMemberStatsByDay(guildId, days = 30) {
        const query = `WITH day_series AS (
                SELECT generate_series(
                    DATE(NOW() - INTERVAL '${days} days'),
                    DATE(NOW()),
                    '1 day'::interval
                ) AS date
            )
            SELECT 
                ds.date,
                COALESCE(COUNT(CASE WHEN ms.event_type = 'join' THEN 1 END), 0) as joins,
                COALESCE(COUNT(CASE WHEN ms.event_type = 'leave' THEN 1 END), 0) as leaves
            FROM day_series ds
            LEFT JOIN member_stats ms 
                ON DATE(ms.timestamp) = ds.date 
                AND ms.guild_id = $1
            GROUP BY ds.date
            ORDER BY ds.date ASC`;

        const result = await this.pool.query(query, [guildId]);
        return result.rows;
    }

    // Fermer la connexion
    async close() {
        await this.pool.end();
    }
}

module.exports = DatabaseManager;
