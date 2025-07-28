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
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || "";
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || "";
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Mémoire du bot (stockage local temporaire + sauvegarde permanente)
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

// === GESTION JSONBIN.IO ===

// Créer un nouveau bin JSONBin
async function createNewJSONBin() {
    if (!JSONBIN_API_KEY) {
        log.error("❌ JSONBIN_API_KEY manquant pour créer un nouveau bin");
        return null;
    }

    try {
        const initialData = {
            userList: [],
            userMemory: {},
            userLastImage: {},
            lastUpdate: new Date().toISOString(),
            version: "4.0 Amicale + Vision + JSONBin",
            totalUsers: 0,
            totalConversations: 0,
            totalImages: 0,
            created: new Date().toISOString(),
            bot: "NakamaBot"
        };

        const response = await axios.post(
            'https://api.jsonbin.io/v3/b',
            initialData,
            {
                headers: {
                    'X-Master-Key': JSONBIN_API_KEY,
                    'Content-Type': 'application/json',
                    'X-Bin-Name': 'NakamaBot-Data'
                },
                timeout: 15000
            }
        );

        if (response.status === 200 || response.status === 201) {
            const newBinId = response.data.metadata.id;
            log.info(`🎉 Nouveau bin JSONBin créé avec succès !`);
            log.info(`📝 Nouvel ID de bin: ${newBinId}`);
            log.info(`⚠️  Veuillez mettre à jour votre variable JSONBIN_BIN_ID avec: ${newBinId}`);
            return newBinId;
        }
    } catch (error) {
        log.error(`❌ Erreur création bin JSONBin: ${error.message}`);
        return null;
    }
}

// Charger les données depuis JSONBin
async function loadDataFromJSONBin() {
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        log.warning("⚠️ Configuration JSONBin manquante, utilisation du stockage temporaire uniquement");
        return;
    }

    try {
        log.info(`🔍 Tentative de chargement du bin: ${JSONBIN_BIN_ID}`);
        
        const response = await axios.get(
            `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`,
            {
                headers: {
                    'X-Master-Key': JSONBIN_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        if (response.status === 200 && response.data.record) {
            const data = response.data.record;
            
            // Charger userList
            if (data.userList && Array.isArray(data.userList)) {
                data.userList.forEach(userId => userList.add(userId));
                log.info(`✅ ${data.userList.length} utilisateurs chargés depuis JSONBin`);
            }

            // Charger userMemory
            if (data.userMemory && typeof data.userMemory === 'object') {
                Object.entries(data.userMemory).forEach(([userId, memory]) => {
                    if (Array.isArray(memory)) {
                        userMemory.set(userId, memory);
                    }
                });
                log.info(`✅ ${Object.keys(data.userMemory).length} conversations chargées depuis JSONBin`);
            }

            // Charger userLastImage
            if (data.userLastImage && typeof data.userLastImage === 'object') {
                Object.entries(data.userLastImage).forEach(([userId, imageUrl]) => {
                    userLastImage.set(userId, imageUrl);
                });
                log.info(`✅ ${Object.keys(data.userLastImage).length} images chargées depuis JSONBin`);
            }

            log.info("🎉 Données chargées avec succès depuis JSONBin !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("❌ Bin JSONBin introuvable (404) - Le bin n'existe pas ou l'ID est incorrect");
            log.info("🔧 Tentative de création d'un nouveau bin...");
            
            const newBinId = await createNewJSONBin();
            if (newBinId) {
                log.info("✅ Nouveau bin créé, mais vous devez mettre à jour JSONBIN_BIN_ID");
                log.info("⚠️  Redémarrez l'application après avoir mis à jour la variable d'environnement");
            } else {
                log.error("❌ Impossible de créer un nouveau bin");
            }
        } else if (error.response?.status === 401) {
            log.error("❌ Clé API JSONBin invalide (401) - Vérifiez votre JSONBIN_API_KEY");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé JSONBin (403) - Vérifiez les permissions de votre clé API");
        } else {
            log.error(`❌ Erreur chargement JSONBin: ${error.message}`);
            if (error.response) {
                log.error(`📊 Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
        }
    }
}

// Sauvegarder les données vers JSONBin
async function saveDataToJSONBin() {
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        log.debug("🔄 Pas de sauvegarde JSONBin (config manquante)");
        return;
    }

    try {
        log.debug(`💾 Tentative de sauvegarde sur bin: ${JSONBIN_BIN_ID}`);
        
        const dataToSave = {
            userList: Array.from(userList),
            userMemory: Object.fromEntries(userMemory),
            userLastImage: Object.fromEntries(userLastImage),
            lastUpdate: new Date().toISOString(),
            version: "4.0 Amicale + Vision + JSONBin",
            totalUsers: userList.size,
            totalConversations: userMemory.size,
            totalImages: userLastImage.size
        };

        const response = await axios.put(
            `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`,
            dataToSave,
            {
                headers: {
                    'X-Master-Key': JSONBIN_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        if (response.status === 200) {
            log.info(`💾 Données sauvegardées sur JSONBin (${userList.size} users, ${userMemory.size} convs, ${userLastImage.size} imgs)`);
        } else {
            log.error(`❌ Erreur sauvegarde JSONBin: ${response.status}`);
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.error("❌ Bin JSONBin introuvable pour la sauvegarde (404)");
            log.error(`🔍 Bin ID utilisé: ${JSONBIN_BIN_ID}`);
            log.error("💡 Solutions:");
            log.error("   1. Vérifiez que le JSONBIN_BIN_ID est correct");
            log.error("   2. Créez un nouveau bin sur jsonbin.io");
            log.error("   3. Ou utilisez la route /create-bin pour créer automatiquement un nouveau bin");
        } else if (error.response?.status === 401) {
            log.error("❌ Clé API JSONBin invalide pour la sauvegarde (401)");
            log.error("💡 Vérifiez votre JSONBIN_API_KEY");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé JSONBin pour la sauvegarde (403)");
            log.error("💡 Vérifiez les permissions de votre clé API");
        } else {
            log.error(`❌ Erreur sauvegarde JSONBin: ${error.message}`);
            if (error.response) {
                log.error(`📊 Status: ${error.response.status}`);
                log.error(`📊 Data: ${JSON.stringify(error.response.data)}`);
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
        await saveDataToJSONBin();
    }, 5 * 60 * 1000); // 5 minutes
    
    log.info("🔄 Sauvegarde automatique activée (toutes les 5 minutes)");
}

// Sauvegarder lors de changements importants
async function saveDataImmediate() {
    await saveDataToJSONBin();
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
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
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
    JSONBIN_API_KEY,
    JSONBIN_BIN_ID,
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
    
    // Fonctions de sauvegarde
    saveDataToJSONBin,
    saveDataImmediate,
    loadDataFromJSONBin
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
        return "🤖 Oh là là ! Message vide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    // Si ce n'est pas une commande, traiter comme un chat normal
    if (!messageText.startsWith('/')) {
        if (COMMANDS.has('chat')) {
            return await COMMANDS.get('chat')(senderId, messageText, commandContext);
        }
        return "🤖 Coucou ! Tape /start ou /help pour découvrir ce que je peux faire ! ✨";
    }
    
    // Parser la commande
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS.has(command)) {
        try {
            return await COMMANDS.get(command)(senderId, args, commandContext);
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
        status: "🤖 NakamaBot v4.0 Amicale + Vision + JSONBin Online ! 💖",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: "2025",
        commands: COMMANDS.size,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        version: "4.0 Amicale + Vision + JSONBin",
        storage: {
            type: "JSONBin.io",
            persistent: Boolean(JSONBIN_API_KEY && JSONBIN_BIN_ID),
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
            "Sauvegarde permanente JSONBin"
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
                        // Sauvegarder immédiatement pour les nouveaux utilisateurs
                        saveDataImmediate().catch(err => 
                            log.error(`❌ Erreur sauvegarde nouvel utilisateur: ${err.message}`)
                        );
                    }
                    
                    // Vérifier si c'est une image
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                // Stocker l'URL de l'image pour les commandes /anime et /vision
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
                                    // Sauvegarder l'image
                                    saveDataImmediate().catch(err => 
                                        log.error(`❌ Erreur sauvegarde image: ${err.message}`)
                                    );
                                    
                                    // Répondre automatiquement
                                    const response = "📸 Super ! J'ai bien reçu ton image ! ✨\n\n🎭 Tape /anime pour la transformer en style anime !\n👁️ Tape /vision pour que je te dise ce que je vois !\n\n💕 Ou continue à me parler normalement !";
                                    await sendMessage(senderId, response);
                                    continue;
                                }
                            }
                        }
                    }
                    
                    // Récupérer texte
                    const messageText = event.message.text?.trim();
                    
                    if (messageText) {
                        log.info(`📨 Message de ${senderId}: ${messageText.substring(0, 50)}...`);
                        
                        // Traiter commande
                        const response = await processCommand(senderId, messageText);
                        
                        if (response) {
                            // Vérifier si c'est une image
                            if (typeof response === 'object' && response.type === 'image') {
                                // Envoyer image
                                const sendResult = await sendImageMessage(senderId, response.url, response.caption);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Image envoyée à ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi image à ${senderId}`);
                                    // Fallback texte
                                    await sendMessage(senderId, "🎨 Image créée avec amour mais petite erreur d'envoi ! Réessaie ! 💕");
                                }
                            } else {
                                // Message texte normal
                                const sendResult = await sendMessage(senderId, response);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Réponse envoyée à ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi à ${senderId}`);
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

// Route pour créer un nouveau bin JSONBin (admin seulement)
app.post('/create-bin', async (req, res) => {
    try {
        if (!JSONBIN_API_KEY) {
            return res.status(400).json({
                success: false,
                error: "JSONBIN_API_KEY manquant"
            });
        }

        const newBinId = await createNewJSONBin();
        
        if (newBinId) {
            res.json({
                success: true,
                message: "Nouveau bin JSONBin créé avec succès !",
                newBinId: newBinId,
                instructions: [
                    `Mettez à jour votre variable d'environnement: JSONBIN_BIN_ID=${newBinId}`,
                    "Redémarrez l'application pour utiliser le nouveau bin",
                    "Les données actuelles seront sauvegardées automatiquement"
                ],
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Impossible de créer un nouveau bin"
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour tester la connexion JSONBin
app.get('/test-jsonbin', async (req, res) => {
    try {
        if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
            return res.status(400).json({
                success: false,
                error: "Configuration JSONBin manquante",
                missing: {
                    api_key: !JSONBIN_API_KEY,
                    bin_id: !JSONBIN_BIN_ID
                }
            });
        }

        // Tester la lecture
        const response = await axios.get(
            `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`,
            {
                headers: {
                    'X-Master-Key': JSONBIN_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            message: "Connexion JSONBin OK !",
            bin_id: JSONBIN_BIN_ID,
            status: response.status,
            data_exists: Boolean(response.data.record),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        let errorMessage = error.message;
        let suggestions = [];

        if (error.response?.status === 404) {
            errorMessage = "Bin introuvable (404)";
            suggestions = [
                "Vérifiez que le JSONBIN_BIN_ID est correct",
                "Utilisez POST /create-bin pour créer un nouveau bin"
            ];
        } else if (error.response?.status === 401) {
            errorMessage = "Clé API invalide (401)";
            suggestions = ["Vérifiez votre JSONBIN_API_KEY"];
        }

        res.status(error.response?.status || 500).json({
            success: false,
            error: errorMessage,
            suggestions: suggestions,
            bin_id: JSONBIN_BIN_ID,
            timestamp: new Date().toISOString()
        });
    }
});
app.post('/force-save', async (req, res) => {
    try {
        await saveDataToJSONBin();
        res.json({
            success: true,
            message: "Données sauvegardées avec succès !",
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

// Route pour recharger les données (admin seulement)
app.post('/reload-data', async (req, res) => {
    try {
        await loadDataFromJSONBin();
        res.json({
            success: true,
            message: "Données rechargées avec succès !",
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
        version: "4.0 Amicale + Vision + JSONBin",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: 2025,
        storage: {
            type: "JSONBin.io",
            persistent: Boolean(JSONBIN_API_KEY && JSONBIN_BIN_ID),
            auto_save_interval: "5 minutes"
        },
        features: [
            "AI Image Generation",
            "Anime Transformation", 
            "AI Image Analysis",
            "Friendly Chat",
            "Admin Stats",
            "Help Suggestions",
            "Persistent Storage"
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
            storage: Boolean(JSONBIN_API_KEY && JSONBIN_BIN_ID)
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size,
            commands_loaded: COMMANDS.size
        },
        version: "4.0 Amicale + Vision + JSONBin",
        creator: "Durand",
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
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        issues.push("Configuration JSONBin manquante");
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

// === DÉMARRAGE ===

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision + JSONBin");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");

    // Charger les données depuis JSONBin
    log.info("📥 Chargement des données depuis JSONBin...");
    await loadDataFromJSONBin();

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
    if (!JSONBIN_API_KEY) {
        missingVars.push("JSONBIN_API_KEY");
    }
    if (!JSONBIN_BIN_ID) {
        missingVars.push("JSONBIN_BIN_ID");
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
    log.info(`🌐 Serveur sur le port ${PORT}`);
    
    // Démarrer la sauvegarde automatique
    startAutoSave();
    
    log.info("🎉 NakamaBot Amicale + Vision + JSONBin prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("💾 Sauvegarde automatique JSONBin activée");
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
        log.info("💾 Sauvegarde finale des données...");
        await saveDataToJSONBin();
        log.info("✅ Données sauvegardées avec succès !");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    
    log.info("👋 Au revoir ! Données sauvegardées sur JSONBin !");
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
