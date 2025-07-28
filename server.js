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
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Mémoire du bot (stockage local temporaire + sauvegarde permanente GitHub)
const userMemory = new Map();
const userList = new Set();
const userLastImage = new Map();

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

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
        // Vérifier si le repo existe déjà
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
            // Le repo n'existe pas, le créer
            try {
                const createResponse = await axios.post(
                    'https://api.github.com/user/repos',
                    {
                        name: GITHUB_REPO,
                        description: 'Sauvegarde des données NakamaBot - Créé automatiquement',
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

// Charger les données depuis GitHub
async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub manquante, utilisation du stockage temporaire uniquement");
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

            log.info("🎉 Données chargées avec succès depuis GitHub !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde trouvée sur GitHub - Première utilisation");
            log.info("🔧 Création du fichier de sauvegarde initial...");
            
            // Créer le repo si nécessaire
            const repoCreated = await createGitHubRepo();
            if (repoCreated) {
                // Créer la première sauvegarde
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

// Variable pour éviter les sauvegardes simultanées
let isSaving = false;
let saveQueue = [];

// Sauvegarder les données vers GitHub avec gestion des conflits
async function saveDataToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.debug("🔄 Pas de sauvegarde GitHub (config manquante)");
        return;
    }

    // Éviter les sauvegardes simultanées
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
        
        const dataToSave = {
            userList: Array.from(userList),
            userMemory: Object.fromEntries(userMemory),
            userLastImage: Object.fromEntries(userLastImage),
            lastUpdate: new Date().toISOString(),
            version: "4.0 Amicale + Vision + GitHub",
            totalUsers: userList.size,
            totalConversations: userMemory.size,
            totalImages: userLastImage.size,
            bot: "NakamaBot",
            creator: "Durand"
        };

        const commitData = {
            message: `🤖 Sauvegarde automatique NakamaBot - ${new Date().toISOString()}`,
            content: encodeBase64(dataToSave)
        };

        // Retry avec récupération du SHA le plus récent
        let maxRetries = 3;
        let success = false;

        for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
            try {
                // Récupérer le SHA le plus récent à chaque tentative
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
                    log.info(`💾 Données sauvegardées sur GitHub (${userList.size} users, ${userMemory.size} convs, ${userLastImage.size} imgs)`);
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
                    // Fichier n'existe pas encore, pas de SHA nécessaire
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
            log.error("💡 Solutions:");
            log.error("   1. Vérifiez que GITHUB_USERNAME et GITHUB_REPO sont corrects");
            log.error("   2. Créez le repository manuellement sur GitHub");
            log.error("   3. Ou utilisez la route /create-repo pour créer automatiquement");
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide pour la sauvegarde (401)");
            log.error("💡 Vérifiez votre GITHUB_TOKEN");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub pour la sauvegarde (403)");
            log.error("💡 Vérifiez les permissions de votre token (repo, contents)");
        } else if (error.response?.status === 409) {
            log.warning("⚠️ Conflit SHA persistant - sauvegarde ignorée pour éviter les blocages");
        } else {
            log.error(`❌ Erreur sauvegarde GitHub: ${error.message}`);
            if (error.response) {
                log.error(`📊 Status: ${error.response.status}`);
            }
        }
    } finally {
        isSaving = false;
        
        // Traiter la queue des sauvegardes en attente
        const queueCallbacks = [...saveQueue];
        saveQueue = [];
        queueCallbacks.forEach(callback => callback());
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
    // Lancer la sauvegarde en arrière-plan sans attendre
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

// Gestion de la mémoire avec sauvegarde
function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        return;
    }
    
    // Limiter la taille
    if (content.length > 1500) {
        content = content.substring(0, 1400) + "...[tronqué]";
    }
    
    if (!userMemory.has(userId)) {
        userMemory.set(userId, []);
    }
    
    const memory = userMemory.get(userId);
    memory.push({
        type: msgType,
        content: content,
        timestamp: new Date().toISOString()
    });
    
    // Garder seulement les 8 derniers messages
    if (memory.length > 8) {
        memory.shift();
    }
    
    // Sauvegarder de manière asynchrone (pas d'attente)
    saveDataImmediate().catch(err => 
        log.error(`❌ Erreur sauvegarde mémoire: ${err.message}`)
    );
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

// === FONCTIONS D'ENVOI AVEC SAUVEGARDE ===

// Envoyer un message
async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        log.warning("⚠️ Message vide ou invalide");
        return { success: false, error: "Empty or invalid message" };
    }
    
    // Limiter taille
    if (text.length > 2000) {
        text = text.substring(0, 1950) + "...\n✨ [Message tronqué avec amour]";
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: { text: text }
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
            return { success: true, messageId: response.data.message_id };
        } else {
            log.error(`❌ Erreur Facebook API: ${response.status} - ${JSON.stringify(response.data)}`);
            return { success: false, error: `API Error ${response.status}`, details: response.data };
        }
    } catch (error) {
        if (error.response) {
            log.error(`❌ Erreur envoi API: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            return { 
                success: false, 
                error: `API Error ${error.response.status}`, 
                details: error.response.data 
            };
        } else {
            log.error(`❌ Erreur envoi réseau: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

// Envoyer une image
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
            // Envoyer la caption séparément si fournie
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

// Contexte partagé pour toutes les commandes
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
    
    // Fonctions de sauvegarde GitHub
    saveDataToGitHub,
    saveDataImmediate,
    loadDataFromGitHub,
    createGitHubRepo
};

// Fonction pour charger automatiquement toutes les commandes
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
            
            // Supprimer du cache si déjà chargé (pour le rechargement à chaud)
            delete require.cache[require.resolve(commandPath)];
            
            // Charger la commande
            const commandModule = require(commandPath);
            
            // Vérifier que le module exporte une fonction
            if (typeof commandModule !== 'function') {
                log.error(`❌ ${file} doit exporter une fonction`);
                continue;
            }
            
            // Enregistrer la commande
            COMMANDS.set(commandName, commandModule);
            log.info(`✅ Commande '${commandName}' chargée`);
            
        } catch (error) {
            log.error(`❌ Erreur chargement ${file}: ${error.message}`);
        }
    }
    
    log.info(`🎉 ${COMMANDS.size} commandes chargées avec succès !`);
}

// Traiter les commandes utilisateur
async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        log.warning(`⚠️ processCommand: Message invalide de ${senderId}`);
        return "🤖 Oh là là ! Message invalide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    if (messageText.length === 0) {
        log.warning(`⚠️ processCommand: Message vide de ${senderId}`);
        return "🤖 Message vide ! Écris-moi quelque chose ou tape /help ! 💕";
    }
    
    // Si ce n'est pas une commande, traiter comme un chat normal
    if (!messageText.startsWith('/')) {
        if (COMMANDS.has('chat')) {
            try {
                const response = await COMMANDS.get('chat')(senderId, messageText, commandContext);
                return response || "🤖 Hmm, je n'ai pas de réponse ! Tape /help pour voir ce que je peux faire ! ✨";
            } catch (error) {
                log.error(`❌ Erreur commande chat: ${error.message}`);
                return "💥 Oh non ! Petite erreur dans le chat ! Réessaie ou tape /help ! 💕";
            }
        }
        return "🤖 Coucou ! Tape /start ou /help pour découvrir ce que je peux faire ! ✨";
    }
    
    // Parser la commande
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS.has(command)) {
        try {
            const response = await COMMANDS.get(command)(senderId, args, commandContext);
            return response || `🤔 La commande /${command} n'a pas de réponse ! Tape /help ! ✨`;
        } catch (error) {
            log.error(`❌ Erreur commande ${command}: ${error.message}`);
            return `💥 Oh non ! Petite erreur dans /${command} ! Réessaie ou tape /help ! 💕`;
        }
    }
    
    return `❓ Oh ! La commande /${command} m'est inconnue ! Tape /help pour voir tout ce que je sais faire ! ✨💕`;
}

// === ROUTES EXPRESS ===

// Route d'accueil
app.get('/', (req, res) => {
    res.json({
        status: "🤖 NakamaBot v4.0 Amicale + Vision + GitHub Online ! 💖",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: "2025",
        commands: COMMANDS.size,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        version: "4.0 Amicale + Vision + GitHub",
        storage: {
            type: "GitHub API",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            auto_save: "Every 5 minutes"
        },
        features: [
            "Génération d'images IA",
            "Transformation anime", 
            "Analyse d'images IA",
            "Chat intelligent et doux",
            "Broadcast admin",
            "Recherche 2025",
            "Stats réservées admin",
            "Sauvegarde permanente GitHub"
        ],
        last_update: new Date().toISOString()
    });
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
        log.warning('❌ Échec vérification webhook');
        res.status(403).send('Verification failed');
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data) {
            log.warning('⚠️ Aucune donnée reçue');
            return res.status(400).json({ error: "No data received" });
        }
        
        // Traiter les messages
        for (const entry of data.entry || []) {
            for (const event of entry.messaging || []) {
                const senderId = event.sender?.id;
                
                if (!senderId) {
                    continue;
                }
                
                const senderIdStr = String(senderId);
                
                // Messages non-echo
                if (event.message && !event.message.is_echo) {
                    // Ajouter utilisateur avec sauvegarde
                    const wasNewUser = !userList.has(senderIdStr);
                    userList.add(senderIdStr);
                    
                    if (wasNewUser) {
                        log.info(`👋 Nouvel utilisateur: ${senderId}`);
                        // Sauvegarder en arrière-plan pour les nouveaux utilisateurs
                        saveDataImmediate();
                    }
                    
                    let messageProcessed = false;
                    
                    // Vérifier si c'est une image
                    if (event.message.attachments && event.message.attachments.length > 0) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                // Stocker l'URL de l'image pour les commandes /anime et /vision
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
                                    // Sauvegarder l'image en arrière-plan
                                    saveDataImmediate();
                                    
                                    // Répondre automatiquement
                                    const response = "📸 Super ! J'ai bien reçu ton image ! ✨\n\n🎭 Tape /anime pour la transformer en style anime !\n👁️ Tape /vision pour que je te dise ce que je vois !\n\n💕 Ou continue à me parler normalement !";
                                    const sendResult = await sendMessage(senderId, response);
                                    
                                    if (sendResult.success) {
                                        log.info(`✅ Réponse image envoyée à ${senderId}`);
                                    } else {
                                        log.error(`❌ Échec envoi réponse image à ${senderId}: ${sendResult.error}`);
                                    }
                                    
                                    messageProcessed = true;
                                }
                            }
                        }
                    }
                    
                    // Traiter le texte seulement si on n'a pas déjà traité une image
                    if (!messageProcessed) {
                        const messageText = event.message.text?.trim();
                        
                        if (messageText) {
                            log.info(`📨 Message de ${senderId}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`);
                            
                            try {
                                // Traiter commande
                                const response = await processCommand(senderId, messageText);
                                
                                if (response) {
                                    // Vérifier si c'est une image
                                    if (typeof response === 'object' && response.type === 'image') {
                                        // Envoyer image
                                        const sendResult = await sendImageMessage(senderId, response.url, response.caption);
                                        
                                        if (sendResult.success) {
                                            log.info(`✅ Image générée envoyée à ${senderId}`);
                                        } else {
                                            log.error(`❌ Échec envoi image générée à ${senderId}: ${sendResult.error}`);
                                            // Fallback texte
                                            const fallbackResult = await sendMessage(senderId, "🎨 Image créée avec amour mais petite erreur d'envoi ! Réessaie ! 💕");
                                            if (fallbackResult.success) {
                                                log.info(`✅ Message fallback envoyé à ${senderId}`);
                                            } else {
                                                log.error(`❌ Échec envoi fallback à ${senderId}: ${fallbackResult.error}`);
                                            }
                                        }
                                    } else if (typeof response === 'string' && response.length > 0) {
                                        // Message texte normal
                                        const sendResult = await sendMessage(senderId, response);
                                        
                                        if (sendResult.success) {
                                            log.info(`✅ Réponse envoyée à ${senderId}`);
                                        } else {
                                            log.error(`❌ Échec envoi réponse à ${senderId}: ${sendResult.error}`);
                                            
                                            // Essayer d'envoyer un message d'erreur générique
                                            const errorResult = await sendMessage(senderId, "💔 Oh non ! Petite erreur technique ! Réessaie dans quelques secondes ! 💕");
                                            if (errorResult.success) {
                                                log.info(`✅ Message d'erreur envoyé à ${senderId}`);
                                            } else {
                                                log.error(`❌ Impossible d'envoyer même le message d'erreur à ${senderId}`);
                                            }
                                        }
                                    } else {
                                        log.warning(`⚠️ Réponse invalide pour ${senderId}: ${typeof response} - ${JSON.stringify(response).substring(0, 100)}`);
                                        
                                        // Envoyer un message d'erreur
                                        const errorResult = await sendMessage(senderId, "🤔 Hmm, j'ai eu un petit souci avec ma réponse ! Peux-tu réessayer ? 💕");
                                        if (errorResult.success) {
                                            log.info(`✅ Message d'erreur réponse invalide envoyé à ${senderId}`);
                                        } else {
                                            log.error(`❌ Échec envoi message d'erreur à ${senderId}: ${errorResult.error}`);
                                        }
                                    }
                                } else {
                                    log.warning(`⚠️ Aucune réponse générée pour ${senderId} avec le message: ${messageText}`);
                                    
                                    // Envoyer une réponse par défaut
                                    const defaultResult = await sendMessage(senderId, "🤖 Désolée, je n'ai pas bien compris ! Tape /help pour voir ce que je peux faire ! ✨");
                                    if (defaultResult.success) {
                                        log.info(`✅ Réponse par défaut envoyée à ${senderId}`);
                                    } else {
                                        log.error(`❌ Échec envoi réponse par défaut à ${senderId}: ${defaultResult.error}`);
                                    }
                                }
                            } catch (commandError) {
                                log.error(`❌ Erreur traitement commande pour ${senderId}: ${commandError.message}`);
                                
                                // Envoyer un message d'erreur à l'utilisateur
                                const errorResult = await sendMessage(senderId, "💥 Oups ! J'ai eu un petit problème ! Réessaie ou tape /help ! 💕");
                                if (errorResult.success) {
                                    log.info(`✅ Message d'erreur commande envoyé à ${senderId}`);
                                } else {
                                    log.error(`❌ Échec envoi message d'erreur commande à ${senderId}: ${errorResult.error}`);
                                }
                            }
                        } else {
                            log.warning(`⚠️ Message vide reçu de ${senderId}`);
                            
                            // Répondre pour les messages vides
                            const emptyResult = await sendMessage(senderId, "🤔 J'ai reçu un message vide ! Écris-moi quelque chose ou tape /help ! 💕");
                            if (emptyResult.success) {
                                log.info(`✅ Réponse message vide envoyée à ${senderId}`);
                            } else {
                                log.error(`❌ Échec envoi réponse message vide à ${senderId}: ${emptyResult.error}`);
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`❌ Erreur webhook: ${error.message}`);
        log.error(`❌ Stack trace: ${error.stack}`);
        return res.status(500).json({ error: `Webhook error: ${error.message}` });
    }
    
    res.status(200).json({ status: "ok" });
});


// Route pour créer un nouveau repository GitHub (admin seulement)
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
                    "Les données seront sauvegardées automatiquement",
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

        // Tester l'accès au repository
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

// Route pour forcer une sauvegarde
app.post('/force-save', async (req, res) => {
    try {
        await saveDataToGitHub();
        res.json({
            success: true,
            message: "Données sauvegardées avec succès sur GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size
            }
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
        await loadDataFromGitHub();
        res.json({
            success: true,
            message: "Données rechargées avec succès depuis GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Statistiques publiques limitées
app.get('/stats', (req, res) => {
    res.json({
        users_count: userList.size,
        conversations_count: userMemory.size,
        images_stored: userLastImage.size,
        commands_available: COMMANDS.size,
        version: "4.0 Amicale + Vision + GitHub",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: 2025,
        storage: {
            type: "GitHub API",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            auto_save_interval: "5 minutes"
        },
        features: [
            "AI Image Generation",
            "Anime Transformation", 
            "AI Image Analysis",
            "Friendly Chat",
            "Admin Stats",
            "Help Suggestions",
            "GitHub Persistent Storage"
        ],
        note: "Statistiques détaillées réservées aux admins via /stats"
    });
});

// Santé du bot
app.get('/health', (req, res) => {
    const healthStatus = {
        status: "healthy",
        personality: "Super gentille et amicale, comme une très bonne amie 💖",
        services: {
            ai: Boolean(MISTRAL_API_KEY),
            vision: Boolean(MISTRAL_API_KEY),
            facebook: Boolean(PAGE_ACCESS_TOKEN),
            github_storage: Boolean(GITHUB_TOKEN && GITHUB_USERNAME)
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size,
            commands_loaded: COMMANDS.size
        },
        version: "4.0 Amicale + Vision + GitHub",
        creator: "Durand",
        repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
        timestamp: new Date().toISOString()
    };
    
    // Vérifier problèmes
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
    
    if (issues.length > 0) {
        healthStatus.status = "degraded";
        healthStatus.issues = issues;
    }
    
    const statusCode = healthStatus.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(healthStatus);
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
                per_page: 10 // Derniers 10 commits
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

// === DÉMARRAGE ===

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision + GitHub");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");

    // Charger les données depuis GitHub
    log.info("📥 Chargement des données depuis GitHub...");
    await loadDataFromGitHub();

    // Charger toutes les commandes
    loadCommands();

    // Vérifier variables
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
        log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration complète OK");
    }

    log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
    log.info(`👥 ${userList.size} utilisateurs en mémoire`);
    log.info(`💬 ${userMemory.size} conversations en mémoire`);
    log.info(`🖼️ ${userLastImage.size} images en mémoire`);
    log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
    log.info(`📂 Repository: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
    log.info(`🌐 Serveur sur le port ${PORT}`);
    
    // Démarrer la sauvegarde automatique
    startAutoSave();
    
    log.info("🎉 NakamaBot Amicale + Vision + GitHub prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("💾 Sauvegarde automatique GitHub activée");
        log.info(`📊 Dashboard: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    });
}

// Fonction de nettoyage lors de l'arrêt
async function gracefulShutdown() {
    log.info("🛑 Arrêt du bot avec tendresse...");
    
    // Arrêter la sauvegarde automatique
    if (saveInterval) {
        clearInterval(saveInterval);
        log.info("⏹️ Sauvegarde automatique arrêtée");
    }
    
    // Sauvegarder une dernière fois
    try {
        log.info("💾 Sauvegarde finale des données sur GitHub...");
        await saveDataToGitHub();
        log.info("✅ Données sauvegardées avec succès !");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    
    log.info("👋 Au revoir ! Données sauvegardées sur GitHub !");
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

// Démarrer le bot
startBot().catch(error => {
    log.error(`❌ Erreur démarrage: ${error.message}`);
    process.exit(1);
});
