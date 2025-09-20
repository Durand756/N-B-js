const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

// Variables de mémoire temporaire
const userMemory = new Map();
const userList = new Set();
const userLastImage = new Map();
const clanData = new Map();
const truncatedMessages = new Map();

let rankCommand = null;

// Configuration de la base de données SQLite
const DB_PATH = path.join(__dirname, 'nakamabot.db');
let db = null;

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

// === FONCTIONS DE BASE DE DONNÉES SQLite ===

/**
 * Initialise la base de données SQLite
 */
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                log.error(`Erreur ouverture DB: ${err.message}`);
                reject(err);
                return;
            }
            
            log.info(`Base de données SQLite ouverte: ${DB_PATH}`);
            
            // Créer les tables si elles n'existent pas
            const createTables = `
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
                    last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
                    message_count INTEGER DEFAULT 0
                );
                
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    message_type TEXT NOT NULL CHECK (message_type IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                
                CREATE TABLE IF NOT EXISTS user_images (
                    user_id TEXT PRIMARY KEY,
                    image_url TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                
                CREATE TABLE IF NOT EXISTS user_experience (
                    user_id TEXT PRIMARY KEY,
                    experience INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    last_exp_gain TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                
                CREATE TABLE IF NOT EXISTS clans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    description TEXT,
                    leader_id TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    member_count INTEGER DEFAULT 1
                );
                
                CREATE TABLE IF NOT EXISTS clan_members (
                    user_id TEXT NOT NULL,
                    clan_id INTEGER NOT NULL,
                    role TEXT DEFAULT 'member' CHECK (role IN ('leader', 'admin', 'member')),
                    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, clan_id),
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (clan_id) REFERENCES clans(id)
                );
                
                CREATE TABLE IF NOT EXISTS truncated_messages (
                    user_id TEXT PRIMARY KEY,
                    full_message TEXT NOT NULL,
                    last_sent_part TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                
                CREATE TABLE IF NOT EXISTS command_data (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
                );
                
                -- Index pour améliorer les performances
                CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
                CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
                CREATE INDEX IF NOT EXISTS idx_clan_members_user_id ON clan_members(user_id);
                CREATE INDEX IF NOT EXISTS idx_clan_members_clan_id ON clan_members(clan_id);
            `;
            
            db.exec(createTables, (err) => {
                if (err) {
                    log.error(`Erreur création tables: ${err.message}`);
                    reject(err);
                } else {
                    log.info("Tables SQLite créées/vérifiées avec succès");
                    resolve();
                }
            });
        });
    });
}

/**
 * Ferme la base de données proprement
 */
async function closeDatabase() {
    return new Promise((resolve) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    log.error(`Erreur fermeture DB: ${err.message}`);
                } else {
                    log.info("Base de données fermée");
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * Sauvegarde un utilisateur en base
 */
async function saveUserToDb(userId) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO users (id, last_seen, message_count)
            VALUES (?, CURRENT_TIMESTAMP, COALESCE((SELECT message_count FROM users WHERE id = ?), 0) + 1)
        `);
        
        stmt.run([userId, userId], function(err) {
            if (err) {
                log.error(`Erreur sauvegarde user ${userId}: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
        stmt.finalize();
    });
}

/**
 * Sauvegarde une conversation en base
 */
async function saveConversationToDb(userId, messageType, content) {
    return new Promise((resolve, reject) => {
        // Tronquer le contenu si trop long
        if (content.length > 4000) {
            content = content.substring(0, 3900) + "...[tronqué]";
        }
        
        const stmt = db.prepare(`
            INSERT INTO conversations (user_id, message_type, content)
            VALUES (?, ?, ?)
        `);
        
        stmt.run([userId, messageType, content], function(err) {
            if (err) {
                log.error(`Erreur sauvegarde conversation ${userId}: ${err.message}`);
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
        stmt.finalize();
    });
}

/**
 * Sauvegarde une image utilisateur en base
 */
async function saveUserImageToDb(userId, imageUrl) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO user_images (user_id, image_url, timestamp)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        
        stmt.run([userId, imageUrl], function(err) {
            if (err) {
                log.error(`Erreur sauvegarde image ${userId}: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
        stmt.finalize();
    });
}

/**
 * Sauvegarde l'expérience utilisateur en base
 */
async function saveUserExpToDb(userId, experience, level) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO user_experience (user_id, experience, level, last_exp_gain)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        stmt.run([userId, experience, level], function(err) {
            if (err) {
                log.error(`Erreur sauvegarde exp ${userId}: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
        stmt.finalize();
    });
}

/**
 * Sauvegarde un message tronqué en base
 */
async function saveTruncatedMessageToDb(userId, fullMessage, lastSentPart) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO truncated_messages (user_id, full_message, last_sent_part, timestamp)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        stmt.run([userId, fullMessage, lastSentPart], function(err) {
            if (err) {
                log.error(`Erreur sauvegarde message tronqué ${userId}: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
        stmt.finalize();
    });
}

/**
 * Charge les données depuis la base vers la mémoire
 */
async function loadDataFromDb() {
    try {
        // Charger les utilisateurs
        const users = await new Promise((resolve, reject) => {
            db.all("SELECT id FROM users", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        users.forEach(row => userList.add(row.id));
        log.info(`✅ ${users.length} utilisateurs chargés depuis la DB`);
        
        // Charger les conversations récentes (dernières 8 par utilisateur)
        const conversations = await new Promise((resolve, reject) => {
            db.all(`
                SELECT user_id, message_type, content, timestamp
                FROM (
                    SELECT user_id, message_type, content, timestamp,
                           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
                    FROM conversations
                ) 
                WHERE rn <= 8
                ORDER BY user_id, timestamp
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        conversations.forEach(row => {
            if (!userMemory.has(row.user_id)) {
                userMemory.set(row.user_id, []);
            }
            userMemory.get(row.user_id).push({
                type: row.message_type,
                content: row.content,
                timestamp: row.timestamp
            });
        });
        log.info(`✅ ${conversations.length} conversations chargées depuis la DB`);
        
        // Charger les images utilisateur
        const images = await new Promise((resolve, reject) => {
            db.all("SELECT user_id, image_url FROM user_images", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        images.forEach(row => {
            userLastImage.set(row.user_id, row.image_url);
        });
        log.info(`✅ ${images.length} images chargées depuis la DB`);
        
        // Charger les messages tronqués actifs (moins de 24h)
        const truncated = await new Promise((resolve, reject) => {
            db.all(`
                SELECT user_id, full_message, last_sent_part, timestamp 
                FROM truncated_messages 
                WHERE datetime(timestamp) > datetime('now', '-24 hours')
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        truncated.forEach(row => {
            truncatedMessages.set(row.user_id, {
                fullMessage: row.full_message,
                lastSentPart: row.last_sent_part,
                timestamp: row.timestamp
            });
        });
        log.info(`✅ ${truncated.length} messages tronqués chargés depuis la DB`);
        
    } catch (error) {
        log.error(`Erreur chargement DB: ${error.message}`);
    }
}

// === GESTION GITHUB API (pour backup du fichier .db) ===

function encodeBase64(filePath) {
    const fileContent = fs.readFileSync(filePath);
    return fileContent.toString('base64');
}

function decodeBase64ToFile(content, filePath) {
    const buffer = Buffer.from(content, 'base64');
    fs.writeFileSync(filePath, buffer);
}

const getGitHubApiUrl = (filename) => {
    return `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
};

async function createGitHubRepo() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.error("⚠ GITHUB_TOKEN ou GITHUB_USERNAME manquant pour créer le repo");
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
                        description: 'Sauvegarde NakamaBot avec base de données SQLite - Créé automatiquement',
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
                    log.info(`📁 URL: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
                    return true;
                }
            } catch (createError) {
                log.error(`⚠ Erreur création repository: ${createError.message}`);
                return false;
            }
        } else {
            log.error(`⚠ Erreur vérification repository: ${error.message}`);
            return false;
        }
    }

    return false;
}

let isSaving = false;
let saveQueue = [];

/**
 * Sauvegarde le fichier .db sur GitHub
 */
async function saveDbToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.debug("📄 Pas de sauvegarde GitHub (config manquante)");
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
        log.debug(`💾 Sauvegarde du fichier DB sur GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot.db';
        const url = getGitHubApiUrl(filename);
        
        // Vérifier que le fichier DB existe
        if (!fs.existsSync(DB_PATH)) {
            log.warning("⚠ Fichier DB inexistant pour la sauvegarde");
            return;
        }
        
        const commitData = {
            message: `🤖 Sauvegarde automatique DB NakamaBot - ${new Date().toISOString()}`,
            content: encodeBase64(DB_PATH)
        };

        let maxRetries = 3;
        let success = false;

        for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
            try {
                // Vérifier si le fichier existe déjà
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
                    const dbSize = fs.statSync(DB_PATH).size;
                    log.info(`💾 Base de données sauvegardée sur GitHub (${Math.round(dbSize / 1024)} KB)`);
                    success = true;
                } else {
                    log.error(`⚠ Erreur sauvegarde GitHub: ${response.status}`);
                }

            } catch (retryError) {
                if (retryError.response?.status === 409 && attempt < maxRetries) {
                    log.warning(`⚠️ Conflit SHA détecté (409), tentative ${attempt}/${maxRetries}, retry dans 1s...`);
                    await sleep(1000);
                    continue;
                } else if (retryError.response?.status === 404 && attempt === 1) {
                    log.debug("📁 Premier fichier, pas de SHA nécessaire");
                    delete commitData.sha;
                    continue;
                } else {
                    throw retryError;
                }
            }
        }

        if (!success) {
            log.error("⚠ Échec de sauvegarde après plusieurs tentatives");
        }

    } catch (error) {
        if (error.response?.status === 404) {
            log.error("⚠ Repository GitHub introuvable pour la sauvegarde (404)");
            log.error(`📁 Repository utilisé: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        } else if (error.response?.status === 401) {
            log.error("⚠ Token GitHub invalide pour la sauvegarde (401)");
        } else if (error.response?.status === 403) {
            log.error("⚠ Accès refusé GitHub pour la sauvegarde (403)");
        } else if (error.response?.status === 409) {
            log.warning("⚠️ Conflit SHA persistant - sauvegarde ignorée pour éviter les blocages");
        } else {
            log.error(`⚠ Erreur sauvegarde GitHub: ${error.message}`);
        }
    } finally {
        isSaving = false;
        
        const queueCallbacks = [...saveQueue];
        saveQueue = [];
        queueCallbacks.forEach(callback => callback());
    }
}

/**
 * Charge le fichier .db depuis GitHub
 */
async function loadDbFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub manquante, utilisation DB locale uniquement");
        return;
    }

    try {
        log.info(`📥 Tentative de chargement DB depuis GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot.db';
        const url = getGitHubApiUrl(filename);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        if (response.status === 200 && response.data.content) {
            // Fermer la DB actuelle si ouverte
            await closeDatabase();
            
            // Sauvegarder l'ancienne DB si elle existe
            if (fs.existsSync(DB_PATH)) {
                const backupPath = `${DB_PATH}.backup.${Date.now()}`;
                fs.copyFileSync(DB_PATH, backupPath);
                log.info(`📋 Ancienne DB sauvegardée: ${backupPath}`);
            }
            
            // Écrire la nouvelle DB depuis GitHub
            decodeBase64ToFile(response.data.content, DB_PATH);
            
            // Réouvrir la DB
            await initializeDatabase();
            
            log.info("🎉 Base de données chargée avec succès depuis GitHub !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde DB trouvée sur GitHub - Première utilisation");
            log.info("🔧 Création de la base de données initiale...");
            
            const repoCreated = await createGitHubRepo();
            if (repoCreated) {
                await saveDbToGitHub();
            }
        } else if (error.response?.status === 401) {
            log.error("⚠ Token GitHub invalide (401) - Vérifiez votre GITHUB_TOKEN");
        } else if (error.response?.status === 403) {
            log.error("⚠ Accès refusé GitHub (403) - Vérifiez les permissions de votre token");
        } else {
            log.error(`⚠ Erreur chargement GitHub: ${error.message}`);
            if (error.response) {
                log.error(`📊 Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
        }
    }
}

// Sauvegarde automatique toutes les 5 minutes
let saveInterval;
function startAutoSave() {
    if (saveInterval) {
        clearInterval(saveInterval);
    }
    
    saveInterval = setInterval(async () => {
        await saveDbToGitHub();
    }, 5 * 60 * 1000); // 5 minutes
    
    log.info("📄 Sauvegarde automatique GitHub DB activée (toutes les 5 minutes)");
}

// Sauvegarde immédiate (non-bloquant)
async function saveDbImmediate() {
    saveDbToGitHub().catch(err => 
        log.debug(`📄 Sauvegarde DB en arrière-plan: ${err.message}`)
    );
}

// === RESTE DU CODE (identique mais avec sauvegarde DB) ===

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// === FONCTIONS DE GESTION DES MESSAGES TRONQUÉS ===

function splitMessageIntoChunks(text, maxLength = 2000) {
    if (!text || text.length <= maxLength) {
        return [text];
    }
    
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > maxLength) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            if (line.length > maxLength) {
                const words = line.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    if (currentLine.length + word.length + 1 > maxLength) {
                        if (currentLine.trim()) {
                            chunks.push(currentLine.trim());
                            currentLine = word;
                        } else {
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
    
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
}

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
                log.error("⚠ Clé API Mistral invalide");
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
            log.error(`⚠ Erreur Mistral: ${error.message}`);
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
            log.error(`⚠ Erreur Vision API: ${response.status}`);
            return null;
        }
    } catch (error) {
        log.error(`⚠ Erreur analyse image: ${error.message}`);
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
        log.error(`⚠ Erreur recherche: ${error.message}`);
        return "Oh non ! Une petite erreur de recherche... Désolée ! 💕";
    }
}

// GESTION CORRIGÉE DE LA MÉMOIRE AVEC SAUVEGARDE DB
async function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        log.debug("⚠ Paramètres manquants pour addToMemory");
        return;
    }
    
    if (content.length > 1500) {
        content = content.substring(0, 1400) + "...[tronqué]";
    }
    
    if (!userMemory.has(userId)) {
        userMemory.set(userId, []);
    }
    
    const memory = userMemory.get(userId);
    
    // Vérifier les doublons
    if (memory.length > 0) {
        const lastMessage = memory[memory.length - 1];
        
        if (lastMessage.type === msgType && lastMessage.content === content) {
            log.debug(`📄 Doublon évité pour ${userId}: ${msgType.substring(0, 50)}...`);
            return;
        }
        
        if (msgType === 'assistant' && lastMessage.type === 'assistant') {
            const similarity = calculateSimilarity(lastMessage.content, content);
            if (similarity > 0.8) {
                log.debug(`📄 Doublon assistant évité (similarité: ${Math.round(similarity * 100)}%)`);
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
    
    // Sauvegarder en base de données
    try {
        await saveConversationToDb(userId, msgType, content);
        saveDbImmediate(); // Backup GitHub non-bloquant
    } catch (error) {
        log.error(`Erreur sauvegarde conversation DB: ${error.message}`);
    }
}

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

// === FONCTIONS D'ENVOI AVEC GESTION DE TRONCATURE ===

async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("⚠ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
    }
    
    // GESTION INTELLIGENTE DES MESSAGES LONGS AVEC DB
    if (text.length > 2000) {
        log.info(`📃 Message long détecté (${text.length} chars) pour ${recipientId} - Division en chunks`);
        
        const chunks = splitMessageIntoChunks(text, 2000);
        
        if (chunks.length > 1) {
            // Envoyer le premier chunk avec indicateur de continuation
            const firstChunk = chunks[0] + "\n\n📃 *Tape \"continue\" pour la suite...*";
            
            // Sauvegarder l'état de troncature en DB
            try {
                await saveTruncatedMessageToDb(String(recipientId), text, chunks[0]);
                truncatedMessages.set(String(recipientId), {
                    fullMessage: text,
                    lastSentPart: chunks[0]
                });
                saveDbImmediate(); // Backup GitHub
            } catch (error) {
                log.error(`Erreur sauvegarde message tronqué: ${error.message}`);
            }
            
            return await sendSingleMessage(recipientId, firstChunk);
        }
    }
    
    // Message normal
    return await sendSingleMessage(recipientId, text);
}

async function sendSingleMessage(recipientId, text) {
    let finalText = text;
    if (finalText.length > 2000 && !finalText.includes("✨ [Message tronqué avec amour]")) {
        finalText = finalText.substring(0, 1950) + "...\n✨ [Message tronqué avec amour]";
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
            log.error(`⚠ Erreur Facebook API: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`⚠ Erreur envoi: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function sendImageMessage(recipientId, imageUrl, caption = "") {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("⚠ PAGE_ACCESS_TOKEN manquant");
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
            log.error(`⚠ Erreur envoi image: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`⚠ Erreur envoi image: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// === CHARGEMENT DES COMMANDES ===

const COMMANDS = new Map();

// CONTEXTE DES COMMANDES AVEC SUPPORT DB
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
    
    // Base de données
    db: () => db,
    saveUserToDb,
    saveConversationToDb,
    saveUserImageToDb,
    saveUserExpToDb,
    saveTruncatedMessageToDb,
    
    // Données persistantes pour les commandes
    clanData: null,
    commandData: clanData,
    truncatedMessages,
    
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
    
    // Fonctions de gestion de troncature
    splitMessageIntoChunks,
    isContinuationRequest,
    
    // Fonctions de sauvegarde GitHub
    saveDbToGitHub,
    saveDbImmediate,
    loadDbFromGitHub,
    createGitHubRepo
};

function loadCommands() {
    const commandsDir = path.join(__dirname, 'Cmds');
    
    if (!fs.existsSync(commandsDir)) {
        log.error("⚠ Dossier 'Cmds' introuvable");
        return;
    }
    
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    
    log.info(`📁 Chargement de ${commandFiles.length} commandes...`);
    
    for (const file of commandFiles) {
        try {
            const commandPath = path.join(commandsDir, file);
            const commandName = path.basename(file, '.js');
            
            delete require.cache[require.resolve(commandPath)];
            
            const commandModule = require(commandPath);
            
            if (typeof commandModule !== 'function') {
                log.error(`⚠ ${file} doit exporter une fonction`);
                continue;
            }
            
            COMMANDS.set(commandName, commandModule);
            
            // Capturer la commande rank pour l'expérience
            if (commandName === 'rank') {
                rankCommand = commandModule;
                log.info(`🎯 Système d'expérience activé avec la commande rank`);
            }
            
            log.info(`✅ Commande '${commandName}' chargée`);
            
        } catch (error) {
            log.error(`⚠ Erreur chargement ${file}: ${error.message}`);
        }
    }
    
    log.info(`🎉 ${COMMANDS.size} commandes chargées avec succès !`);
}

async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        return "🤖 Oh là là ! Message vide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    // GESTION DES DEMANDES DE CONTINUATION EN PRIORITÉ
    if (isContinuationRequest(messageText)) {
        const truncatedData = truncatedMessages.get(senderIdStr);
        if (truncatedData) {
            const { fullMessage, lastSentPart } = truncatedData;
            
            // Trouver où on s'était arrêté
            const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
            const remainingMessage = fullMessage.substring(lastSentIndex);
            
            if (remainingMessage.trim()) {
                const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                const nextChunk = chunks[0];
                
                // Mettre à jour le cache avec la nouvelle partie envoyée
                if (chunks.length > 1) {
                    const newTruncatedData = {
                        fullMessage: fullMessage,
                        lastSentPart: lastSentPart + nextChunk
                    };
                    truncatedMessages.set(senderIdStr, newTruncatedData);
                    
                    // Sauvegarder en DB
                    try {
                        await saveTruncatedMessageToDb(senderIdStr, fullMessage, lastSentPart + nextChunk);
                        saveDbImmediate();
                    } catch (error) {
                        log.error(`Erreur MAJ message tronqué: ${error.message}`);
                    }
                    
                    // Ajouter un indicateur de continuation
                    const continuationMsg = nextChunk + "\n\n📃 *Tape \"continue\" pour la suite...*";
                    await addToMemory(senderIdStr, 'user', messageText);
                    await addToMemory(senderIdStr, 'assistant', continuationMsg);
                    return continuationMsg;
                } else {
                    // Message terminé - nettoyer la DB
                    try {
                        db.run("DELETE FROM truncated_messages WHERE user_id = ?", [senderIdStr]);
                        truncatedMessages.delete(senderIdStr);
                        saveDbImmediate();
                    } catch (error) {
                        log.error(`Erreur nettoyage message tronqué: ${error.message}`);
                    }
                    
                    await addToMemory(senderIdStr, 'user', messageText);
                    await addToMemory(senderIdStr, 'assistant', nextChunk);
                    return nextChunk;
                }
            } else {
                // Plus rien à envoyer - nettoyer
                try {
                    db.run("DELETE FROM truncated_messages WHERE user_id = ?", [senderIdStr]);
                    truncatedMessages.delete(senderIdStr);
                    saveDbImmediate();
                } catch (error) {
                    log.error(`Erreur nettoyage message tronqué final: ${error.message}`);
                }
                
                const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                await addToMemory(senderIdStr, 'user', messageText);
                await addToMemory(senderIdStr, 'assistant', endMsg);
                return endMsg;
            }
        } else {
            // Pas de message tronqué en cours
            const noTruncMsg = "🤔 Il n'y a pas de message en cours à continuer. Pose-moi une nouvelle question ! 💡";
            await addToMemory(senderIdStr, 'user', messageText);
            await addToMemory(senderIdStr, 'assistant', noTruncMsg);
            return noTruncMsg;
        }
    }
    
    if (!messageText.startsWith('/')) {
        if (COMMANDS.has('chat')) {
            return await COMMANDS.get('chat')(senderId, messageText, commandContext);
        }
        return "🤖 Coucou ! Tape /start ou /help pour découvrir ce que je peux faire ! ✨";
    }
    
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS.has(command)) {
        try {
            return await COMMANDS.get(command)(senderId, args, commandContext);
        } catch (error) {
            log.error(`⚠ Erreur commande ${command}: ${error.message}`);
            return `💥 Oh non ! Petite erreur dans /${command} ! Réessaie ou tape /help ! 💕`;
        }
    }
    
    return `❓ Oh ! La commande /${command} m'est inconnue ! Tape /help pour voir tout ce que je sais faire ! ✨💕`;
}

// === ROUTES EXPRESS ===

// ROUTE D'ACCUEIL MISE À JOUR
app.get('/', async (req, res) => {
    try {
        // Statistiques depuis la DB
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM conversations) as conversations,
                    (SELECT COUNT(*) FROM user_images) as images,
                    (SELECT COUNT(*) FROM clans) as clans,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as truncated_messages
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || { users: 0, conversations: 0, images: 0, clans: 0, users_with_exp: 0, truncated_messages: 0 });
            });
        });
        
        res.json({
            status: "🤖 NakamaBot v4.0 Amicale + Vision + GitHub + DB SQLite Online ! 💖",
            creator: "Durand",
            personality: "Super gentille et amicale, comme une très bonne amie",
            year: "2025",
            commands: COMMANDS.size,
            users: stats.users,
            conversations: stats.conversations,
            images_stored: stats.images,
            clans_total: stats.clans,
            users_with_exp: stats.users_with_exp,
            truncated_messages: stats.truncated_messages,
            version: "4.0 Amicale + Vision + GitHub + DB SQLite",
            storage: {
                type: "SQLite + GitHub Backup",
                database_file: "nakamabot.db",
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                auto_backup: "Every 5 minutes",
                includes: ["users", "conversations", "images", "clans", "command_data", "user_exp", "truncated_messages"]
            },
            features: [
                "Génération d'images IA",
                "Transformation anime", 
                "Analyse d'images IA",
                "Chat intelligent et doux",
                "Système de clans persistant",
                "Système de ranking et expérience",
                "Cartes de rang personnalisées",
                "Gestion intelligente des messages longs",
                "Continuation automatique des réponses",
                "Base de données SQLite locale",
                "Sauvegarde GitHub automatique",
                "Broadcast admin",
                "Recherche 2025",
                "Stats réservées admin"
            ],
            last_update: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: "Erreur récupération statistiques",
            error: error.message
        });
    }
});

// Webhook Facebook Messenger
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        log.info('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        log.warning('⚠ Échec vérification webhook');
        res.status(403).send('Verification failed');
    }
});

// WEBHOOK PRINCIPAL MODIFIÉ - AVEC SAUVEGARDE DB
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data) {
            log.warning('⚠️ Aucune donnée reçue');
            return res.status(400).json({ error: "No data received" });
        }
        
        for (const entry of data.entry || []) {
            for (const event of entry.messaging || []) {
                const senderId = event.sender?.id;
                
                if (!senderId) {
                    continue;
                }
                
                const senderIdStr = String(senderId);
                
                if (event.message && !event.message.is_echo) {
                    const wasNewUser = !userList.has(senderIdStr);
                    userList.add(senderIdStr);
                    
                    // Sauvegarder l'utilisateur en DB
                    try {
                        await saveUserToDb(senderIdStr);
                        if (wasNewUser) {
                            log.info(`👋 Nouvel utilisateur: ${senderId}`);
                            saveDbImmediate(); // Backup GitHub
                        }
                    } catch (error) {
                        log.error(`Erreur sauvegarde user: ${error.message}`);
                    }
                    
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
                                    // Sauvegarder l'image en DB
                                    try {
                                        await saveUserImageToDb(senderIdStr, imageUrl);
                                        saveDbImmediate();
                                    } catch (error) {
                                        log.error(`Erreur sauvegarde image: ${error.message}`);
                                    }
                                    
                                    await addToMemory(senderId, 'user', '[Image envoyée]');
                                    
                                    // Ajouter de l'expérience pour l'envoi d'image
                                    if (rankCommand) {
                                        const expResult = rankCommand.addExp(senderId, 2); // 2 XP pour une image
                                        
                                        if (expResult.levelUp) {
                                            log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} (image) !`);
                                        }
                                        
                                        try {
                                            await saveUserExpToDb(senderId, expResult.totalExp, expResult.level);
                                            saveDbImmediate();
                                        } catch (error) {
                                            log.error(`Erreur sauvegarde exp: ${error.message}`);
                                        }
                                    }
                                    
                                    const response = "📸 Super ! J'ai bien reçu ton image ! ✨\n\n🎭 Tape /anime pour la transformer en style anime !\n👁️ Tape /vision pour que je te dise ce que je vois !\n\n💕 Ou continue à me parler normalement !";
                                    
                                    const sendResult = await sendMessage(senderId, response);
                                    if (sendResult.success) {
                                        await addToMemory(senderId, 'assistant', response);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    
                    const messageText = event.message.text?.trim();
                    
                    if (messageText) {
                        log.info(`📨 Message de ${senderId}: ${messageText.substring(0, 50)}...`);
                        
                        // Ajouter de l'expérience pour chaque message
                        if (messageText && rankCommand) {
                            const expResult = rankCommand.addExp(senderId, 1);
                            
                            // Notifier si l'utilisateur a monté de niveau
                            if (expResult.levelUp) {
                                log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} !`);
                            }
                            
                            try {
                                await saveUserExpToDb(senderId, expResult.totalExp, expResult.level);
                                saveDbImmediate();
                            } catch (error) {
                                log.error(`Erreur sauvegarde exp message: ${error.message}`);
                            }
                        }
                        
                        const response = await processCommand(senderId, messageText);
                        
                        if (response) {
                            if (typeof response === 'object' && response.type === 'image') {
                                const sendResult = await sendImageMessage(senderId, response.url, response.caption);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Image envoyée à ${senderId}`);
                                } else {
                                    log.warning(`⚠ Échec envoi image à ${senderId}`);
                                    const fallbackMsg = "🎨 Image créée avec amour mais petite erreur d'envoi ! Réessaie ! 💕";
                                    const fallbackResult = await sendMessage(senderId, fallbackMsg);
                                    if (fallbackResult.success) {
                                        await addToMemory(senderId, 'assistant', fallbackMsg);
                                    }
                                }
                            } else if (typeof response === 'string') {
                                const sendResult = await sendMessage(senderId, response);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Réponse envoyée à ${senderId}`);
                                } else {
                                    log.warning(`⚠ Échec envoi à ${senderId}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`⚠ Erreur webhook: ${error.message}`);
        return res.status(500).json({ error: `Webhook error: ${error.message}` });
    }
    
    res.status(200).json({ status: "ok" });
});

// Route pour créer un nouveau repository GitHub
app.post('/create-repo', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "GITHUB_TOKEN ou GITHUB_USERNAME manquant"
            });
        }

        const repoCreated = await createGitHubRepo();
        
        if (repoCreated) {
            res.json({
                success: true,
                message: "Repository GitHub créé avec succès !",
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
                instructions: [
                    "Le repository a été créé automatiquement",
                    "Le fichier nakamabot.db sera sauvegardé automatiquement",
                    "Vérifiez que le repository est privé pour la sécurité"
                ],
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Impossible de créer le repository"
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour tester la connexion GitHub
app.get('/test-github', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante",
                missing: {
                    token: !GITHUB_TOKEN,
                    username: !GITHUB_USERNAME
                }
            });
        }

        const repoUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`;
        const response = await axios.get(repoUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        res.json({
            success: true,
            message: "Connexion GitHub OK !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
            status: response.status,
            private: response.data.private,
            created_at: response.data.created_at,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        let errorMessage = error.message;
        let suggestions = [];

        if (error.response?.status === 404) {
            errorMessage = "Repository introuvable (404)";
            suggestions = [
                "Vérifiez que GITHUB_USERNAME et GITHUB_REPO sont corrects",
                "Utilisez POST /create-repo pour créer automatiquement le repository"
            ];
        } else if (error.response?.status === 401) {
            errorMessage = "Token GitHub invalide (401)";
            suggestions = ["Vérifiez votre GITHUB_TOKEN"];
        } else if (error.response?.status === 403) {
            errorMessage = "Accès refusé (403)";
            suggestions = ["Vérifiez les permissions de votre token (repo, contents)"];
        }

        res.status(error.response?.status || 500).json({
            success: false,
            error: errorMessage,
            suggestions: suggestions,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour forcer une sauvegarde DB
app.post('/force-save', async (req, res) => {
    try {
        await saveDbToGitHub();
        
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM conversations) as conversations,
                    (SELECT COUNT(*) FROM user_images) as images,
                    (SELECT COUNT(*) FROM clans) as clans,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as truncated_messages
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || { users: 0, conversations: 0, images: 0, clans: 0, users_with_exp: 0, truncated_messages: 0 });
            });
        });
        
        res.json({
            success: true,
            message: "Base de données sauvegardée avec succès sur GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour recharger les données depuis GitHub
app.post('/reload-data', async (req, res) => {
    try {
        await loadDbFromGitHub();
        await loadDataFromDb();
        
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM conversations) as conversations,
                    (SELECT COUNT(*) FROM user_images) as images,
                    (SELECT COUNT(*) FROM clans) as clans,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as truncated_messages
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || { users: 0, conversations: 0, images: 0, clans: 0, users_with_exp: 0, truncated_messages: 0 });
            });
        });
        
        res.json({
            success: true,
            message: "Données rechargées avec succès depuis GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// STATISTIQUES PUBLIQUES MISES À JOUR AVEC DB
app.get('/stats', async (req, res) => {
    try {
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM conversations) as conversations,
                    (SELECT COUNT(*) FROM user_images) as images,
                    (SELECT COUNT(*) FROM clans) as clans,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as truncated_messages
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || { users: 0, conversations: 0, images: 0, clans: 0, users_with_exp: 0, truncated_messages: 0 });
            });
        });
        
        res.json({
            users_count: stats.users,
            conversations_count: stats.conversations,
            images_stored: stats.images,
            clans_total: stats.clans,
            users_with_exp: stats.users_with_exp,
            truncated_messages: stats.truncated_messages,
            commands_available: COMMANDS.size,
            version: "4.0 Amicale + Vision + GitHub + DB SQLite",
            creator: "Durand",
            personality: "Super gentille et amicale, comme une très bonne amie",
            year: 2025,
            storage: {
                type: "SQLite + GitHub Backup",
                database_file: "nakamabot.db",
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                auto_backup_interval: "5 minutes",
                data_types: ["users", "conversations", "images", "clans", "command_data", "user_exp", "truncated_messages"]
            },
            features: [
                "AI Image Generation",
                "Anime Transformation", 
                "AI Image Analysis",
                "Friendly Chat",
                "Persistent Clan System",
                "User Ranking System",
                "Experience & Levels",
                "Smart Message Truncation",
                "Message Continuation",
                "SQLite Database",
                "GitHub Auto-Backup",
                "Admin Stats",
                "Help Suggestions"
            ],
            note: "Statistiques détaillées réservées aux admins via /stats"
        });
    } catch (error) {
        res.status(500).json({
            error: "Erreur récupération statistiques",
            message: error.message
        });
    }
});

// SANTÉ DU BOT MISE À JOUR AVEC DB
app.get('/health', async (req, res) => {
    try {
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM conversations) as conversations,
                    (SELECT COUNT(*) FROM user_images) as images,
                    (SELECT COUNT(*) FROM clans) as clans,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as truncated_messages
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || { users: 0, conversations: 0, images: 0, clans: 0, users_with_exp: 0, truncated_messages: 0 });
            });
        });
        
        const healthStatus = {
            status: "healthy",
            personality: "Super gentille et amicale, comme une très bonne amie 💖",
            services: {
                ai: Boolean(MISTRAL_API_KEY),
                vision: Boolean(MISTRAL_API_KEY),
                facebook: Boolean(PAGE_ACCESS_TOKEN),
                github_backup: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                database: Boolean(db),
                ranking_system: Boolean(rankCommand),
                message_truncation: true
            },
            data: stats,
            version: "4.0 Amicale + Vision + GitHub + DB SQLite",
            creator: "Durand",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            database_file: "nakamabot.db",
            timestamp: new Date().toISOString()
        };
        
        const issues = [];
        if (!MISTRAL_API_KEY) {
            issues.push("Clé IA manquante");
        }
        if (!PAGE_ACCESS_TOKEN) {
            issues.push("Token Facebook manquant");
        }
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            issues.push("Configuration GitHub manquante");
        }
        if (COMMANDS.size === 0) {
            issues.push("Aucune commande chargée");
        }
        if (!rankCommand) {
            issues.push("Système de ranking non chargé");
        }
        if (!db) {
            issues.push("Base de données non initialisée");
        }
        
        if (issues.length > 0) {
            healthStatus.status = "degraded";
            healthStatus.issues = issues;
        }
        
        const statusCode = healthStatus.status === "healthy" ? 200 : 503;
        res.status(statusCode).json(healthStatus);
    } catch (error) {
        res.status(500).json({
            status: "error",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// SERVEUR DE FICHIERS STATIQUES POUR LES IMAGES TEMPORAIRES
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// Middleware pour nettoyer automatiquement les anciens fichiers temporaires
app.use('/temp', (req, res, next) => {
    // Nettoyer les fichiers de plus de 1 heure
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            const ageInMs = now - stats.mtime.getTime();
            
            // Supprimer si plus d'1 heure (3600000 ms)
            if (ageInMs > 3600000) {
                try {
                    fs.unlinkSync(filePath);
                    log.debug(`🗑️ Fichier temporaire nettoyé: ${file}`);
                } catch (error) {
                    // Nettoyage silencieux
                }
            }
        });
    }
    next();
});

// Route pour voir l'historique des commits GitHub
app.get('/github-history', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante"
            });
        }

        const commitsUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits`;
        const response = await axios.get(commitsUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            params: {
                per_page: 10
            },
            timeout: 10000
        });

        const commits = response.data.map(commit => ({
            message: commit.commit.message,
            date: commit.commit.author.date,
            sha: commit.sha.substring(0, 7),
            author: commit.commit.author.name
        }));

        res.json({
            success: true,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            commits: commits,
            total_shown: commits.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.message,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`
        });
    }
});

// NOUVELLE ROUTE: Nettoyer les messages tronqués (admin uniquement)
app.post('/clear-truncated', async (req, res) => {
    try {
        const result = await new Promise((resolve, reject) => {
            db.run("DELETE FROM truncated_messages", function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        truncatedMessages.clear();
        saveDbImmediate();
        
        res.json({
            success: true,
            message: `${result} conversations tronquées nettoyées`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// NOUVELLE ROUTE: Statistiques détaillées de la DB
app.get('/db-stats', async (req, res) => {
    try {
        const detailedStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as total_users,
                    (SELECT COUNT(*) FROM conversations) as total_conversations,
                    (SELECT COUNT(*) FROM user_images) as total_images,
                    (SELECT COUNT(*) FROM clans) as total_clans,
                    (SELECT COUNT(*) FROM clan_members) as total_clan_members,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as active_truncated,
                    (SELECT COUNT(*) FROM command_data) as command_data_entries,
                    (SELECT MAX(experience) FROM user_experience) as max_experience,
                    (SELECT MAX(level) FROM user_experience) as max_level
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || {});
            });
        });

        const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
        
        res.json({
            success: true,
            database: {
                file: "nakamabot.db",
                size_bytes: dbSize,
                size_kb: Math.round(dbSize / 1024),
                size_mb: Math.round(dbSize / 1024 / 1024 * 100) / 100
            },
            statistics: detailedStats,
            backup: {
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                enabled: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                auto_backup_interval: "5 minutes"
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// === DÉMARRAGE MODIFIÉ AVEC SYSTÈME D'EXPÉRIENCE ET DB ===

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision + GitHub + DB SQLite");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");

    // Initialiser la base de données SQLite
    log.info("🗄️ Initialisation de la base de données SQLite...");
    await initializeDatabase();

    // Charger depuis GitHub si disponible
    log.info("📥 Chargement des données depuis GitHub...");
    await loadDbFromGitHub();

    // Charger les données depuis la DB vers la mémoire
    log.info("💾 Chargement des données depuis la base locale...");
    await loadDataFromDb();

    // Charger les commandes
    loadCommands();

    // Vérifier le système d'expérience
    if (rankCommand) {
        log.info("🎯 Système d'expérience détecté et prêt !");
    } else {
        log.warning("⚠️ Commande rank non trouvée - Système d'expérience désactivé");
    }

    const missingVars = [];
    if (!PAGE_ACCESS_TOKEN) {
        missingVars.push("PAGE_ACCESS_TOKEN");
    }
    if (!MISTRAL_API_KEY) {
        missingVars.push("MISTRAL_API_KEY");
    }
    if (!GITHUB_TOKEN) {
        missingVars.push("GITHUB_TOKEN");
    }
    if (!GITHUB_USERNAME) {
        missingVars.push("GITHUB_USERNAME");
    }

    if (missingVars.length > 0) {
        log.error(`⚠ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration complète OK");
    }

    // Statistiques depuis la DB
    try {
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM conversations) as conversations,
                    (SELECT COUNT(*) FROM user_images) as images,
                    (SELECT COUNT(*) FROM clans) as clans,
                    (SELECT COUNT(*) FROM user_experience) as users_with_exp,
                    (SELECT COUNT(*) FROM truncated_messages) as truncated_messages
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row || { users: 0, conversations: 0, images: 0, clans: 0, users_with_exp: 0, truncated_messages: 0 });
            });
        });

        log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
        log.info(`👥 ${stats.users} utilisateurs en base`);
        log.info(`💬 ${stats.conversations} conversations en base`);
        log.info(`🖼️ ${stats.images} images en base`);
        log.info(`🏰 ${stats.clans} clans en base`);
        log.info(`⭐ ${stats.users_with_exp} utilisateurs avec expérience`);
        log.info(`📃 ${stats.truncated_messages} conversations tronquées en cours`);
        log.info(`🔧 ${ADMIN_IDS.size} administrateurs`);
        log.info(`📂 Repository: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        log.info(`🌐 Serveur sur le port ${PORT}`);
        
        if (fs.existsSync(DB_PATH)) {
            const dbSize = fs.statSync(DB_PATH).size;
            log.info(`💾 Base de données: ${Math.round(dbSize / 1024)} KB`);
        }
    } catch (error) {
        log.error(`Erreur récupération stats: ${error.message}`);
    }
    
    startAutoSave();
    
    log.info("🎉 NakamaBot Amicale + Vision + GitHub + DB SQLite prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("💾 Base de données SQLite initialisée");
        log.info("📄 Sauvegarde automatique GitHub activée");
        log.info("📃 Gestion intelligente des messages longs activée");
        log.info(`📊 Dashboard: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
        log.info("🔗 Compatible Render.com");
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
        log.info("💾 Sauvegarde finale de la base de données sur GitHub...");
        await saveDbToGitHub();
        log.info("✅ Base de données sauvegardée avec succès !");
    } catch (error) {
        log.error(`⚠ Erreur sauvegarde finale: ${error.message}`);
    }
    
    // Nettoyage final des messages tronqués anciens
    try {
        const result = await new Promise((resolve, reject) => {
            db.run("DELETE FROM truncated_messages WHERE datetime(timestamp) < datetime('now', '-24 hours')", function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        if (result > 0) {
            log.info(`🧹 Nettoyage final: ${result} conversations tronquées expirées supprimées`);
        }
    } catch (error) {
        log.error(`Erreur nettoyage final: ${error.message}`);
    }
    
    // Fermer proprement la base de données
    await closeDatabase();
    
    log.info("👋 Au revoir ! Données sauvegardées sur GitHub et base fermée proprement !");
    log.info(`📂 Repository: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    process.exit(0);
}

// Gestion propre de l'arrêt
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Gestion des erreurs non capturées
process.on('uncaughtException', async (error) => {
    log.error(`⚠ Erreur non capturée: ${error.message}`);
    await gracefulShutdown();
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error(`⚠ Promesse rejetée: ${reason}`);
    await gracefulShutdown();
});

// NETTOYAGE PÉRIODIQUE: Nettoyer les messages tronqués anciens (plus de 24h)
setInterval(async () => {
    try {
        const result = await new Promise((resolve, reject) => {
            db.run("DELETE FROM truncated_messages WHERE datetime(timestamp) < datetime('now', '-24 hours')", function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        if (result > 0) {
            log.info(`🧹 Nettoyage automatique: ${result} conversations tronquées expirées supprimées de la DB`);
            
            // Nettoyer aussi la mémoire
            const now = Date.now();
            const oneDayMs = 24 * 60 * 60 * 1000;
            let cleanedFromMemory = 0;
            
            for (const [userId, data] of truncatedMessages.entries()) {
                if (!data.timestamp || (now - new Date(data.timestamp).getTime() > oneDayMs)) {
                    truncatedMessages.delete(userId);
                    cleanedFromMemory++;
                }
            }
            
            if (cleanedFromMemory > 0) {
                log.info(`🧹 ${cleanedFromMemory} conversations tronquées nettoyées de la mémoire`);
            }
            
            saveDbImmediate(); // Sauvegarder le nettoyage
        }
    } catch (error) {
        log.error(`Erreur nettoyage périodique: ${error.message}`);
    }
}, 60 * 60 * 1000); // Vérifier toutes les heures

// Démarrer le bot
startBot().catch(error => {
    log.error(`⚠ Erreur démarrage: ${error.message}`);
    process.exit(1);
});
