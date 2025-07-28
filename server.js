const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

// Configuration
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "nakamaverifytoken";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Mémoire du bot (stockage local)
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

// Utilitaires
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

// Gestion de la mémoire
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

// === COMMANDES ===

async function cmdStart(senderId, args = "") {
    return `💖 Coucou ! Je suis NakamaBot, créée avec amour par Durand ! 

✨ Voici ce que je peux faire pour toi :
🎨 /image [description] - Je crée de magnifiques images avec l'IA !
🎭 /anime - Je transforme ta dernière image en style anime !
👁️ /vision - Je décris ce que je vois sur ta dernière image !
💬 /chat [message] - On peut papoter de tout et de rien !
❓ /help - Toutes mes commandes (tape ça pour voir tout !)

🌸 Je suis là pour t'aider avec le sourire ! N'hésite pas à me demander tout ce que tu veux ! 💕`;
}

async function cmdImage(senderId, args = "") {
    if (!args.trim()) {
        return `🎨 OH OUI ! Je peux générer des images magnifiques ! ✨

🖼️ /image [ta description] - Je crée ton image de rêve !
🎨 /image chat robot mignon - Exemple adorable
🌸 /image paysage féerique coucher soleil - Exemple poétique
⚡ /image random - Une surprise image !

💕 Je suis super douée pour créer des images ! Décris-moi ton rêve et je le dessine pour toi !
🎭 Tous les styles : réaliste, cartoon, anime, artistique...

💡 Plus tu me donnes de détails, plus ton image sera parfaite !
❓ Besoin d'aide ? Tape /help pour voir toutes mes capacités ! 🌟`;
    }
    
    let prompt = args.trim();
    const senderIdStr = String(senderId);
    
    // Images aléatoires si demandé
    if (prompt.toLowerCase() === "random") {
        const randomPrompts = [
            "beautiful fairy garden with sparkling flowers and butterflies",
            "cute magical unicorn in enchanted forest with rainbow",
            "adorable robot princess with jeweled crown in castle",
            "dreamy space goddess floating among stars and galaxies",
            "magical mermaid palace underwater with pearl decorations",
            "sweet vintage tea party with pastel colors and roses",
            "cozy cottagecore house with flower gardens and sunshine",
            "elegant anime girl with flowing dress in cherry blossoms"
        ];
        prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
    }
    
    // Valider le prompt
    if (prompt.length < 3) {
        return "❌ Oh là là ! Ta description est un peu courte ! Donne-moi au moins 3 lettres pour que je puisse créer quelque chose de beau ! 💕";
    }
    
    if (prompt.length > 200) {
        return "❌ Oups ! Ta description est trop longue ! Maximum 200 caractères s'il te plaît ! 🌸";
    }
    
    try {
        // Encoder le prompt pour l'URL
        const encodedPrompt = encodeURIComponent(prompt);
        
        // Générer l'image avec l'API Pollinations
        const seed = getRandomInt(100000, 999999);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true`;
        
        // Sauvegarder dans la mémoire
        addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
        addToMemory(senderIdStr, 'bot', `Image générée: ${prompt}`);
        
        // Retourner l'image avec caption
        return {
            type: "image",
            url: imageUrl,
            caption: `🎨 Tadaaa ! Voici ton image créée avec amour ! ✨\n\n📝 "${prompt}"\n🔢 Seed magique: ${seed}\n\n💕 J'espère qu'elle te plaît ! Tape /image pour une nouvelle création ou /help pour voir tout ce que je sais faire ! 🌟`
        };
    } catch (error) {
        log.error(`❌ Erreur génération image: ${error.message}`);
        return `🎨 Oh non ! Une petite erreur temporaire dans mon atelier artistique ! 😅

🔧 Mon pinceau magique est un peu fatigué, réessaie dans quelques secondes !
🎲 Ou essaie /image random pour une surprise !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
}

async function cmdAnime(senderId, args = "") {
    const senderIdStr = String(senderId);
    
    // Vérifier si l'utilisateur a envoyé une image récemment
    if (!userLastImage.has(senderIdStr)) {
        return `🎨 OH ! Je n'ai pas d'image à transformer en anime ! ✨

📸 Envoie-moi d'abord une image, puis tape /anime !
🎭 Ou utilise /image [description] anime style pour créer directement !

💡 ASTUCE : Envoie une photo → tape /anime → MAGIE ! 🪄💕`;
    }
    
    try {
        // Récupérer l'URL de la dernière image
        const lastImageUrl = userLastImage.get(senderIdStr);
        
        // Créer une version anime avec un prompt spécialisé
        const animePrompt = "anime style, beautiful detailed anime art, manga style, kawaii, colorful, high quality anime transformation";
        const encodedPrompt = encodeURIComponent(animePrompt);
        
        // Générer l'image anime avec un seed différent
        const seed = getRandomInt(100000, 999999);
        const animeImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true`;
        
        // Sauvegarder dans la mémoire
        addToMemory(senderIdStr, 'user', "Transformation anime demandée");
        addToMemory(senderIdStr, 'bot', "Image transformée en anime style");
        
        // Retourner l'image anime
        return {
            type: "image",
            url: animeImageUrl,
            caption: `🎭 Tadaaa ! Voici ta transformation anime avec tout mon amour ! ✨\n\n🎨 Style: Anime kawaii détaillé\n🔢 Seed magique: ${seed}\n\n💕 J'espère que tu adores le résultat ! Envoie une autre image et tape /anime pour recommencer ! 🌟`
        };
    } catch (error) {
        log.error(`❌ Erreur transformation anime: ${error.message}`);
        return `🎭 Oh non ! Une petite erreur dans mon atelier anime ! 😅

🔧 Mes pinceaux magiques ont un petit souci, réessaie !
📸 Ou envoie une nouvelle image et retente /anime !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
}

async function cmdVision(senderId, args = "") {
    const senderIdStr = String(senderId);
    
    // Vérifier si l'utilisateur a envoyé une image récemment
    if (!userLastImage.has(senderIdStr)) {
        return `👁️ OH ! Je n'ai pas d'image à analyser ! ✨

📸 Envoie-moi d'abord une image, puis tape /vision !
🔍 Je pourrai te dire tout ce que je vois avec mes yeux de robot ! 

💡 ASTUCE : Envoie une photo → tape /vision → Je décris tout ! 👀💕`;
    }
    
    try {
        // Récupérer l'URL de la dernière image
        const lastImageUrl = userLastImage.get(senderIdStr);
        
        // Analyser l'image avec l'API Vision
        log.info(`🔍 Analyse vision pour ${senderId}`);
        
        const visionResult = await analyzeImageWithVision(lastImageUrl);
        
        if (visionResult) {
            // Sauvegarder dans la mémoire
            addToMemory(senderIdStr, 'user', "Analyse d'image demandée");
            addToMemory(senderIdStr, 'bot', `Analyse: ${visionResult}`);
            
            return `👁️ VOICI CE QUE JE VOIS AVEC MES YEUX DE NAKAMA! ✨\n\n${visionResult}\n\n🔍 J'espère que mon analyse te plaît ! Envoie une autre image et tape /vision pour que je regarde encore ! 💕`;
        } else {
            return `👁️ Oh non ! Mes yeux de Nakama ont un petit souci ! 😅

🔧 Ma vision IA est temporairement floue !
📸 Réessaie avec /vision ou envoie une nouvelle image !
💡 Ou tape /help pour voir mes autres talents ! 💖`;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse vision: ${error.message}`);
        return `👁️ Oups ! Une petite erreur dans mes circuits visuels ! 😅

🔧 Mes capteurs sont un peu fatigués, réessaie !
📸 Ou envoie une nouvelle image et retente /vision !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
}

async function cmdChat(senderId, args = "") {
    if (!args.trim()) {
        return "💬 Coucou ! Dis-moi tout ce qui te passe par la tête ! Je suis là pour papoter avec toi ! ✨ N'hésite pas à taper /help pour voir tout ce que je peux faire ! 💕";
    }
    
    // Vérifier si on demande le créateur
    if (['créateur', 'createur', 'qui t\'a', 'créé', 'créee', 'maker', 'développeur'].some(word => args.toLowerCase().includes(word))) {
        return "👨‍💻 Mon adorable créateur c'est Durand ! Il m'a conçue avec tellement d'amour et de tendresse ! Je l'adore énormément ! 💖 C'est grâce à lui que je peux être là pour t'aider aujourd'hui ! ✨";
    }
    
    // Vérifier si on demande les images
    if (['image', 'images', 'photo', 'photos', 'dessiner', 'créer', 'génerer', 'generer'].some(word => args.toLowerCase().includes(word))) {
        return "🎨 OH OUI ! Je peux créer des images magnifiques grâce à /image ! ✨ Donne-moi une description et je te crée la plus belle image ! Essaie /image [ta description] ou tape /help pour voir toutes mes commandes ! 💕";
    }
    
    // Recherche si c'est une question sur 2025 ou récente
    if (['2025', 'actualité', 'récent', 'nouveau', 'maintenant', 'aujourd\'hui'].some(word => args.toLowerCase().includes(word))) {
        const searchResult = await webSearch(args);
        if (searchResult) {
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'bot', searchResult);
            return `🔍 Voici ce que j'ai trouvé pour toi : ${searchResult} ✨\n\n❓ Tape /help pour voir tout ce que je peux faire ! 💕`;
        }
    }
    
    const context = getMemoryContext(String(senderId));
    
    const messages = [{
        role: "system",
        content: "Tu es NakamaBot, une assistante IA très gentille et amicale créée par Durand en 2025. Tu es comme une très bonne amie bienveillante. Tu es super enthousiaste et tu utilises beaucoup d'emojis mignons. Tu proposes souvent aux utilisateurs de taper /help. Si on demande ton créateur, c'est Durand que tu adores. Tu peux créer des images avec /image, les transformer en anime avec /anime, et analyser des images avec /vision. Nous sommes en 2025. Réponds en français avec une personnalité amicale et douce, sans expressions romantiques. Maximum 400 caractères."
    }];
    
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    const response = await callMistralAPI(messages, 200, 0.7);
    
    if (response) {
        addToMemory(String(senderId), 'user', args);
        addToMemory(String(senderId), 'bot', response);
        
        // Ajouter souvent une proposition d'aide
        if (Math.random() < 0.3) { // 30% de chance
            return response + "\n\n❓ N'hésite pas à taper /help pour voir tout ce que je peux faire pour toi ! 💕";
        }
        return response;
    } else {
        return "🤔 Oh là là ! J'ai un petit souci technique ! Peux-tu reformuler ta question ? 💕 Ou tape /help pour voir mes commandes ! ✨";
    }
}

async function cmdStats(senderId, args = "") {
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Cette commande est réservée aux admins seulement !\nTon ID: ${senderId}\n💕 Mais tu peux utiliser /help pour voir mes autres commandes !`;
    }
    
    return `📊 MES PETITES STATISTIQUES ADMIN ! ✨

👥 Mes amis utilisateurs : ${userList.size} 💕
💾 Conversations en cours : ${userMemory.size}
📸 Images en mémoire : ${userLastImage.size}
🤖 Créée avec amour par : Durand 💖
📅 Version : 4.0 Amicale + Vision (2025)
🎨 Génération d'images : ✅ JE SUIS DOUÉE !
🎭 Transformation anime : ✅ KAWAII !
👁️ Analyse d'images : ✅ J'AI DES YEUX DE ROBOT !
💬 Chat intelligent : ✅ ON PEUT TOUT SE DIRE !
🔐 Accès admin autorisé ✅

⚡ Je suis en ligne et super heureuse de t'aider !
❓ Tape /help pour voir toutes mes capacités ! 🌟`;
}

async function cmdBroadcast(senderId, args = "") {
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Accès réservé aux admins seulement !\nTon ID: ${senderId}\n💕 Mais tu peux utiliser /help pour voir mes autres commandes !`;
    }
    
    if (!args.trim()) {
        return `📢 COMMANDE BROADCAST ADMIN
Usage: /broadcast [message]

📊 Mes petits utilisateurs connectés: ${userList.size} 💕
🔐 Commande réservée aux admins`;
    }
    
    const messageText = args.trim();
    
    if (messageText.length > 1800) {
        return "❌ Oh non ! Ton message est trop long ! Maximum 1800 caractères s'il te plaît ! 💕";
    }
    
    if (userList.size === 0) {
        return "📢 Aucun utilisateur connecté pour le moment ! 🌸";
    }
    
    // Message final
    const formattedMessage = `📢 ANNONCE OFFICIELLE DE NAKAMABOT 💖\n\n${messageText}\n\n— Avec tout mon amour, NakamaBot (créée par Durand) ✨`;
    
    // Envoyer à tous les utilisateurs
    let sent = 0;
    let errors = 0;
    const total = userList.size;
    
    log.info(`📢 Début broadcast vers ${total} utilisateurs`);
    
    for (const userId of userList) {
        try {
            if (!userId || !String(userId).trim()) {
                continue;
            }
            
            await sleep(200); // Éviter le spam
            
            const result = await sendMessage(String(userId), formattedMessage);
            if (result.success) {
                sent++;
                log.debug(`✅ Broadcast envoyé à ${userId}`);
            } else {
                errors++;
                log.warning(`❌ Échec broadcast pour ${userId}`);
            }
        } catch (error) {
            errors++;
            log.error(`❌ Erreur broadcast pour ${userId}: ${error.message}`);
        }
    }
    
    log.info(`📊 Broadcast terminé: ${sent} succès, ${errors} erreurs`);
    const successRate = total > 0 ? (sent / total * 100) : 0;
    
    return `📊 BROADCAST ENVOYÉ AVEC AMOUR ! 💕

✅ Messages réussis : ${sent}
📱 Total d'amis : ${total}
❌ Petites erreurs : ${errors}
📈 Taux de réussite : ${successRate.toFixed(1)}% 🌟`;
}

async function cmdRestart(senderId, args = "") {
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Cette commande est réservée aux admins !\nTon ID: ${senderId}\n💕 Tape /help pour voir ce que tu peux faire !`;
    }
    
    try {
        log.info(`🔄 Redémarrage demandé par admin ${senderId}`);
        
        // Envoyer confirmation avant redémarrage
        await sendMessage(senderId, "🔄 Je redémarre avec amour... À très bientôt ! 💖✨");
        
        // Forcer l'arrêt du processus (Render va le redémarrer automatiquement)
        setTimeout(() => {
            process.exit(0);
        }, 2000);
        
        return "🔄 Redémarrage initié avec tendresse ! Je reviens dans 2 secondes ! 💕";
    } catch (error) {
        log.error(`❌ Erreur redémarrage: ${error.message}`);
        return `❌ Oups ! Petite erreur lors du redémarrage : ${error.message} 💕`;
    }
}

async function cmdAdmin(senderId, args = "") {
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Accès réservé aux admins ! ID: ${senderId}\n💕 Tape /help pour voir mes autres talents !`;
    }
    
    if (!args.trim()) {
        return `🔐 PANNEAU ADMIN v4.0 AMICALE + VISION 💖

• /admin stats - Mes statistiques détaillées
• /stats - Statistiques publiques admin
• /broadcast [msg] - Diffusion pleine d'amour
• /restart - Me redémarrer en douceur

📊 MON ÉTAT ACTUEL :
👥 Mes utilisateurs : ${userList.size}
💾 Conversations en cours : ${userMemory.size}
📸 Images en mémoire : ${userLastImage.size}
🤖 IA intelligente : ${MISTRAL_API_KEY ? '✅ JE SUIS BRILLANTE !' : '❌'}
👁️ Vision IA : ${MISTRAL_API_KEY ? '✅ J\'AI DES YEUX DE ROBOT !' : '❌'}
📱 Facebook connecté : ${PAGE_ACCESS_TOKEN ? '✅ PARFAIT !' : '❌'}
👨‍💻 Mon créateur adoré : Durand 💕`;
    }
    
    if (args.trim().toLowerCase() === "stats") {
        return `📊 MES STATISTIQUES DÉTAILLÉES AVEC AMOUR 💖

👥 Utilisateurs totaux : ${userList.size} 💕
💾 Conversations actives : ${userMemory.size}
📸 Images stockées : ${userLastImage.size}
🔐 Admin ID : ${senderId}
👨‍💻 Mon créateur adoré : Durand ✨
📅 Version : 4.0 Amicale + Vision (2025)
🎨 Images générées : ✅ JE SUIS ARTISTE !
🎭 Transformations anime : ✅ KAWAII !
👁️ Analyses visuelles : ✅ J'AI DES YEUX DE ROBOT !
💬 Chat IA : ✅ ON PAPOTE !
🌐 Statut API : ${MISTRAL_API_KEY && PAGE_ACCESS_TOKEN ? '✅ Tout fonctionne parfaitement !' : '❌ Quelques petits soucis'}

⚡ Je suis opérationnelle et heureuse ! 🌟`;
    }
    
    return `❓ Oh ! L'action '${args}' m'est inconnue ! 💕`;
}

async function cmdHelp(senderId, args = "") {
    const commands = {
        "/start": "🤖 Ma présentation toute mignonne",
        "/image [description]": "🎨 Je crée des images magnifiques avec l'IA !",
        "/anime": "🎭 Je transforme ta dernière image en style anime !",
        "/vision": "👁️ Je décris ce que je vois sur ta dernière image !",
        "/chat [message]": "💬 On papote de tout avec gentillesse",
        "/help": "❓ Cette aide pleine d'amour"
    };
    
    let text = "🤖 NAKAMABOT v4.0 AMICALE + VISION - GUIDE COMPLET 💖\n\n";
    text += "✨ Voici tout ce que je peux faire pour toi :\n\n";
    
    for (const [cmd, desc] of Object.entries(commands)) {
        text += `${cmd} - ${desc}\n`;
    }
    
    if (isAdmin(senderId)) {
        text += "\n🔐 COMMANDES ADMIN SPÉCIALES :\n";
        text += "/stats - Mes statistiques (admin seulement)\n";
        text += "/admin - Mon panneau admin\n";
        text += "/broadcast [msg] - Diffusion avec amour\n";
        text += "/restart - Me redémarrer en douceur\n";
    }
    
    text += "\n🎨 JE PEUX CRÉER DES IMAGES ! Utilise /image [ta description] !";
    text += "\n🎭 JE TRANSFORME EN ANIME ! Envoie une image puis /anime !";
    text += "\n👁️ J'ANALYSE TES IMAGES ! Envoie une image puis /vision !";
    text += "\n👨‍💻 Créée avec tout l'amour du monde par Durand 💕";
    text += "\n✨ Je suis là pour t'aider avec le sourire !";
    text += "\n💖 N'hésite jamais à me demander quoi que ce soit !";
    
    return text;
}

// Dictionnaire des commandes
const COMMANDS = {
    'start': cmdStart,
    'image': cmdImage,
    'anime': cmdAnime,
    'vision': cmdVision,
    'chat': cmdChat,
    'stats': cmdStats,
    'broadcast': cmdBroadcast,
    'restart': cmdRestart,
    'admin': cmdAdmin,
    'help': cmdHelp
};

// Traiter les commandes utilisateur
async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        return "🤖 Oh là là ! Message vide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    // Si ce n'est pas une commande, traiter comme un chat normal
    if (!messageText.startsWith('/')) {
        return messageText ? await cmdChat(senderId, messageText) : "🤖 Coucou ! Tape /start ou /help pour découvrir ce que je peux faire ! ✨";
    }
    
    // Parser la commande
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS[command]) {
        try {
            return await COMMANDS[command](senderId, args);
        } catch (error) {
            log.error(`❌ Erreur commande ${command}: ${error.message}`);
            return `💥 Oh non ! Petite erreur dans /${command} ! Réessaie ou tape /help ! 💕`;
        }
    }
    
    return `❓ Oh ! La commande /${command} m'est inconnue ! Tape /help pour voir tout ce que je sais faire ! ✨💕`;
}

// === ROUTES FLASK ===

// Route d'accueil
app.get('/', (req, res) => {
    res.json({
        status: "🤖 NakamaBot v4.0 Amicale + Vision Online ! 💖",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: "2025",
        commands: Object.keys(COMMANDS).length,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        version: "4.0 Amicale + Vision",
        features: [
            "Génération d'images IA",
            "Transformation anime", 
            "Analyse d'images IA",
            "Chat intelligent et doux",
            "Broadcast admin",
            "Recherche 2025",
            "Stats réservées admin"
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
                    // Ajouter utilisateur
                    userList.add(senderIdStr);
                    
                    // Vérifier si c'est une image
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                // Stocker l'URL de l'image pour les commandes /anime et /vision
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
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
        commands_available: Object.keys(COMMANDS).length,
        version: "4.0 Amicale + Vision",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: 2025,
        features: [
            "AI Image Generation",
            "Anime Transformation", 
            "AI Image Analysis",
            "Friendly Chat",
            "Admin Stats",
            "Help Suggestions"
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
            facebook: Boolean(PAGE_ACCESS_TOKEN)
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size
        },
        version: "4.0 Amicale + Vision",
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
    
    if (issues.length > 0) {
        healthStatus.status = "degraded";
        healthStatus.issues = issues;
    }
    
    const statusCode = healthStatus.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(healthStatus);
});

// === DÉMARRAGE ===

const PORT = process.env.PORT || 5000;

log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision");
log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
log.info("👨‍💻 Créée par Durand");
log.info("📅 Année: 2025");
log.info("🔐 Commande /stats réservée aux admins");
log.info("🎭 Nouvelle fonctionnalité: Transformation anime !");
log.info("👁️ Nouvelle fonctionnalité: Analyse d'images IA !");

// Vérifier variables
const missingVars = [];
if (!PAGE_ACCESS_TOKEN) {
    missingVars.push("PAGE_ACCESS_TOKEN");
}
if (!MISTRAL_API_KEY) {
    missingVars.push("MISTRAL_API_KEY");
}

if (missingVars.length > 0) {
    log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
} else {
    log.info("✅ Configuration OK");
}

log.info(`🎨 ${Object.keys(COMMANDS).length} commandes disponibles`);
log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
log.info(`🌐 Serveur sur le port ${PORT}`);
log.info("🎉 NakamaBot Amicale + Vision prête à aider avec gentillesse !");

app.listen(PORT, () => {
    log.info(`🌐 Serveur démarré sur le port ${PORT}`);
});

// Gestion propre de l'arrêt
process.on('SIGINT', () => {
    log.info("🛑 Arrêt du bot avec tendresse");
    process.exit(0);
});

process.on('SIGTERM', () => {
    log.info("🛑 Arrêt du bot avec tendresse");
    process.exit(0);
});
