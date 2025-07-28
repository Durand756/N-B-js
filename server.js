const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// Configuration
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "nakamaverifytoken";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Configuration Google Drive
const DRIVE_CONFIG = {
    client_email: process.env.DRIVE_CLIENT_EMAIL,
    private_key: process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    private_key_id: process.env.DRIVE_PRIVATE_KEY_ID,
    project_id: process.env.DRIVE_PROJECT_ID,
    folder_id: process.env.DRIVE_FOLDER_ID
};

// Stockage local temporaire (cache)
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

// === GOOGLE DRIVE INTEGRATION ===

let driveClient = null;

// Initialiser Google Drive
async function initGoogleDrive() {
    try {
        if (!DRIVE_CONFIG.client_email || !DRIVE_CONFIG.private_key) {
            log.error("❌ Configuration Google Drive manquante");
            return false;
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                type: 'service_account',
                project_id: DRIVE_CONFIG.project_id,
                private_key_id: DRIVE_CONFIG.private_key_id,
                private_key: DRIVE_CONFIG.private_key,
                client_email: DRIVE_CONFIG.client_email,
                client_id: process.env.DRIVE_CLIENT_ID,
            },
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });

        driveClient = google.drive({ version: 'v3', auth });
        
        // Test de connexion
        await driveClient.about.get({ fields: 'user' });
        log.info("✅ Google Drive initialisé avec succès");
        return true;
    } catch (error) {
        log.error(`❌ Erreur initialisation Google Drive: ${error.message}`);
        return false;
    }
}

// Sauvegarder les données utilisateurs sur Drive
async function saveToDrive(fileName, data) {
    if (!driveClient) {
        log.warning("⚠️ Google Drive non initialisé");
        return false;
    }

    try {
        const jsonData = JSON.stringify(data, null, 2);
        
        // Vérifier si le fichier existe déjà
        const existingFiles = await driveClient.files.list({
            q: `name='${fileName}' and parents in '${DRIVE_CONFIG.folder_id}' and trashed=false`,
            fields: 'files(id, name)'
        });

        if (existingFiles.data.files.length > 0) {
            // Mettre à jour le fichier existant
            const fileId = existingFiles.data.files[0].id;
            await driveClient.files.update({
                fileId: fileId,
                media: {
                    mimeType: 'application/json',
                    body: jsonData
                }
            });
            log.debug(`💾 Fichier ${fileName} mis à jour sur Drive`);
        } else {
            // Créer un nouveau fichier
            await driveClient.files.create({
                requestBody: {
                    name: fileName,
                    parents: [DRIVE_CONFIG.folder_id],
                    mimeType: 'application/json'
                },
                media: {
                    mimeType: 'application/json',
                    body: jsonData
                }
            });
            log.debug(`💾 Fichier ${fileName} créé sur Drive`);
        }
        
        return true;
    } catch (error) {
        log.error(`❌ Erreur sauvegarde Drive ${fileName}: ${error.message}`);
        return false;
    }
}

// Charger les données depuis Drive
async function loadFromDrive(fileName) {
    if (!driveClient) {
        log.warning("⚠️ Google Drive non initialisé");
        return null;
    }

    try {
        const files = await driveClient.files.list({
            q: `name='${fileName}' and parents in '${DRIVE_CONFIG.folder_id}' and trashed=false`,
            fields: 'files(id, name)'
        });

        if (files.data.files.length === 0) {
            log.debug(`📂 Fichier ${fileName} non trouvé sur Drive`);
            return null;
        }

        const fileId = files.data.files[0].id;
        const response = await driveClient.files.get({
            fileId: fileId,
            alt: 'media'
        });

        log.debug(`📂 Fichier ${fileName} chargé depuis Drive`);
        return JSON.parse(response.data);
    } catch (error) {
        log.error(`❌ Erreur chargement Drive ${fileName}: ${error.message}`);
        return null;
    }
}

// Charger toutes les données au démarrage
async function loadAllUserData() {
    try {
        // Charger la mémoire des utilisateurs
        const memoryData = await loadFromDrive('user_memory.json');
        if (memoryData) {
            for (const [userId, memory] of Object.entries(memoryData)) {
                userMemory.set(userId, memory);
            }
            log.info(`📚 ${Object.keys(memoryData).length} mémoires utilisateur chargées`);
        }

        // Charger la liste des utilisateurs
        const userListData = await loadFromDrive('user_list.json');
        if (userListData && Array.isArray(userListData)) {
            userListData.forEach(userId => userList.add(userId));
            log.info(`👥 ${userListData.length} utilisateurs chargés`);
        }

        // Charger les dernières images
        const lastImageData = await loadFromDrive('user_last_images.json');
        if (lastImageData) {
            for (const [userId, imageUrl] of Object.entries(lastImageData)) {
                userLastImage.set(userId, imageUrl);
            }
            log.info(`🖼️ ${Object.keys(lastImageData).length} dernières images chargées`);
        }

        log.info("✅ Toutes les données utilisateur chargées depuis Drive");
    } catch (error) {
        log.error(`❌ Erreur chargement données: ${error.message}`);
    }
}

// Sauvegarder toutes les données
async function saveAllUserData() {
    try {
        // Sauvegarder la mémoire utilisateur
        const memoryObject = Object.fromEntries(userMemory);
        await saveToDrive('user_memory.json', memoryObject);

        // Sauvegarder la liste des utilisateurs
        const userListArray = Array.from(userList);
        await saveToDrive('user_list.json', userListArray);

        // Sauvegarder les dernières images
        const lastImageObject = Object.fromEntries(userLastImage);
        await saveToDrive('user_last_images.json', lastImageObject);

        log.debug("💾 Toutes les données sauvegardées sur Drive");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde données: ${error.message}`);
    }
}

// Sauvegarde automatique périodique
setInterval(async () => {
    await saveAllUserData();
}, 5 * 60 * 1000); // Toutes les 5 minutes

// === FONCTIONS UTILITAIRES ===

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
    
    // Sauvegarde asynchrone (sans attendre)
    saveAllUserData().catch(error => {
        log.error(`❌ Erreur sauvegarde mémoire: ${error.message}`);
    });
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
    
    // Nouvelles fonctions Drive
    saveToDrive,
    loadFromDrive,
    saveAllUserData,
    loadAllUserData
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
        status: "🤖 NakamaBot v4.0 Amicale + Vision + Drive Online ! 💖",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: "2025",
        commands: COMMANDS.size,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        version: "4.0 Amicale + Vision + Drive",
        storage: "Google Drive Permanent",
        features: [
            "Génération d'images IA",
            "Transformation anime", 
            "Analyse d'images IA",
            "Chat intelligent et doux",
            "Broadcast admin",
            "Recherche 2025",
            "Stats réservées admin",
            "Sauvegarde permanente Drive"
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
                    // Ajouter utilisateur et sauvegarder
                    if (!userList.has(senderIdStr)) {
                        userList.add(senderIdStr);
                        saveAllUserData().catch(error => {
                            log.error(`❌ Erreur sauvegarde nouvel utilisateur: ${error.message}`);
                        });
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
                                    
                                    // Sauvegarder asynchrone
                                    saveAllUserData().catch(error => {
                                        log.error(`❌ Erreur sauvegarde image: ${error.message}`);
                                    });
                                    
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

// Statistiques publiques limitées
app.get('/stats', (req, res) => {
    res.json({
        users_count: userList.size,
        conversations_count: userMemory.size,
        images_stored: userLastImage.size,
        commands_available: COMMANDS.size,
        version: "4.0 Amicale + Vision + Drive",
        storage: "Google Drive Permanent",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: 2025,
        features: [
            "AI Image Generation",
            "Anime Transformation", 
            "AI Image Analysis",
            "Friendly Chat",
            "Admin Stats",
            "Help Suggestions",
            "Permanent Drive Storage"
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
            drive: Boolean(driveClient)
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size,
            commands_loaded: COMMANDS.size
        },
        version: "4.0 Amicale + Vision + Drive",
        storage: "Google Drive Permanent",
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
    if (!driveClient) {
        issues.push("Google Drive non connecté");
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

// Route pour forcer la sauvegarde (admin uniquement)
app.post('/save', async (req, res) => {
    try {
        await saveAllUserData();
        res.json({
            success: true,
            message: "Données sauvegardées sur Google Drive",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// === DÉMARRAGE ===

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision + Drive");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");
    log.info("💾 Stockage: Google Drive Permanent");

    // Initialiser Google Drive
    const driveInitialized = await initGoogleDrive();
    if (driveInitialized) {
        // Charger les données existantes
        await loadAllUserData();
    } else {
        log.warning("⚠️ Google Drive non initialisé - fonctionnement en mode local");
    }

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
    if (!DRIVE_CONFIG.client_email || !DRIVE_CONFIG.private_key) {
        missingVars.push("DRIVE_CONFIG (client_email, private_key)");
    }

    if (missingVars.length > 0) {
        log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration OK");
    }

    log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
    log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
    log.info(`👥 ${userList.size} utilisateurs chargés`);
    log.info(`📚 ${userMemory.size} conversations chargées`);
    log.info(`🖼️ ${userLastImage.size} dernières images chargées`);
    log.info(`🌐 Serveur sur le port ${PORT}`);
    log.info("🎉 NakamaBot Amicale + Vision + Drive prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
    });
}

// Gestion propre de l'arrêt avec sauvegarde finale
process.on('SIGINT', async () => {
    log.info("🛑 Arrêt du bot - Sauvegarde finale...");
    try {
        await saveAllUserData();
        log.info("💾 Sauvegarde finale terminée avec tendresse");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log.info("🛑 Arrêt du bot - Sauvegarde finale...");
    try {
        await saveAllUserData();
        log.info("💾 Sauvegarde finale terminée avec tendresse");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    process.exit(0);
});

// Sauvegarde d'urgence en cas d'erreur non gérée
process.on('uncaughtException', async (error) => {
    log.error(`❌ Erreur non gérée: ${error.message}`);
    try {
        await saveAllUserData();
        log.info("💾 Sauvegarde d'urgence effectuée");
    } catch (saveError) {
        log.error(`❌ Erreur sauvegarde d'urgence: ${saveError.message}`);
    }
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error(`❌ Promesse rejetée non gérée: ${reason}`);
    try {
        await saveAllUserData();
        log.info("💾 Sauvegarde d'urgence effectuée");
    } catch (saveError) {
        log.error(`❌ Erreur sauvegarde d'urgence: ${saveError.message}`);
    }
});

// Démarrer le bot
startBot().catch(error => {
    log.error(`❌ Erreur démarrage: ${error.message}`);
    process.exit(1);
});
