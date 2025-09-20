const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
app.use(bodyParser.json());

// Configuration 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "nakamaverifytoken";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "nakamabot-data";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT || 5000}`;
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Mémoire du bot (stockage local temporaire + sauvegarde permanente GitHub + SQLite)
const userMemory = new Map();
const userList = new Set();
const userLastImage = new Map();
const clanData = new Map(); // Stockage des données spécifiques aux commandes

// ✅ NOUVEAU: Référence vers la commande rank pour le système d'expérience
let rankCommand = null;

// 🆕 AJOUT: Gestion des messages tronqués avec chunks
const truncatedMessages = new Map(); // senderId -> { fullMessage, lastSentPart }

// ✅ NOUVEAU: Instance de base de données SQLite
let db = null;

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

// === GESTION DE LA BASE DE DONNÉES SQLITE ===

async function initializeDatabase() {
    try {
        const dbPath = path.join(__dirname, 'nakamabot.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        log.info(`📂 Base de données SQLite initialisée: ${dbPath}`);

        // Créer les tables si elles n'existent pas
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                first_seen TEXT,
                last_active TEXT,
                message_count INTEGER DEFAULT 0,
                image_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                message_type TEXT,
                content TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                image_url TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS user_experience (
                user_id TEXT PRIMARY KEY,
                experience INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                last_exp_gain TEXT,
                total_messages INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS clans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                description TEXT,
                creator_id TEXT,
                member_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS clan_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clan_id INTEGER,
                user_id TEXT,
                role TEXT DEFAULT 'member',
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (clan_id) REFERENCES clans (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS truncated_messages (
                user_id TEXT PRIMARY KEY,
                full_message TEXT,
                last_sent_part TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS bot_data (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);

        log.info("✅ Tables SQLite créées/vérifiées avec succès");
        return true;
    } catch (error) {
        log.error(`❌ Erreur initialisation SQLite: ${error.message}`);
        return false;
    }
}

// Sauvegarder un utilisateur dans SQLite
async function saveUserToDb(userId) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT OR IGNORE INTO users (id, first_seen, last_active) VALUES (?, ?, ?)`,
            [userId, now, now]
        );
        
        await db.run(
            `UPDATE users SET last_active = ? WHERE id = ?`,
            [now, userId]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde utilisateur SQLite: ${error.message}`);
    }
}

// Sauvegarder une conversation dans SQLite
async function saveConversationToDb(userId, messageType, content) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT INTO conversations (user_id, message_type, content, timestamp) VALUES (?, ?, ?, ?)`,
            [userId, messageType, content.substring(0, 2000), now]
        );
        
        // Incrémenter le compteur de messages
        if (messageType === 'user') {
            await db.run(
                `UPDATE users SET message_count = message_count + 1 WHERE id = ?`,
                [userId]
            );
        }
    } catch (error) {
        log.error(`❌ Erreur sauvegarde conversation SQLite: ${error.message}`);
    }
}

// Sauvegarder une image dans SQLite
async function saveImageToDb(userId, imageUrl) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT INTO images (user_id, image_url, timestamp) VALUES (?, ?, ?)`,
            [userId, imageUrl, now]
        );
        
        // Incrémenter le compteur d'images
        await db.run(
            `UPDATE users SET image_count = image_count + 1 WHERE id = ?`,
            [userId]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde image SQLite: ${error.message}`);
    }
}

// Sauvegarder l'expérience utilisateur dans SQLite
async function saveUserExpToDb(userId, experience, level) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT OR REPLACE INTO user_experience (user_id, experience, level, last_exp_gain, total_messages) 
             VALUES (?, ?, ?, ?, (SELECT COALESCE(message_count, 0) FROM users WHERE id = ?))`,
            [userId, experience, level, now, userId]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde expérience SQLite: ${error.message}`);
    }
}

// Sauvegarder un message tronqué dans SQLite
async function saveTruncatedToDb(userId, fullMessage, lastSentPart) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT OR REPLACE INTO truncated_messages (user_id, full_message, last_sent_part, timestamp) VALUES (?, ?, ?, ?)`,
            [userId, fullMessage, lastSentPart, now]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde message tronqué SQLite: ${error.message}`);
    }
}

// Charger les données depuis SQLite
async function loadDataFromDb() {
    if (!db) return;
    
    try {
        // Charger les utilisateurs
        const users = await db.all('SELECT id FROM users');
        users.forEach(user => userList.add(user.id));
        log.info(`✅ ${users.length} utilisateurs chargés depuis SQLite`);
        
        // Charger les conversations récentes (dernières 8 par utilisateur)
        const conversations = await db.all(`
            SELECT user_id, message_type, content, timestamp 
            FROM (
                SELECT user_id, message_type, content, timestamp,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
                FROM conversations
            ) WHERE rn <= 8
            ORDER BY user_id, timestamp ASC
        `);
        
        const conversationMap = new Map();
        conversations.forEach(conv => {
            if (!conversationMap.has(conv.user_id)) {
                conversationMap.set(conv.user_id, []);
            }
            conversationMap.get(conv.user_id).push({
                type: conv.message_type,
                content: conv.content,
                timestamp: conv.timestamp
            });
        });
        
        conversationMap.forEach((convs, userId) => {
            userMemory.set(userId, convs);
        });
        
        log.info(`✅ ${conversationMap.size} conversations chargées depuis SQLite`);
        
        // Charger les dernières images
        const images = await db.all(`
            SELECT user_id, image_url 
            FROM (
                SELECT user_id, image_url,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
                FROM images
            ) WHERE rn = 1
        `);
        
        images.forEach(img => {
            userLastImage.set(img.user_id, img.image_url);
        });
        
        log.info(`✅ ${images.length} dernières images chargées depuis SQLite`);
        
        // Charger les messages tronqués
        const truncated = await db.all('SELECT user_id, full_message, last_sent_part FROM truncated_messages');
        truncated.forEach(trunc => {
            truncatedMessages.set(trunc.user_id, {
                fullMessage: trunc.full_message,
                lastSentPart: trunc.last_sent_part
            });
        });
        
        log.info(`✅ ${truncated.length} messages tronqués chargés depuis SQLite`);
        
    } catch (error) {
        log.error(`❌ Erreur chargement SQLite: ${error.message}`);
    }
}

// Obtenir des statistiques depuis SQLite
async function getDbStats() {
    if (!db) return {};
    
    try {
        const stats = {};
        
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        stats.total_users_db = userCount.count;
        
        const messageCount = await db.get('SELECT COUNT(*) as count FROM conversations');
        stats.total_messages_db = messageCount.count;
        
        const imageCount = await db.get('SELECT COUNT(*) as count FROM images');
        stats.total_images_db = imageCount.count;
        
        const expCount = await db.get('SELECT COUNT(*) as count FROM user_experience WHERE level > 1');
        stats.users_with_levels_db = expCount.count;
        
        const truncatedCount = await db.get('SELECT COUNT(*) as count FROM truncated_messages');
        stats.truncated_messages_db = truncatedCount.count;
        
        return stats;
    } catch (error) {
        log.error(`❌ Erreur statistiques SQLite: ${error.message}`);
        return {};
    }
}

// === FONCTIONS DE GESTION DES MESSAGES TRONQUÉS ===

/**
 * Divise un message en chunks de taille appropriée pour Messenger
 * @param {string} text - Texte complet
 * @param {number} maxLength - Taille maximale par chunk (défaut: 2000)
 * @returns {Array} - Array des chunks
 */
function splitMessageIntoChunks(text, maxLength = 2000) {
    if (!text || text.length <= maxLength) {
        return [text];
    }
    
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        // Si ajouter cette ligne dépasse la limite
        if (currentChunk.length + line.length + 1 > maxLength) {
            // Si le chunk actuel n'est pas vide, le sauvegarder
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            // Si la ligne elle-même est trop longue, la couper
            if (line.length > maxLength) {
                const words = line.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    if (currentLine.length + word.length + 1 > maxLength) {
                        if (currentLine.trim()) {
                            chunks.push(currentLine.trim());
                            currentLine = word;
                        if (missingVars.length > 0) {
        log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration complète OK");
    }

    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    const dbStats = await getDbStats();

    log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
    log.info(`👥 ${userList.size} utilisateurs en mémoire`);
    log.info(`💬 ${userMemory.size} conversations en mémoire`);
    log.info(`🖼️ ${userLastImage.size} images en mémoire`);
    log.info(`🏰 ${clanCount} clans en mémoire`);
    log.info(`⭐ ${expDataCount} utilisateurs avec expérience`);
    log.info(`📝 ${truncatedMessages.size} conversations tronquées en cours`);
    log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
    log.info(`📂 Repository: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
    log.info(`🗃️ Base SQLite: ${dbStats.total_users_db || 0} users, ${dbStats.total_messages_db || 0} messages`);
    log.info(`🌐 Serveur sur le port ${PORT}`);
    
    startAutoSave();
    
    log.info("🎉 NakamaBot Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("💾 Sauvegarde automatique GitHub activée");
        log.info("🗃️ Base de données SQLite prête");
        log.info("📏 Gestion intelligente des messages longs activée");
        log.info(`📊 Dashboard: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    });
}

// Fonction de nettoyage lors de l'arrêt
async function gracefulShutdown() {
    log.info("🛑 Arrêt du bot avec tendresse...");
    
    if (saveInterval) {
        clearInterval(saveInterval);
        log.info("⏹️ Sauvegarde automatique arrêtée");
    }
    
    try {
        log.info("💾 Sauvegarde finale des données sur GitHub...");
        await saveDataToGitHub();
        log.info("✅ Données sauvegardées avec succès !");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    
    // Nettoyage final des messages tronqués
    const truncatedCount = truncatedMessages.size;
    if (truncatedCount > 0) {
        log.info(`🧹 Nettoyage de ${truncatedCount} conversations tronquées en cours...`);
        truncatedMessages.clear();
        
        // ✅ NOUVEAU: Nettoyer aussi dans SQLite
        if (db) {
            try {
                await db.run('DELETE FROM truncated_messages');
                log.info("🗃️ Messages tronqués nettoyés de SQLite");
            } catch (error) {
                log.debug(`Erreur nettoyage SQLite: ${error.message}`);
            }
        }
    }
    
    // ✅ NOUVEAU: Fermer la connexion SQLite proprement
    if (db) {
        try {
            await db.close();
            log.info("🗃️ Connexion SQLite fermée proprement");
        } catch (error) {
            log.debug(`Erreur fermeture SQLite: ${error.message}`);
        }
    }
    
    log.info("👋 Au revoir ! Données sauvegardées sur GitHub et SQLite !");
    log.info(`📂 Repository: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    process.exit(0);
}

// Gestion propre de l'arrêt
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Gestion des erreurs non capturées
process.on('uncaughtException', async (error) => {
    log.error(`❌ Erreur non capturée: ${error.message}`);
    await gracefulShutdown();
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error(`❌ Promesse rejetée: ${reason}`);
    await gracefulShutdown();
});

// 🆕 NETTOYAGE PÉRIODIQUE: Nettoyer les messages tronqués anciens (plus de 24h)
setInterval(async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
    let cleanedCount = 0;
    
    // Nettoyer en mémoire
    for (const [userId, data] of truncatedMessages.entries()) {
        // Si le message n'a pas de timestamp ou est trop ancien
        if (!data.timestamp || (now - new Date(data.timestamp).getTime() > oneDayMs)) {
            truncatedMessages.delete(userId);
            cleanedCount++;
        }
    }
    
    // ✅ NOUVEAU: Nettoyer aussi dans SQLite
    if (db && cleanedCount > 0) {
        try {
            const result = await db.run(
                `DELETE FROM truncated_messages WHERE timestamp < datetime('now', '-1 day')`
            );
            log.info(`🧹 Nettoyage automatique SQLite: ${result.changes} messages tronqués expirés supprimés`);
        } catch (error) {
            log.debug(`Erreur nettoyage SQLite automatique: ${error.message}`);
        }
    }
    
    if (cleanedCount > 0) {
        log.info(`🧹 Nettoyage automatique: ${cleanedCount} conversations tronquées expirées supprimées`);
        saveDataImmediate(); // Sauvegarder le nettoyage
    }
}, 60 * 60 * 1000); // Vérifier toutes les heures

// Démarrer le bot
startBot().catch(error => {
    log.error(`❌ Erreur démarrage: ${error.message}`);
    process.exit(1);
}); {
                            // Mot unique trop long, le couper brutalement
                            chunks.push(word.substring(0, maxLength - 3) + '...');
                            currentLine = word.substring(maxLength - 3);
                        }
                    } else {
                        currentLine += (currentLine ? ' ' : '') + word;
                    }
                }
                
                if (currentLine.trim()) {
                    currentChunk = currentLine;
                }
            } else {
                currentChunk = line;
            }
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    
    // Ajouter le dernier chunk s'il n'est pas vide
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
}

/**
 * Détecte si l'utilisateur demande la suite d'un message tronqué
 * @param {string} message - Message de l'utilisateur
 * @returns {boolean} - True si c'est une demande de continuation
 */
function isContinuationRequest(message) {
    const lowerMessage = message.toLowerCase().trim();
    const continuationPatterns = [
        /^(continue|continuer?)$/,
        /^(suite|la suite)$/,
        /^(après|ensuite)$/,
        /^(plus|encore)$/,
        /^(next|suivant)$/,
        /^\.\.\.$/,
        /^(termine|fini[sr]?)$/
    ];
    
    return continuationPatterns.some(pattern => pattern.test(lowerMessage));
}

// === GESTION GITHUB API ===

// Encoder en base64 pour GitHub
function encodeBase64(content) {
    return Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
}

// Décoder depuis base64 GitHub
function decodeBase64(content) {
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

// URL de base pour l'API GitHub
const getGitHubApiUrl = (filename) => {
    return `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
};

// Créer le repository GitHub si nécessaire
async function createGitHubRepo() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.error("❌ GITHUB_TOKEN ou GITHUB_USERNAME manquant pour créer le repo");
        return false;
    }

    try {
        const checkResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            }
        );
        
        if (checkResponse.status === 200) {
            log.info(`✅ Repository ${GITHUB_REPO} existe déjà`);
            return true;
        }
    } catch (error) {
        if (error.response?.status === 404) {
            try {
                const createResponse = await axios.post(
                    'https://api.github.com/user/repos',
                    {
                        name: GITHUB_REPO,
                        description: 'Sauvegarde des données NakamaBot avec SQLite - Créé automatiquement',
                        private: true,
                        auto_init: true
                    },
                    {
                        headers: {
                            'Authorization': `token ${GITHUB_TOKEN}`,
                            'Accept': 'application/vnd.github.v3+json'
                        },
                        timeout: 15000
                    }
                );

                if (createResponse.status === 201) {
                    log.info(`🎉 Repository ${GITHUB_REPO} créé avec succès !`);
                    log.info(`📝 URL: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
                    return true;
                }
            } catch (createError) {
                log.error(`❌ Erreur création repository: ${createError.message}`);
                return false;
            }
        } else {
            log.error(`❌ Erreur vérification repository: ${error.message}`);
            return false;
        }
    }

    return false;
}

// Variable pour éviter les sauvegardes simultanées
let isSaving = false;
let saveQueue = [];

// === SAUVEGARDE GITHUB AVEC SUPPORT SQLITE + CLANS ET EXPÉRIENCE ===
async function saveDataToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.debug("🔄 Pas de sauvegarde GitHub (config manquante)");
        return;
    }

    if (isSaving) {
        log.debug("⏳ Sauvegarde déjà en cours, ajout à la queue");
        return new Promise((resolve) => {
            saveQueue.push(resolve);
        });
    }

    isSaving = true;

    try {
        log.debug(`💾 Tentative de sauvegarde sur GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        // Obtenir les statistiques de la DB
        const dbStats = await getDbStats();
        
        const dataToSave = {
            userList: Array.from(userList),
            userMemory: Object.fromEntries(userMemory),
            userLastImage: Object.fromEntries(userLastImage),
            
            // ✅ NOUVEAU: Sauvegarder les données d'expérience
            userExp: rankCommand ? rankCommand.getExpData() : {},
            
            // 🆕 NOUVEAU: Sauvegarder les messages tronqués
            truncatedMessages: Object.fromEntries(truncatedMessages),
            
            // Données des clans et autres commandes
            clanData: commandContext.clanData || null,
            commandData: Object.fromEntries(clanData),
            
            // ✅ NOUVEAU: Statistiques SQLite
            databaseStats: dbStats,
            
            lastUpdate: new Date().toISOString(),
            version: "4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation",
            totalUsers: userList.size,
            totalConversations: userMemory.size,
            totalImages: userLastImage.size,
            totalTruncated: truncatedMessages.size,
            totalClans: commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0,
            totalUsersWithExp: rankCommand ? Object.keys(rankCommand.getExpData()).length : 0,
            storage: {
                memory: {
                    users: userList.size,
                    conversations: userMemory.size,
                    images: userLastImage.size
                },
                database: dbStats
            },
            bot: "NakamaBot",
            creator: "Durand"
        };

        const commitData = {
            message: `🤖 Sauvegarde automatique NakamaBot + SQLite - ${new Date().toISOString()}`,
            content: encodeBase64(dataToSave)
        };

        let maxRetries = 3;
        let success = false;

        for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
            try {
                const existingResponse = await axios.get(url, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 10000
                });

                if (existingResponse.data?.sha) {
                    commitData.sha = existingResponse.data.sha;
                }

                const response = await axios.put(url, commitData, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 15000
                });

                if (response.status === 200 || response.status === 201) {
                    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
                    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
                    log.info(`💾 Données sauvegardées sur GitHub (${userList.size} users, ${userMemory.size} convs, ${userLastImage.size} imgs, ${clanCount} clans, ${expDataCount} exp, ${truncatedMessages.size} trunc) + SQLite`);
                    success = true;
                } else {
                    log.error(`❌ Erreur sauvegarde GitHub: ${response.status}`);
                }

            } catch (retryError) {
                if (retryError.response?.status === 409 && attempt < maxRetries) {
                    log.warning(`⚠️ Conflit SHA détecté (409), tentative ${attempt}/${maxRetries}, retry dans 1s...`);
                    await sleep(1000);
                    continue;
                } else if (retryError.response?.status === 404 && attempt === 1) {
                    log.debug("📝 Premier fichier, pas de SHA nécessaire");
                    delete commitData.sha;
                    continue;
                } else {
                    throw retryError;
                }
            }
        }

        if (!success) {
            log.error("❌ Échec de sauvegarde après plusieurs tentatives");
        }

    } catch (error) {
        if (error.response?.status === 404) {
            log.error("❌ Repository GitHub introuvable pour la sauvegarde (404)");
            log.error(`🔍 Repository utilisé: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide pour la sauvegarde (401)");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub pour la sauvegarde (403)");
        } else if (error.response?.status === 409) {
            log.warning("⚠️ Conflit SHA persistant - sauvegarde ignorée pour éviter les blocages");
        } else {
            log.error(`❌ Erreur sauvegarde GitHub: ${error.message}`);
        }
    } finally {
        isSaving = false;
        
        const queueCallbacks = [...saveQueue];
        saveQueue = [];
        queueCallbacks.forEach(callback => callback());
    }
}

// === CHARGEMENT GITHUB AVEC SUPPORT SQLITE + CLANS ET EXPÉRIENCE ===
async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub manquante, utilisation du stockage SQLite + temporaire uniquement");
        return;
    }

    try {
        log.info(`🔍 Tentative de chargement depuis GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        if (response.status === 200 && response.data.content) {
            const data = decodeBase64(response.data.content);
            
            // Charger userList
            if (data.userList && Array.isArray(data.userList)) {
                data.userList.forEach(userId => userList.add(userId));
                log.info(`✅ ${data.userList.length} utilisateurs chargés depuis GitHub`);
            }

            // Charger userMemory
            if (data.userMemory && typeof data.userMemory === 'object') {
                Object.entries(data.userMemory).forEach(([userId, memory]) => {
                    if (Array.isArray(memory)) {
                        userMemory.set(userId, memory);
                    }
                });
                log.info(`✅ ${Object.keys(data.userMemory).length} conversations chargées depuis GitHub`);
            }

            // Charger userLastImage
            if (data.userLastImage && typeof data.userLastImage === 'object') {
                Object.entries(data.userLastImage).forEach(([userId, imageUrl]) => {
                    userLastImage.set(userId, imageUrl);
                });
                log.info(`✅ ${Object.keys(data.userLastImage).length} images chargées depuis GitHub`);
            }

            // 🆕 NOUVEAU: Charger les messages tronqués
            if (data.truncatedMessages && typeof data.truncatedMessages === 'object') {
                Object.entries(data.truncatedMessages).forEach(([userId, truncData]) => {
                    if (truncData && typeof truncData === 'object') {
                        truncatedMessages.set(userId, truncData);
                    }
                });
                log.info(`✅ ${Object.keys(data.truncatedMessages).length} messages tronqués chargés depuis GitHub`);
            }

            // ✅ NOUVEAU: Charger les données d'expérience
            if (data.userExp && typeof data.userExp === 'object' && rankCommand) {
                rankCommand.loadExpData(data.userExp);
                log.info(`✅ ${Object.keys(data.userExp).length} données d'expérience chargées depuis GitHub`);
            }

            // Charger les données des clans
            if (data.clanData && typeof data.clanData === 'object') {
                commandContext.clanData = data.clanData;
                const clanCount = Object.keys(data.clanData.clans || {}).length;
                log.info(`✅ ${clanCount} clans chargés depuis GitHub`);
            }

            // Charger autres données de commandes
            if (data.commandData && typeof data.commandData === 'object') {
                Object.entries(data.commandData).forEach(([key, value]) => {
                    clanData.set(key, value);
                });
                log.info(`✅ ${Object.keys(data.commandData).length} données de commandes chargées depuis GitHub`);
            }

            log.info("🎉 Données chargées avec succès depuis GitHub !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde trouvée sur GitHub - Première utilisation");
            log.info("🔧 Création du fichier de sauvegarde initial...");
            
            const repoCreated = await createGitHubRepo();
            if (repoCreated) {
                await saveDataToGitHub();
            }
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide (401) - Vérifiez votre GITHUB_TOKEN");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub (403) - Vérifiez les permissions de votre token");
        } else {
            log.error(`❌ Erreur chargement GitHub: ${error.message}`);
            if (error.response) {
                log.error(`📊 Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
        }
    }
}

// Sauvegarder automatiquement toutes les 5 minutes
let saveInterval;
function startAutoSave() {
    if (saveInterval) {
        clearInterval(saveInterval);
    }
    
    saveInterval = setInterval(async () => {
        await saveDataToGitHub();
    }, 5 * 60 * 1000); // 5 minutes
    
    log.info("🔄 Sauvegarde automatique GitHub activée (toutes les 5 minutes)");
}

// Sauvegarder lors de changements importants (non-bloquant)
async function saveDataImmediate() {
    saveDataToGitHub().catch(err => 
        log.debug(`🔄 Sauvegarde en arrière-plan: ${err.message}`)
    );
}

// === UTILITAIRES ===

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Appel API Mistral avec retry
async function callMistralAPI(messages, maxTokens = 200, temperature = 0.7) {
    if (!MISTRAL_API_KEY) {
        return null;
    }
    
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
    };
    
    const data = {
        model: "mistral-small-latest",
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature
    };
    
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await axios.post(
                "https://api.mistral.ai/v1/chat/completions",
                data,
                { headers, timeout: 30000 }
            );
            
            if (response.status === 200) {
                return response.data.choices[0].message.content;
            } else if (response.status === 401) {
                log.error("❌ Clé API Mistral invalide");
                return null;
            } else {
                if (attempt === 0) {
                    await sleep(2000);
                    continue;
                }
                return null;
            }
        } catch (error) {
            if (attempt === 0) {
                await sleep(2000);
                continue;
            }
            log.error(`❌ Erreur Mistral: ${error.message}`);
            return null;
        }
    }
    
    return null;
}

// Analyser une image avec l'API Vision de Mistral
async function analyzeImageWithVision(imageUrl) {
    if (!MISTRAL_API_KEY) {
        return null;
    }
    
    try {
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${MISTRAL_API_KEY}`
        };
        
        const messages = [{
            role: "user",
            content: [
                {
                    type: "text",
                    text: "Décris en détail ce que tu vois dans cette image en français. Sois précise et descriptive, comme si tu expliquais à un(e) ami(e). Maximum 300 mots avec des emojis mignons. 💕"
                },
                {
                    type: "image_url",
                    image_url: {
                        url: imageUrl
                    }
                }
            ]
        }];
        
        const data = {
            model: "pixtral-12b-2409",
            messages: messages,
            max_tokens: 400,
            temperature: 0.3
        };
        
        const response = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            data,
            { headers, timeout: 30000 }
        );
        
        if (response.status === 200) {
            return response.data.choices[0].message.content;
        } else {
            log.error(`❌ Erreur Vision API: ${response.status}`);
            return null;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse image: ${error.message}`);
        return null;
    }
}

// Recherche web simulée
async function webSearch(query) {
    try {
        const searchContext = `Recherche web pour '${query}' en 2025. Je peux répondre avec mes connaissances de 2025.`;
        const messages = [{
            role: "system",
            content: `Tu es NakamaBot, une assistante IA très gentille et amicale qui aide avec les recherches. Nous sommes en 2025. Réponds à cette recherche: '${query}' avec tes connaissances de 2025. Si tu ne sais pas, dis-le gentiment. Réponds en français avec une personnalité amicale et bienveillante, maximum 300 caractères.`
        }];
        
        return await callMistralAPI(messages, 150, 0.3);
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        return "Oh non ! Une petite erreur de recherche... Désolée ! 💕";
    }
}

// ✅ GESTION CORRIGÉE DE LA MÉMOIRE - ÉVITER LES DOUBLONS + SAUVEGARDE SQLITE
function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        log.debug("❌ Paramètres manquants pour addToMemory");
        return;
    }
    
    if (content.length > 1500) {
        content = content.substring(0, 1400) + "...[tronqué]";
    }
    
    if (!userMemory.has(userId)) {
        userMemory.set(userId, []);
    }
    
    const memory = userMemory.get(userId);
    
    // ✅ NOUVELLE LOGIQUE: Vérifier les doublons
    if (memory.length > 0) {
        const lastMessage = memory[memory.length - 1];
        
        if (lastMessage.type === msgType && lastMessage.content === content) {
            log.debug(`🔄 Doublon évité pour ${userId}: ${msgType.substring(0, 50)}...`);
            return;
        }
        
        if (msgType === 'assistant' && lastMessage.type === 'assistant') {
            const similarity = calculateSimilarity(lastMessage.content, content);
            if (similarity > 0.8) {
                log.debug(`🔄 Doublon assistant évité (similarité: ${Math.round(similarity * 100)}%)`);
                return;
            }
        }
    }
    
    memory.push({
        type: msgType,
        content: content,
        timestamp: new Date().toISOString()
    });
    
    if (memory.length > 8) {
        memory.shift();
    }
    
    log.debug(`💭 Ajouté en mémoire [${userId}]: ${msgType} (${content.length} chars)`);
    
    // ✅ NOUVEAU: Sauvegarder aussi dans SQLite
    saveConversationToDb(userId, msgType, content);
    
    saveDataImmediate().catch(err => 
        log.debug(`🔄 Erreur sauvegarde mémoire: ${err.message}`)
    );
}

// ✅ FONCTION UTILITAIRE: Calculer la similarité entre deux textes
function calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const norm1 = normalize(text1);
    const norm2 = normalize(text2);
    
    if (norm1 === norm2) return 1;
    
    const words1 = new Set(norm1.split(/\s+/));
    const words2 = new Set(norm2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

function getMemoryContext(userId) {
    const context = [];
    const memory = userMemory.get(userId) || [];
    
    for (const msg of memory) {
        const role = msg.type === 'user' ? 'user' : 'assistant';
        context.push({ role, content: msg.content });
    }
    
    return context;
}

function isAdmin(userId) {
    return ADMIN_IDS.has(String(userId));
}

// === FONCTIONS D'ENVOI AVEC GESTION DE TRONCATURE + SQLITE ===

async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
    }
    
    // 🆕 GESTION INTELLIGENTE DES MESSAGES LONGS + SQLITE
    if (text.length > 6000) {
        log.info(`📏 Message long détecté (${text.length} chars) pour ${recipientId} - Division en chunks`);
        
        const chunks = splitMessageIntoChunks(text, 2000);
        
        if (chunks.length > 1) {
            // Envoyer le premier chunk avec indicateur de continuation
            const firstChunk = chunks[0] + "\n\n📝 *Tape \"continue\" pour la suite...*";
            
            // Sauvegarder l'état de troncature en mémoire et SQLite
            truncatedMessages.set(String(recipientId), {
                fullMessage: text,
                lastSentPart: chunks[0]
            });
            
            // ✅ NOUVEAU: Sauvegarder aussi dans SQLite
            saveTruncatedToDb(String(recipientId), text, chunks[0]);
            
            // Sauvegarder immédiatement
            saveDataImmediate();
            
            return await sendSingleMessage(recipientId, firstChunk);
        }
    }
    
    // Message normal
    return await sendSingleMessage(recipientId, text);
}

async function sendSingleMessage(recipientId, text) {
    let finalText = text;
    if (finalText.length > 6000 && !finalText.includes("✨ [Message Trop long]")) {
        finalText = finalText.substring(0, 5950) + "...\n✨ [Message Trop long]";
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: { text: finalText }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 15000
            }
        );
        
        if (response.status === 200) {
            return { success: true };
        } else {
            log.error(`❌ Erreur Facebook API: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`❌ Erreur envoi: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function sendImageMessage(recipientId, imageUrl, caption = "") {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!imageUrl) {
        log.warning("⚠️ URL d'image vide");
        return { success: false, error: "Empty image URL" };
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl,
                    is_reusable: true
                }
            }
        }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 20000
            }
        );
        
        if (response.status === 200) {
            if (caption) {
                await sleep(500);
                return await sendMessage(recipientId, caption);
            }
            return { success: true };
        } else {
            log.error(`❌ Erreur envoi image: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`❌ Erreur envoi image: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// === CHARGEMENT DES COMMANDES ===

const COMMANDS = new Map();

// === CONTEXTE DES COMMANDES AVEC SUPPORT SQLITE + CLANS ET EXPÉRIENCE ===
const commandContext = {
    // Variables globales
    VERIFY_TOKEN,
    PAGE_ACCESS_TOKEN,
    MISTRAL_API_KEY,
    GITHUB_TOKEN,
    GITHUB_USERNAME,
    GITHUB_REPO,
    ADMIN_IDS,
    userMemory,
    userList,
    userLastImage,
    
    // ✅ AJOUT: Données persistantes pour les commandes
    clanData: null, // Sera initialisé par les commandes
    commandData: clanData, // Map pour autres données de commandes
    
    // 🆕 AJOUT: Gestion des messages tronqués
    truncatedMessages,
    
    // ✅ NOUVEAU: Base de données SQLite
    db,
    saveUserToDb,
    saveConversationToDb,
    saveImageToDb,
    saveUserExpToDb,
    saveTruncatedToDb,
    getDbStats,
    
    // Fonctions utilitaires
    log,
    sleep,
    getRandomInt,
    callMistralAPI,
    analyzeImageWithVision,
    webSearch,
    addToMemory,
    getMemoryContext,
    isAdmin,
    sendMessage,
    sendImageMessage,
    
    // 🆕 AJOUT: Fonctions de gestion de troncature
    splitMessageIntoChunks,
    isContinuationRequest,
    
    // Fonctions de sauvegarde GitHub
    saveDataToGitHub,
    saveDataImmediate,
    loadDataFromGitHub,
    createGitHubRepo
};

// ✅ FONCTION loadCommands MODIFIÉE pour capturer la commande rank
function loadCommands() {
    const commandsDir = path.join(__dirname, 'Cmds');
    
    if (!fs.existsSync(commandsDir)) {
        log.error("❌ Dossier 'Cmds' introuvable");
        return;
    }
    
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    
    log.info(`🔍 Chargement de ${commandFiles.length} commandes...`);
    
    for (const file of commandFiles) {
        try {
            const commandPath = path.join(commandsDir, file);
            const commandName = path.basename(file, '.js');
            
            delete require.cache[require.resolve(commandPath)];
            
            const commandModule = require(commandPath);
            
            if (typeof commandModule !== 'function') {
                log.error(`❌ ${file} doit exporter une fonction`);
                continue;
            }
            
            COMMANDS.set(commandName, commandModule);
            
            // ✅ NOUVEAU: Capturer la commande rank pour l'expérience
            if (commandName === 'rank') {
                rankCommand = commandModule;
                log.info(`🎯 Système d'expérience activé avec la commande rank`);
            }
            
            log.info(`✅ Commande '${commandName}' chargée`);
            
        } catch (error) {
            log.error(`❌ Erreur chargement ${file}: ${error.message}`);
        }
    }
    
    log.info(`🎉 ${COMMANDS.size} commandes chargées avec succès !`);
}
