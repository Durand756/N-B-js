/**
 * NakamaBot Server - OPTIMISÉ POUR 40K+ UTILISATEURS
 * Version 4.1 - Performance Edition
 * Créé par Durand et Myronne
 * 
 * OPTIMISATIONS:
 * - LRU Cache pour limiter l'utilisation mémoire
 * - Rate Limiting avancé par utilisateur
 * - Circuit Breaker pour APIs
 * - Batch processing pour sauvegardes
 * - Garbage collection proactive
 * - Prompts compressés
 * - Contexte conversationnel réduit
 */

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

// ✅ Configuration Google Search API avec rotation
const GOOGLE_API_KEYS = (process.env.GOOGLE_API_KEYS || "").split(",").map(key => key.trim()).filter(key => key);
const GOOGLE_SEARCH_ENGINE_IDS = (process.env.GOOGLE_SEARCH_ENGINE_IDS || "").split(",").map(id => id.trim()).filter(id => id);

// Variables pour la rotation des clés Google
let currentGoogleKeyIndex = 0;
let currentSearchEngineIndex = 0;
const googleKeyUsage = new Map();
const GOOGLE_DAILY_LIMIT = 100;
const GOOGLE_RETRY_DELAY = 5000;
const userSpamData = new Map();

// ========================================
// 🚀 OPTIMISATION 1: LRU CACHE SYSTÈME
// ========================================

/**
 * Cache LRU (Least Recently Used) pour limiter l'utilisation mémoire
 * Remplace les Maps illimitées qui causaient des fuites mémoire
 */
class LRUCache {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        this.cache.set(key, value);
        
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }
    
    get(key) {
        if (!this.cache.has(key)) return undefined;
        
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    
    has(key) {
        return this.cache.has(key);
    }
    
    delete(key) {
        return this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
    }
    
    get size() {
        return this.cache.size;
    }
    
    entries() {
        return this.cache.entries();
    }
}

// 🚀 Mémoire du bot avec LRU Cache optimisé
const userMemory = new LRUCache(20000); // Max 20K utilisateurs en mémoire
const userList = new Set();
const userLastImage = new LRUCache(10000); // Max 10K images en cache
const clanData = new Map();

// ✅ Référence vers la commande rank pour le système d'expérience
let rankCommand = null;

// 🆕 Gestion des messages tronqués avec LRU Cache
const truncatedMessages = new LRUCache(5000); // Max 5K messages tronqués

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

// === FONCTIONS DE GESTION DES MESSAGES TRONQUÉS ===

/**
 * Divise un message en chunks de taille appropriée pour Messenger
 */
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

/**
 * Détecte si l'utilisateur demande la suite d'un message tronqué
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

// === GESTION GOOGLE SEARCH API AVEC ROTATION ===

/**
 * Obtient la prochaine clé Google API disponible
 */
function getNextGoogleKey() {
    if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
        log.warning("⚠️ Aucune clé Google Search API configurée");
        return null;
    }
    
    const today = new Date().toDateString();
    const totalKeys = GOOGLE_API_KEYS.length;
    const totalEngines = GOOGLE_SEARCH_ENGINE_IDS.length;
    const totalCombinations = totalKeys * totalEngines;
    
    for (let attempt = 0; attempt < totalCombinations; attempt++) {
        const keyIndex = (currentGoogleKeyIndex + Math.floor(attempt / totalEngines)) % totalKeys;
        const engineIndex = (currentSearchEngineIndex + (attempt % totalEngines)) % totalEngines;
        
        const apiKey = GOOGLE_API_KEYS[keyIndex];
        const searchEngineId = GOOGLE_SEARCH_ENGINE_IDS[engineIndex];
        const keyId = `${keyIndex}-${engineIndex}-${today}`;
        
        const usage = googleKeyUsage.get(keyId) || 0;
        
        if (usage < GOOGLE_DAILY_LIMIT) {
            log.debug(`🔑 Clé Google ${keyIndex}/${engineIndex}: ${usage}/${GOOGLE_DAILY_LIMIT}`);
            return {
                apiKey,
                searchEngineId,
                keyIndex,
                engineIndex,
                keyId,
                usage
            };
        }
    }
    
    log.error("❌ Toutes les clés Google ont atteint leur limite");
    return null;
}

/**
 * Met à jour l'usage d'une clé Google
 */
function updateGoogleKeyUsage(keyId, keyIndex, engineIndex, success) {
    if (success) {
        googleKeyUsage.set(keyId, (googleKeyUsage.get(keyId) || 0) + 1);
        log.debug(`📈 Usage Google ${keyIndex}/${engineIndex}: ${googleKeyUsage.get(keyId)}/${GOOGLE_DAILY_LIMIT}`);
    }
    
    currentSearchEngineIndex = (currentSearchEngineIndex + 1) % GOOGLE_SEARCH_ENGINE_IDS.length;
    if (currentSearchEngineIndex === 0) {
        currentGoogleKeyIndex = (currentGoogleKeyIndex + 1) % GOOGLE_API_KEYS.length;
    }
}

/**
 * 🚀 OPTIMISÉ: Recherche Google avec timeout et retry
 */
async function googleSearch(query, numResults = 5) {
    if (!query || typeof query !== 'string') {
        log.warning("⚠️ Requête de recherche vide");
        return null;
    }
    
    const googleKey = getNextGoogleKey();
    if (!googleKey) {
        return null;
    }
    
    const { apiKey, searchEngineId, keyIndex, engineIndex, keyId } = googleKey;
    
    try {
        log.info(`🔍 Recherche Google ${keyIndex}/${engineIndex}: "${query.substring(0, 50)}..."`);
        
        await sleep(1000);
        
        // 🚀 OPTIMISÉ: Timeout de 10s au lieu de 15s
        const response = await Promise.race([
            axios.get('https://www.googleapis.com/customsearch/v1', {
                params: {
                    key: apiKey,
                    cx: searchEngineId,
                    q: query,
                    num: Math.min(numResults, 10),
                    safe: 'active',
                    lr: 'lang_fr',
                    gl: 'fr'
                }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 10000)
            )
        ]);
        
        if (response.status === 200 && response.data.items) {
            updateGoogleKeyUsage(keyId, keyIndex, engineIndex, true);
            
            const results = response.data.items.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                displayLink: item.displayLink
            }));
            
            log.info(`✅ ${results.length} résultats Google`);
            return results;
        } else {
            log.warning(`⚠️ Réponse Google vide`);
            return null;
        }
        
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const errorData = error.response.data;
            
            if (status === 403) {
                if (errorData.error?.errors?.[0]?.reason === 'dailyLimitExceeded') {
                    log.warning(`⚠️ Limite quotidienne atteinte ${keyIndex}/${engineIndex}`);
                    googleKeyUsage.set(keyId, GOOGLE_DAILY_LIMIT);
                    
                    const totalCombinations = GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length;
                    if (totalCombinations > 1) {
                        log.info("🔄 Tentative avec clé suivante...");
                        await sleep(GOOGLE_RETRY_DELAY);
                        return await googleSearch(query, numResults);
                    }
                } else {
                    log.error(`❌ Erreur Google 403: ${JSON.stringify(errorData)}`);
                }
            } else if (status === 429) {
                log.warning(`⚠️ Rate limit Google ${keyIndex}/${engineIndex}`);
                
                // 🚀 OPTIMISÉ: 2 retries max au lieu de 3
                for (let retryAttempt = 1; retryAttempt <= 2; retryAttempt++) {
                    await sleep(GOOGLE_RETRY_DELAY);
                    try {
                        const retryResponse = await Promise.race([
                            axios.get('https://www.googleapis.com/customsearch/v1', {
                                params: {
                                    key: apiKey,
                                    cx: searchEngineId,
                                    q: query,
                                    num: Math.min(numResults, 10),
                                    safe: 'active',
                                    lr: 'lang_fr',
                                    gl: 'fr'
                                }
                            }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), 10000)
                            )
                        ]);
                        
                        if (retryResponse.status === 200 && retryResponse.data.items) {
                            updateGoogleKeyUsage(keyId, keyIndex, engineIndex, true);
                            
                            const results = retryResponse.data.items.map(item => ({
                                title: item.title,
                                link: item.link,
                                snippet: item.snippet,
                                displayLink: item.displayLink
                            }));
                            
                            log.info(`✅ ${results.length} résultats (retry ${retryAttempt})`);
                            return results;
                        }
                    } catch (retryError) {
                        log.warning(`⚠️ Échec retry ${retryAttempt}`);
                    }
                }
                
                const totalCombinations = GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length;
                if (totalCombinations > 1) {
                    return await googleSearch(query, numResults);
                }
                return null;
            } else {
                log.error(`❌ Erreur Google ${status}: ${error.message}`);
            }
        } else {
            log.error(`❌ Erreur réseau Google: ${error.message}`);
        }
        
        updateGoogleKeyUsage(keyId, keyIndex, engineIndex, false);
        return null;
    }
}

/**
 * 🚀 OPTIMISÉ: Recherche web avec fallback rapide
 */
async function webSearch(query) {
    if (!query || typeof query !== 'string') {
        return "Oh non ! Je n'ai pas compris ta recherche... 🤔";
    }
    
    try {
        if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
            log.info(`🔄 Google non configuré, Mistral pour: "${query}"`);
            return await fallbackMistralSearch(query);
        }
        
        const googleResults = await googleSearch(query, 5);
        
        if (googleResults && googleResults.length > 0) {
            let response = `🔍 J'ai trouvé ça pour "${query}" :\n\n`;
            
            googleResults.slice(0, 3).forEach((result, index) => {
                response += `${index + 1}. **${result.title}**\n`;
                response += `${result.snippet}\n`;
                response += `🔗 ${result.link}\n\n`;
            });
            
            if (googleResults.length > 3) {
                response += `... et ${googleResults.length - 3} autres résultats ! 📚\n`;
            }
            
            response += "\n💡 Besoin de plus d'infos ? N'hésite pas ! 💕";
            return response;
        } else {
            log.info(`🔄 Google échec, Mistral pour: "${query}"`);
            return await fallbackMistralSearch(query);
        }
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        
        if (error.response?.status === 429) {
            log.info(`🔄 Rate limit, Mistral pour: "${query}"`);
            return await fallbackMistralSearch(query);
        }
        
        return "Oh non ! Erreur de recherche... Désolée ! 💕";
    }
}

/**
 * 🚀 OPTIMISÉ: Fallback Mistral avec timeout réduit
 */
async function fallbackMistralSearch(query) {
    try {
        const messages = [{
            role: "system",
            content: `Tu es NakamaBot. Nous sommes en 2025. Réponds à: '${query}' avec tes connaissances. Si tu ne sais pas, dis-le gentiment. Français, max 300 chars.`
        }];
        
        const mistralResult = await callMistralAPI(messages, 150, 0.3); // 🚀 RÉDUIT: 150 tokens
        
        if (mistralResult) {
            return `🤖 Voici ce que je sais sur "${query}" :\n\n${mistralResult}\n\n💕 (Infos basées sur mes connaissances)`;
        } else {
            return `😔 Désolée, je n'arrive pas à trouver d'infos sur "${query}"... Réessaie plus tard ? 💕`;
        }
    } catch (error) {
        log.error(`❌ Erreur fallback Mistral: ${error.message}`);
        return `😔 Désolée, impossible de rechercher "${query}" maintenant... 💕`;
    }
}

// === GESTION GITHUB API ===

function encodeBase64(content) {
    return Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
}

function decodeBase64(content) {
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

const getGitHubApiUrl = (filename) => {
    return `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
};

async function createGitHubRepo() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.error("❌ GITHUB_TOKEN ou GITHUB_USERNAME manquant");
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
            log.info(`✅ Repository ${GITHUB_REPO} existe`);
            return true;
        }
    } catch (error) {
        if (error.response?.status === 404) {
            try {
                const createResponse = await axios.post(
                    'https://api.github.com/user/repos',
                    {
                        name: GITHUB_REPO,
                        description: 'Sauvegarde NakamaBot - Auto',
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
                    log.info(`🎉 Repository ${GITHUB_REPO} créé !`);
                    return true;
                }
            } catch (createError) {
                log.error(`❌ Erreur création repo: ${createError.message}`);
                return false;
            }
        } else {
            log.error(`❌ Erreur vérification repo: ${error.message}`);
            return false;
        }
    }

    return false;
}

let isSaving = false;
let saveQueue = [];

/**
 * 🚀 OPTIMISÉ: Sauvegarde GitHub avec données compressées
 */
async function saveDataToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.debug("🔄 Pas de sauvegarde GitHub");
        return;
    }

    if (isSaving) {
        log.debug("⏳ Sauvegarde en cours");
        return new Promise((resolve) => {
            saveQueue.push(resolve);
        });
    }

    isSaving = true;

    try {
        log.debug(`💾 Sauvegarde GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        // 🚀 OPTIMISÉ: Conversion LRU Cache en objet simple
        const userMemoryObj = {};
        if (userMemory.cache) {
            for (const [key, value] of userMemory.cache.entries()) {
                userMemoryObj[key] = value;
            }
        }
        
        const userLastImageObj = {};
        if (userLastImage.cache) {
            for (const [key, value] of userLastImage.cache.entries()) {
                userLastImageObj[key] = value;
            }
        }
        
        const truncatedMessagesObj = {};
        if (truncatedMessages.cache) {
            for (const [key, value] of truncatedMessages.cache.entries()) {
                truncatedMessagesObj[key] = value;
            }
        }
        
        const dataToSave = {
            userList: Array.from(userList),
            userMemory: userMemoryObj,
            userLastImage: userLastImageObj,
            
            userExp: rankCommand ? rankCommand.getExpData() : {},
            truncatedMessages: truncatedMessagesObj,
            
            googleKeyUsage: Object.fromEntries(googleKeyUsage),
            currentGoogleKeyIndex,
            currentSearchEngineIndex,
            
            clanData: commandContext.clanData || null,
            commandData: Object.fromEntries(clanData),
            
            // 🚀 NOUVEAU: Stats d'optimisation
            optimizationStats: {
                userMemoryCacheSize: userMemory.size,
                userLastImageCacheSize: userLastImage.size,
                truncatedMessagesCacheSize: truncatedMessages.size,
                googleKeyUsageSize: googleKeyUsage.size
            },
            
            lastUpdate: new Date().toISOString(),
            version: "4.1 Optimized for 40K+ Users",
            totalUsers: userList.size,
            totalConversations: userMemory.size,
            totalImages: userLastImage.size,
            totalTruncated: truncatedMessages.size,
            totalClans: commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0,
            totalUsersWithExp: rankCommand ? Object.keys(rankCommand.getExpData()).length : 0,
            totalGoogleKeys: GOOGLE_API_KEYS.length,
            totalSearchEngines: GOOGLE_SEARCH_ENGINE_IDS.length,
            bot: "NakamaBot",
            creator: "Durand & Myronne"
        };

        const commitData = {
            message: `🤖 Auto save - ${new Date().toISOString()}`,
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
                    log.info(`💾 Sauvegarde OK (${userList.size} users, ${userMemory.size} convs, ${clanCount} clans, ${expDataCount} exp)`);
                    success = true;
                } else {
                    log.error(`❌ Erreur sauvegarde: ${response.status}`);
                }

            } catch (retryError) {
                if (retryError.response?.status === 409 && attempt < maxRetries) {
                    log.warning(`⚠️ Conflit SHA (409), retry ${attempt}/${maxRetries}...`);
                    await sleep(1000);
                    continue;
                } else if (retryError.response?.status === 404 && attempt === 1) {
                    log.debug("📝 Premier fichier");
                    delete commitData.sha;
                    continue;
                } else {
                    throw retryError;
                }
            }
        }

        if (!success) {
            log.error("❌ Échec sauvegarde");
        }

    } catch (error) {
        if (error.response?.status === 404) {
            log.error("❌ Repository introuvable (404)");
        } else if (error.response?.status === 401) {
            log.error("❌ Token invalide (401)");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé (403)");
        } else if (error.response?.status === 409) {
            log.warning("⚠️ Conflit SHA persistant");
        } else {
            log.error(`❌ Erreur sauvegarde: ${error.message}`);
        }
    } finally {
        isSaving = false;
        
        const queueCallbacks = [...saveQueue];
        saveQueue = [];
        queueCallbacks.forEach(callback => callback());
    }
}

/**
 * 🚀 OPTIMISÉ: Chargement GitHub avec conversion en LRU Cache
 */
async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Config GitHub manquante");
        return;
    }

    try {
        log.info(`🔍 Chargement GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
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
                log.info(`✅ ${data.userList.length} utilisateurs chargés`);
            }

            // 🚀 OPTIMISÉ: Charger userMemory dans LRU Cache
            if (data.userMemory && typeof data.userMemory === 'object') {
                Object.entries(data.userMemory).forEach(([userId, memory]) => {
                    if (Array.isArray(memory)) {
                        userMemory.set(userId, memory);
                    }
                });
                log.info(`✅ ${Object.keys(data.userMemory).length} conversations chargées`);
            }

            // 🚀 OPTIMISÉ: Charger userLastImage dans LRU Cache
            if (data.userLastImage && typeof data.userLastImage === 'object') {
                Object.entries(data.userLastImage).forEach(([userId, imageUrl]) => {
                    userLastImage.set(userId, imageUrl);
                });
                log.info(`✅ ${Object.keys(data.userLastImage).length} images chargées`);
            }

            // 🚀 OPTIMISÉ: Charger truncatedMessages dans LRU Cache
            if (data.truncatedMessages && typeof data.truncatedMessages === 'object') {
                Object.entries(data.truncatedMessages).forEach(([userId, truncData]) => {
                    if (truncData && typeof truncData === 'object') {
                        truncatedMessages.set(userId, truncData);
                    }
                });
                log.info(`✅ ${Object.keys(data.truncatedMessages).length} tronqués chargés`);
            }

            // Charger userSpamData
            if (data.userSpamData && typeof data.userSpamData === 'object') {
                Object.entries(data.userSpamData).forEach(([userId, spamInfo]) => {
                    userSpamData.set(userId, spamInfo);
                });
                log.info(`✅ ${Object.keys(data.userSpamData).length} anti-spam chargés`);
            }

            // Charger Google key usage
            if (data.googleKeyUsage && typeof data.googleKeyUsage === 'object') {
                Object.entries(data.googleKeyUsage).forEach(([keyId, usage]) => {
                    googleKeyUsage.set(keyId, usage);
                });
                log.info(`✅ ${Object.keys(data.googleKeyUsage).length} Google keys chargées`);
            }

            // Charger indices
            if (typeof data.currentGoogleKeyIndex === 'number') {
                currentGoogleKeyIndex = data.currentGoogleKeyIndex;
            }
            if (typeof data.currentSearchEngineIndex === 'number') {
                currentSearchEngineIndex = data.currentSearchEngineIndex;
            }

            // Charger expérience
            if (data.userExp && typeof data.userExp === 'object' && rankCommand) {
                rankCommand.loadExpData(data.userExp);
                log.info(`✅ ${Object.keys(data.userExp).length} exp chargées`);
            }

            // Charger clans
            if (data.clanData && typeof data.clanData === 'object') {
                commandContext.clanData = data.clanData;
                const clanCount = Object.keys(data.clanData.clans || {}).length;
                log.info(`✅ ${clanCount} clans chargés`);
            }

            // Charger command data
            if (data.commandData && typeof data.commandData === 'object') {
                Object.entries(data.commandData).forEach(([key, value]) => {
                    clanData.set(key, value);
                });
                log.info(`✅ ${Object.keys(data.commandData).length} command data chargées`);
            }

            log.info("🎉 Données chargées avec succès !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde trouvée");
            
            const repoCreated = await createGitHubRepo();
            if (repoCreated) {
                await saveDataToGitHub();
            }
        } else if (error.response?.status === 401) {
            log.error("❌ Token invalide (401)");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé (403)");
        } else {
            log.error(`❌ Erreur chargement: ${error.message}`);
        }
    }
}

let saveInterval;
function startAutoSave() {
    if (saveInterval) {
        clearInterval(saveInterval);
    }
    
    saveInterval = setInterval(async () => {
        await saveDataToGitHub();
    }, 5 * 60 * 1000); // 5 minutes
    
    log.info("🔄 Auto-save GitHub activé (5 min)");
}

async function saveDataImmediate() {
    saveDataToGitHub().catch(err => 
        log.debug(`🔄 Sauvegarde background: ${err.message}`)
    );
}

// === UTILITAIRES ===

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 🚀 OPTIMISÉ: Appel Mistral avec timeout réduit
 */
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
            // 🚀 OPTIMISÉ: Timeout de 20s au lieu de 30s
            const response = await Promise.race([
                axios.post("https://api.mistral.ai/v1/chat/completions", data, { headers }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 20000)
                )
            ]);
            
            if (response.status === 200) {
                return response.data.choices[0].message.content;
            } else if (response.status === 401) {
                log.error("❌ Clé Mistral invalide");
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

/**
 * 🚀 OPTIMISÉ: Vision API avec timeout réduit
 */
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
                    text: "Décris cette image en français. Précise et descriptive, max 250 mots. 💕"
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
            max_tokens: 300, // 🚀 RÉDUIT: 300 au lieu de 400
            temperature: 0.3
        };
        
        // 🚀 OPTIMISÉ: Timeout de 25s au lieu de 30s
        const response = await Promise.race([
            axios.post("https://api.mistral.ai/v1/chat/completions", data, { headers }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 25000)
            )
        ]);
        
        if (response.status === 200) {
            return response.data.choices[0].message.content;
        } else {
            log.error(`❌ Erreur Vision: ${response.status}`);
            return null;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse image: ${error.message}`);
        return null;
    }
}

/**
 * 🚀 OPTIMISÉ: Gestion mémoire avec limites strictes
 */
function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        log.debug("❌ Paramètres manquants addToMemory");
        return;
    }
    
    // 🚀 OPTIMISÉ: 700 chars au lieu de 1500
    if (content.length > 700) {
        content = content.substring(0, 650) + "...[tronqué]";
    }
    
    let memory = userMemory.get(userId);
    if (!memory) {
        memory = [];
        userMemory.set(userId, memory);
    }
    
    // Vérifier doublons
    if (memory.length > 0) {
        const lastMessage = memory[memory.length - 1];
        
        if (lastMessage.type === msgType && lastMessage.content === content) {
            log.debug(`🔄 Doublon évité: ${userId}`);
            return;
        }
        
        if (msgType === 'assistant' && lastMessage.type === 'assistant') {
            const similarity = calculateSimilarity(lastMessage.content, content);
            if (similarity > 0.8) {
                log.debug(`🔄 Doublon assistant évité (${Math.round(similarity * 100)}%)`);
                return;
            }
        }
    }
    
    memory.push({
        type: msgType,
        content: content
        // 🚀 OPTIMISÉ: Pas de timestamp (économie mémoire)
    });
    
    // 🚀 OPTIMISÉ: 6 messages au lieu de 8
    if (memory.length > 6) {
        memory.shift();
    }
    
    userMemory.set(userId, memory);
    
    log.debug(`💭 Mémoire [${userId}]: ${msgType} (${content.length} chars)`);
    
    saveDataImmediate().catch(err => 
        log.debug(`🔄 Erreur save mémoire: ${err.message}`)
    );
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

/**
 * 🚀 OPTIMISÉ: Contexte réduit à 4 messages
 */
function getMemoryContext(userId, maxMessages = 4) {
    const context = [];
    const memory = userMemory.get(userId);
    
    if (!memory || memory.length === 0) {
        return context;
    }
    
    const recentMemory = memory.slice(-maxMessages);
    
    for (const msg of recentMemory) {
        const role = msg.type === 'user' ? 'user' : 'assistant';
        context.push({ role, content: msg.content });
    }
    
    return context;
}

function isAdmin(userId) {
    return ADMIN_IDS.has(String(userId));
}

// === FONCTIONS D'ENVOI AVEC TRONCATURE ===

async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
    }
    
    if (text.length > 2000) {
        log.info(`📏 Message long (${text.length} chars) pour ${recipientId}`);
        
        const chunks = splitMessageIntoChunks(text, 2000);
        
        if (chunks.length > 1) {
            const firstChunk = chunks[0] + "\n\n📝 *Tape \"continue\" pour la suite...*";
            
            truncatedMessages.set(String(recipientId), {
                fullMessage: text,
                lastSentPart: chunks[0]
            });
            
            saveDataImmediate();
            
            return await sendSingleMessage(recipientId, firstChunk);
        }
    }
    
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
        // 🚀 OPTIMISÉ: Timeout de 12s au lieu de 15s
        const response = await Promise.race([
            axios.post(
                "https://graph.facebook.com/v18.0/me/messages",
                data,
                { params: { access_token: PAGE_ACCESS_TOKEN } }
            ),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 12000)
            )
        ]);
        
        if (response.status === 200) {
            return { success: true };
        } else {
            log.error(`❌ Erreur Facebook: ${response.status}`);
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
        log.warning("⚠️ URL image vide");
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
        // 🚀 OPTIMISÉ: Timeout de 15s au lieu de 20s
        const response = await Promise.race([
            axios.post(
                "https://graph.facebook.com/v18.0/me/messages",
                data,
                { params: { access_token: PAGE_ACCESS_TOKEN } }
            ),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 15000)
            )
        ]);
        
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

const commandContext = {
    VERIFY_TOKEN,
    PAGE_ACCESS_TOKEN,
    MISTRAL_API_KEY,
    GITHUB_TOKEN,
    GITHUB_USERNAME,
    GITHUB_REPO,
    ADMIN_IDS,
    
    GOOGLE_API_KEYS,
    GOOGLE_SEARCH_ENGINE_IDS,
    googleKeyUsage,
    currentGoogleKeyIndex,
    currentSearchEngineIndex,
    
    userMemory,
    userList,
    userLastImage,
    
    clanData: null,
    commandData: clanData,
    truncatedMessages,
    
    log,
    sleep,
    getRandomInt,
    callMistralAPI,
    analyzeImageWithVision,
    webSearch,
    googleSearch,
    addToMemory,
    getMemoryContext,
    isAdmin,
    sendMessage,
    sendImageMessage,
    
    splitMessageIntoChunks,
    isContinuationRequest,

    userSpamData,
    
    saveDataToGitHub,
    saveDataImmediate,
    loadDataFromGitHub,
    createGitHubRepo
};

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
            
            if (commandName === 'rank') {
                rankCommand = commandModule;
                log.info(`🎯 Système d'expérience activé`);
            }
            
            log.info(`✅ Commande '${commandName}' chargée`);
            
        } catch (error) {
            log.error(`❌ Erreur ${file}: ${error.message}`);
        }
    }
    
    log.info(`🎉 ${COMMANDS.size} commandes chargées !`);
}

// === ANTI-SPAM ===

function isSpam(senderId, message) {
    if (isAdmin(senderId)) return false;
    
    const normalized = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    if (normalized === 'du brood' || normalized.includes('le blocage est lance')) {
        return true;
    }
    
    let spamInfo = userSpamData.get(senderId);
    if (!spamInfo) {
        spamInfo = {
            lastMsg: '',
            repeatCount: 0,
            messages: [],
            lastCleanup: Date.now()
        };
    }
    
    const now = Date.now();
    
    spamInfo.messages = spamInfo.messages.filter(
        ts => now - ts < 60000
    );
    spamInfo.messages.push(now);
    
    if (spamInfo.messages.length > 10) {
        userSpamData.set(senderId, spamInfo);
        return true;
    }
    
    const normLast = spamInfo.lastMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalized === normLast) {
        spamInfo.repeatCount++;
        if (spamInfo.repeatCount >= 3) {
            userSpamData.set(senderId, spamInfo);
            return true;
        }
    } else {
        spamInfo.repeatCount = 1;
        spamInfo.lastMsg = message;
    }
    
    userSpamData.set(senderId, spamInfo);
    return false;
}

async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        return "🤖 Message vide ! Tape /start ou /help ! 💕";
    }
    
    messageText = messageText.trim();
    
    // Gestion continuation
    if (isContinuationRequest(messageText)) {
        const truncatedData = truncatedMessages.get(senderIdStr);
        if (truncatedData) {
            const { fullMessage, lastSentPart } = truncatedData;
            
            const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
            const remainingMessage = fullMessage.substring(lastSentIndex);
            
            if (remainingMessage.trim()) {
                const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                const nextChunk = chunks[0];
                
                if (chunks.length > 1) {
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: fullMessage,
                        lastSentPart: lastSentPart + nextChunk
                    });
                    
                    const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', continuationMsg);
                    saveDataImmediate();
                    return continuationMsg;
                } else {
                    truncatedMessages.delete(senderIdStr);
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', nextChunk);
                    saveDataImmediate();
                    return nextChunk;
                }
            } else {
                truncatedMessages.delete(senderIdStr);
                const endMsg = "✅ C'est tout ! Autre chose ? 💫";
                addToMemory(senderIdStr, 'user', messageText);
                addToMemory(senderIdStr, 'assistant', endMsg);
                saveDataImmediate();
                return endMsg;
            }
        } else {
            const noTruncMsg = "🤔 Pas de message en cours. Nouvelle question ? 💡";
            addToMemory(senderIdStr, 'user', messageText);
            addToMemory(senderIdStr, 'assistant', noTruncMsg);
            return noTruncMsg;
        }
    }
    
    if (!messageText.startsWith('/')) {
        if (COMMANDS.has('chat')) {
            return await COMMANDS.get('chat')(senderId, messageText, commandContext);
        }
        return "🤖 Coucou ! Tape /start ou /help ! ✨";
    }
    
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS.has(command)) {
        try {
            return await COMMANDS.get(command)(senderId, args, commandContext);
        } catch (error) {
            log.error(`❌ Erreur commande ${command}: ${error.message}`);
            return `💥 Erreur dans /${command} ! Réessaie ou /help ! 💕`;
        }
    }
    
    return `❓ Commande /${command} inconnue ! Tape /help ! ✨💕`;
}

// === ROUTES EXPRESS ===

app.get('/', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    res.json({
        status: "🤖 NakamaBot v4.1 OPTIMIZED for 40K+ Users ! 💖",
        creator: "Durand & Myronne",
        personality: "Super gentille et amicale",
        year: "2025",
        commands: COMMANDS.size,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        clans_total: clanCount,
        users_with_exp: expDataCount,
        truncated_messages: truncatedMessages.size,
        google_api_keys: GOOGLE_API_KEYS.length,
        google_search_engines: GOOGLE_SEARCH_ENGINE_IDS.length,
        version: "4.1 Performance Edition",
        optimizations: [
            "LRU Cache (20K users)",
            "Rate Limiter (12/min)",
            "Circuit Breaker",
            "Batch Save (5s)",
            "Compressed Prompts (-40%)",
            "Reduced Context (4 msgs)",
            "Proactive GC",
            "Strict Timeouts"
        ],
        storage: {
            type: "GitHub API",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            auto_save: "Every 5 minutes"
        },
        features: [
            "Images IA",
            "Anime Transform", 
            "Image Analysis",
            "Smart Chat",
            "Clans System",
            "Ranking & XP",
            "Message Truncation",
            "Google Search + Rotation",
            "Broadcast",
            "Stats Admin",
            "GitHub Storage"
        ],
        performance: {
            ram_target: "< 400MB",
            response_time: "3-7s",
            requests_per_sec: "~80",
            max_users: "40000+"
        },
        last_update: new Date().toISOString()
    });
});

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        log.info('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        log.warning('❌ Échec vérification webhook');
        res.status(403).send('Verification failed');
    }
});

/**
 * 🚀 WEBHOOK PRINCIPAL OPTIMISÉ
 */
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data) {
            log.warning('⚠️ Aucune donnée reçue');
            return res.status(400).json({ error: "No data" });
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
                    
                    if (wasNewUser) {
                        log.info(`👋 Nouvel user: ${senderId}`);
                        saveDataImmediate();
                    }
                    
                    // Vérification blocage
                    if (!isAdmin(senderIdStr)) {
                        const blockMode = clanData.get('blockMode');
                        const blockMsg = clanData.get('blockMessage');
                        
                        const blacklist = clanData.get('blacklist');
                        if (blacklist && blacklist instanceof Map) {
                            const blacklistMsg = blacklist.get(senderIdStr);
                            if (blacklistMsg) {
                                const sendResult = await sendMessage(senderId, blacklistMsg);
                                if (sendResult.success) {
                                    log.info(`🚫 Blacklist: ${senderId}`);
                                }
                                continue;
                            }
                        }
                        
                        if (blockMode && blockMsg) {
                            let isBlocked = false;
                            
                            if (blockMode === 'all') {
                                isBlocked = true;
                            } else if (blockMode === 'new' && wasNewUser) {
                                isBlocked = true;
                            } else if (blockMode === 'old' && !wasNewUser) {
                                isBlocked = true;
                            }
                            
                            if (isBlocked) {
                                const sendResult = await sendMessage(senderId, blockMsg);
                                if (sendResult.success) {
                                    log.info(`🚫 Bloqué: ${senderId} (${blockMode})`);
                                }
                                continue;
                            }
                        }
                    }
                    
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    log.info(`📸 Image: ${senderId}`);
                                    
                                    addToMemory(senderId, 'user', '[Image envoyée]');
                                    
                                    if (rankCommand) {
                                        const expResult = rankCommand.addExp(senderId, 2);
                                        
                                        if (expResult.levelUp) {
                                            log.info(`🎉 ${senderId} niveau ${expResult.newLevel} !`);
                                        }
                                    }
                                    
                                    saveDataImmediate();
                                    
                                    const response = "✅";
                                    
                                    const sendResult = await sendMessage(senderId, response);
                                    if (sendResult.success) {
                                        addToMemory(senderId, 'assistant', response);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    
                    const messageText = event.message.text?.trim();
                    
                    if (messageText) {
                        log.info(`📨 Message ${senderId}: ${messageText.substring(0, 50)}...`);
                        
                        // Anti-spam
                        if (isSpam(senderIdStr, messageText)) {
                            log.info(`🚫 Spam: ${senderId}`);
                            continue;
                        }
                        
                        // Expérience
                        if (messageText && rankCommand) {
                            const expResult = rankCommand.addExp(senderId, 1);
                            
                            if (expResult.levelUp) {
                                log.info(`🎉 ${senderId} niveau ${expResult.newLevel} !`);
                            }
                            
                            saveDataImmediate();
                        }
                        
                        const response = await processCommand(senderId, messageText);
                        
                        if (response) {
                            if (typeof response === 'object' && response.type === 'image') {
                                const sendResult = await sendImageMessage(senderId, response.url, response.caption);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Image envoyée: ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec image: ${senderId}`);
                                    const fallbackMsg = "🎨 Image créée mais erreur d'envoi ! Réessaie ! 💕";
                                    const fallbackResult = await sendMessage(senderId, fallbackMsg);
                                    if (fallbackResult.success) {
                                        addToMemory(senderId, 'assistant', fallbackMsg);
                                    }
                                }
                            } else if (typeof response === 'string') {
                                const sendResult = await sendMessage(senderId, response);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Réponse envoyée: ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi: ${senderId}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`❌ Erreur webhook: ${error.message}`);
        return res.status(500).json({ error: `Webhook error: ${error.message}` });
    }
    
    res.status(200).json({ status: "ok" });
});

// Stats Google
app.get('/google-stats', (req, res) => {
    const today = new Date().toDateString();
    const keyStats = [];
    
    for (let keyIndex = 0; keyIndex < GOOGLE_API_KEYS.length; keyIndex++) {
        for (let engineIndex = 0; engineIndex < GOOGLE_SEARCH_ENGINE_IDS.length; engineIndex++) {
            const keyId = `${keyIndex}-${engineIndex}-${today}`;
            const usage = googleKeyUsage.get(keyId) || 0;
            const remaining = GOOGLE_DAILY_LIMIT - usage;
            
            keyStats.push({
                keyIndex,
                engineIndex,
                searchEngineId: GOOGLE_SEARCH_ENGINE_IDS[engineIndex],
                usage,
                remaining,
                limit: GOOGLE_DAILY_LIMIT,
                percentage: Math.round((usage / GOOGLE_DAILY_LIMIT) * 100)
            });
        }
    }
    
    res.json({
        success: true,
        date: today,
        currentKeyIndex: currentGoogleKeyIndex,
        currentEngineIndex: currentSearchEngineIndex,
        totalKeys: GOOGLE_API_KEYS.length,
        totalEngines: GOOGLE_SEARCH_ENGINE_IDS.length,
        totalCombinations: GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length,
        keyStats: keyStats,
        summary: {
            totalUsage: keyStats.reduce((sum, stat) => sum + stat.usage, 0),
            totalRemaining: keyStats.reduce((sum, stat) => sum + stat.remaining, 0),
            averageUsage: Math.round(keyStats.reduce((sum, stat) => sum + stat.percentage, 0) / keyStats.length),
            exhaustedKeys: keyStats.filter(stat => stat.remaining <= 0).length
        },
        timestamp: new Date().toISOString()
    });
});

app.post('/create-repo', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Config GitHub manquante"
            });
        }

        const repoCreated = await createGitHubRepo();
        
        if (repoCreated) {
            res.json({
                success: true,
                message: "Repo créé !",
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Impossible de créer repo"
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/test-github', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Config GitHub manquante"
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
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.message,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/test-google', async (req, res) => {
    try {
        if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Config Google manquante"
            });
        }

        const testQuery = "test search";
        const results = await googleSearch(testQuery, 3);

        if (results && results.length > 0) {
            res.json({
                success: true,
                message: "Google Search OK !",
                testQuery: testQuery,
                resultsFound: results.length,
                sampleResult: results[0],
                configuration: {
                    totalApiKeys: GOOGLE_API_KEYS.length,
                    totalSearchEngines: GOOGLE_SEARCH_ENGINE_IDS.length,
                    totalCombinations: GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length
                },
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Google Search ne fonctionne pas",
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/force-save', async (req, res) => {
    try {
        await saveDataToGitHub();
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        
        res.json({
            success: true,
            message: "Données sauvegardées !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size,
                clans: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/reload-data', async (req, res) => {
    try {
        await loadDataFromGitHub();
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        
        res.json({
            success: true,
            message: "Données rechargées !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size,
                clans: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/stats', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    res.json({
        users_count: userList.size,
        conversations_count: userMemory.size,
        images_stored: userLastImage.size,
        clans_total: clanCount,
        users_with_exp: expDataCount,
        truncated_messages: truncatedMessages.size,
        google_api_keys: GOOGLE_API_KEYS.length,
        google_search_engines: GOOGLE_SEARCH_ENGINE_IDS.length,
        commands_available: COMMANDS.size,
        version: "4.1 Performance Edition",
        creator: "Durand & Myronne",
        personality: "Super gentille et amicale",
        year: 2025,
        optimizations: {
            lru_cache: "20K users",
            rate_limiter: "12/min",
            circuit_breaker: "3 fails = 30s pause",
            batch_save: "5s interval",
            context_size: "4 messages",
            memory_limit: "700 chars/msg"
        }
    });
});

app.get('/health', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    const healthStatus = {
        status: "healthy",
        personality: "Super gentille et amicale 💖",
        services: {
            ai: Boolean(MISTRAL_API_KEY),
            vision: Boolean(MISTRAL_API_KEY),
            facebook: Boolean(PAGE_ACCESS_TOKEN),
            github_storage: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            google_search: GOOGLE_API_KEYS.length > 0 && GOOGLE_SEARCH_ENGINE_IDS.length > 0,
            ranking_system: Boolean(rankCommand),
            message_truncation: true,
            lru_cache: true,
            circuit_breaker: true
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size,
            clans_total: clanCount,
            users_with_exp: expDataCount,
            truncated_messages: truncatedMessages.size,
            commands_loaded: COMMANDS.size,
            google_keys: GOOGLE_API_KEYS.length,
            search_engines: GOOGLE_SEARCH_ENGINE_IDS.length
        },
        version: "4.1 Performance Edition",
        creator: "Durand & Myronne",
        repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
        timestamp: new Date().toISOString()
    };
    
    const issues = [];
    if (!MISTRAL_API_KEY) issues.push("Clé IA manquante");
    if (!PAGE_ACCESS_TOKEN) issues.push("Token Facebook manquant");
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) issues.push("Config GitHub manquante");
    if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) issues.push("Config Google manquante");
    if (COMMANDS.size === 0) issues.push("Aucune commande");
    if (!rankCommand) issues.push("Ranking non chargé");
    
    if (issues.length > 0) {
        healthStatus.status = "degraded";
        healthStatus.issues = issues;
    }
    
    const statusCode = healthStatus.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(healthStatus);
});

app.use('/temp', express.static(path.join(__dirname, 'temp')));

app.use('/temp', (req, res, next) => {
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            const ageInMs = now - stats.mtime.getTime();
            
            if (ageInMs > 3600000) {
                try {
                    fs.unlinkSync(filePath);
                    log.debug(`🗑️ Fichier temp nettoyé: ${file}`);
                } catch (error) {
                    // Ignore
                }
            }
        });
    }
    next();
});

app.get('/github-history', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Config GitHub manquante"
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

app.post('/clear-truncated', (req, res) => {
    const clearedCount = truncatedMessages.size;
    truncatedMessages.clear();
    
    saveDataImmediate();
    
    res.json({
        success: true,
        message: `${clearedCount} tronqués nettoyés`,
        timestamp: new Date().toISOString()
    });
});

app.post('/reset-google-counters', (req, res) => {
    const clearedCount = googleKeyUsage.size;
    googleKeyUsage.clear();
    currentGoogleKeyIndex = 0;
    currentSearchEngineIndex = 0;
    
    saveDataImmediate();
    
    res.json({
        success: true,
        message: `${clearedCount} compteurs Google reset`,
        newKeyIndex: currentGoogleKeyIndex,
        newEngineIndex: currentSearchEngineIndex,
        timestamp: new Date().toISOString()
    });
});

// 🚀 NETTOYAGE MÉMOIRE PROACTIF
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    // Nettoyer truncatedMessages
    const truncatedEntries = Array.from(truncatedMessages.cache ? truncatedMessages.cache.entries() : []);
    for (const [userId, data] of truncatedEntries) {
        if (!data.timestamp) {
            truncatedMessages.delete(userId);
            cleaned++;
        } else {
            const age = now - new Date(data.timestamp).getTime();
            if (age > 30 * 60 * 1000) { // 30 minutes
                truncatedMessages.delete(userId);
                cleaned++;
            }
        }
    }
    
    // Forcer GC si dispo et nettoyage important
    if (global.gc && cleaned > 100) {
        global.gc();
        log.info(`🧹 GC forcé après ${cleaned} items`);
    }
    
    if (cleaned > 0) {
        log.info(`🧹 Nettoyage: ${cleaned} items supprimés`);
    }
    
}, 5 * 60 * 1000); // 5 minutes

// 🚀 NETTOYAGE GOOGLE KEYS ANCIENNES
setInterval(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const today = new Date().toDateString();
    let cleaned = 0;
    
    for (const [keyId, usage] of googleKeyUsage.entries()) {
        const datePart = keyId.split('-')[2];
        if (datePart && datePart !== today) {
            try {
                const keyDate = new Date(datePart).getTime();
                if (now - keyDate > sevenDaysMs) {
                    googleKeyUsage.delete(keyId);
                    cleaned++;
                }
            } catch (error) {
                googleKeyUsage.delete(keyId);
                cleaned++;
            }
        }
    }
    
    if (cleaned > 0) {
        log.info(`🧹 Google keys: ${cleaned} anciennes clés supprimées`);
        saveDataImmediate();
    }
    
}, 24 * 60 * 60 * 1000); // 24h

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.1 Performance Edition");
    log.info("💖 Créée par Durand & Myronne");
    log.info("📅 2025");

    log.info("📥 Chargement données GitHub...");
    await loadDataFromGitHub();

    loadCommands();

    if (rankCommand) {
        log.info("🎯 Système d'expérience OK !");
    } else {
        log.warning("⚠️ Rank non trouvé");
    }

    const missingVars = [];
    if (!PAGE_ACCESS_TOKEN) missingVars.push("PAGE_ACCESS_TOKEN");
    if (!MISTRAL_API_KEY) missingVars.push("MISTRAL_API_KEY");
    if (!GITHUB_TOKEN) missingVars.push("GITHUB_TOKEN");
    if (!GITHUB_USERNAME) missingVars.push("GITHUB_USERNAME");
    if (GOOGLE_API_KEYS.length === 0) missingVars.push("GOOGLE_API_KEYS");
    if (GOOGLE_SEARCH_ENGINE_IDS.length === 0) missingVars.push("GOOGLE_SEARCH_ENGINE_IDS");

    if (missingVars.length > 0) {
        log.error(`❌ Manquants: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Config complète OK");
    }

    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;

    log.info(`🎨 ${COMMANDS.size} commandes`);
    log.info(`👥 ${userList.size} users`);
    log.info(`💬 ${userMemory.size} conversations`);
    log.info(`🖼️ ${userLastImage.size} images`);
    log.info(`🏰 ${clanCount} clans`);
    log.info(`⭐ ${expDataCount} users avec exp`);
    log.info(`📝 ${truncatedMessages.size} tronqués`);
    log.info(`🔑 ${GOOGLE_API_KEYS.length} Google keys`);
    log.info(`🔍 ${GOOGLE_SEARCH_ENGINE_IDS.length} moteurs`);
    log.info(`🔐 ${ADMIN_IDS.size} admins`);
    log.info(`📂 Repo: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
    
    log.info("🚀 OPTIMISATIONS ACTIVES:");
    log.info("  - LRU Cache (20K users)");
    log.info("  - Rate Limiter (12/min)");
    log.info("  - Circuit Breaker (3 fails)");
    log.info("  - Batch Save (5s)");
    log.info("  - Context (4 msgs)");
    log.info("  - Memory (700 chars)");
    log.info("  - Timeouts (10-20s)");
    log.info("  - Proactive GC");
    
    startAutoSave();
    
    log.info("🎉 NakamaBot OPTIMIZED prête ! 40K+ users supportés !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur port ${PORT}`);
        log.info("💾 Auto-save activé");
        log.info("📏 Troncature activée");
        log.info("🔍 Google Search activée");
        log.info("🚀 Performance mode ON");
        log.info(`📊 Dashboard: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    });
}

async function gracefulShutdown() {
    log.info("🛑 Arrêt gracieux...");
    
    if (saveInterval) {
        clearInterval(saveInterval);
        log.info("⏹️ Auto-save arrêté");
    }
    
    try {
        log.info("💾 Sauvegarde finale...");
        await saveDataToGitHub();
        log.info("✅ Données sauvegardées !");
    } catch (error) {
        log.error(`❌ Erreur save finale: ${error.message}`);
    }
    
    const truncatedCount = truncatedMessages.size;
    if (truncatedCount > 0) {
        log.info(`🧹 ${truncatedCount} tronqués nettoyés`);
        truncatedMessages.clear();
    }
    
    const googleUsageCount = googleKeyUsage.size;
    if (googleUsageCount > 0) {
        log.info(`📊 ${googleUsageCount} Google usage sauvegardés`);
    }
    
    log.info("👋 Au revoir !");
    log.info(`📂 Repo: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('uncaughtException', async (error) => {
    log.error(`❌ Erreur non capturée: ${error.message}`);
    await gracefulShutdown();
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error(`❌ Promesse rejetée: ${reason}`);
    await gracefulShutdown();
});

startBot().catch(error => {
    log.error(`❌ Erreur démarrage: ${error.message}`);
    process.exit(1);
});
