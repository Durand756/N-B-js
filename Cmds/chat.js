/**
 * NakamaBot - Commande /chat OPTIMISÉE pour 40K+ utilisateurs
 * + Recherche intelligente intégrée et rotation des clés Gemini
 * + Support Markdown vers Unicode stylisé pour Facebook Messenger
 * + Système de troncature synchronisé avec le serveur principal
 * + Délai de 5 secondes entre messages utilisateurs distincts
 * + LRU Cache pour gestion mémoire optimale
 * + Circuit Breaker pour APIs
 * + Rate Limiting avancé
 * + Batch Processing pour sauvegardes
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Configuration APIs avec rotation des clés Gemini
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];

// Configuration APIs avec rotation des clés Google Search (similaire à Gemini)
const GOOGLE_SEARCH_API_KEYS = process.env.GOOGLE_SEARCH_API_KEYS ? process.env.GOOGLE_SEARCH_API_KEYS.split(',').map(key => key.trim()) : [];
const GOOGLE_SEARCH_ENGINE_IDS = process.env.GOOGLE_SEARCH_ENGINE_IDS ? process.env.GOOGLE_SEARCH_ENGINE_IDS.split(',').map(id => id.trim()) : [];

// Configuration des délais pour la rotation et les retries
const SEARCH_RETRY_DELAY = 3000; // Délai en ms entre tentatives de rotation (ex. : 2 secondes)
const SEARCH_GLOBAL_COOLDOWN = 5000; // Délai optionnel global entre recherches (ex. : 5 secondes), si besoin

// Fallback: SerpAPI si Google Custom Search n'est pas disponible
const SERPAPI_KEY = process.env.SERPAPI_KEY;

// État global pour la rotation des clés Gemini
let currentGeminiKeyIndex = 0;
const failedKeys = new Set();

// État global pour la rotation des clés Google Search
let currentSearchKeyIndex = 0;
const failedSearchKeys = new Set();

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
        // Si la clé existe, la supprimer pour la remettre à la fin (plus récente)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        // Ajouter la nouvelle entrée
        this.cache.set(key, value);
        
        // Si la taille dépasse le maximum, supprimer l'entrée la plus ancienne
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }
    
    get(key) {
        if (!this.cache.has(key)) return undefined;
        
        // Déplacer l'élément à la fin (plus récent)
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

// ========================================
// 🚀 OPTIMISATION 2: RATE LIMITER AVANCÉ
// ========================================

/**
 * Rate Limiter par utilisateur avec fenêtre glissante
 * Empêche le spam et réduit la charge serveur
 */
class UserRateLimiter {
    constructor(windowMs = 60000, maxRequests = 10) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.users = new LRUCache(5000); // Max 5000 users trackés
    }
    
    isAllowed(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        
        // Nettoyer les anciennes requêtes (fenêtre glissante)
        const recentRequests = userRequests.filter(
            timestamp => now - timestamp < this.windowMs
        );
        
        if (recentRequests.length >= this.maxRequests) {
            return false;
        }
        
        recentRequests.push(now);
        this.users.set(userId, recentRequests);
        return true;
    }
    
    reset(userId) {
        this.users.delete(userId);
    }
    
    getRemainingRequests(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        const recentRequests = userRequests.filter(
            timestamp => now - timestamp < this.windowMs
        );
        return Math.max(0, this.maxRequests - recentRequests.length);
    }
}

// ========================================
// 🚀 OPTIMISATION 3: CIRCUIT BREAKER
// ========================================

/**
 * Circuit Breaker pour éviter les appels répétés à des APIs en échec
 * Réduit les timeouts et améliore les temps de réponse
 */
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000, name = 'Unknown') {
        this.failureCount = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = Date.now();
        this.name = name;
    }
    
    async execute(fn, fallback) {
        // Si le circuit est ouvert, vérifier si on peut réessayer
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                console.log(`⚠️ Circuit breaker ${this.name} OPEN, utilisation du fallback`);
                return fallback ? await fallback() : null;
            }
            this.state = 'HALF_OPEN';
        }
        
        try {
            // Exécuter avec timeout de 15 secondes
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 15000)
                )
            ]);
            
            // Succès - réinitialiser le compteur
            this.failureCount = 0;
            this.state = 'CLOSED';
            return result;
            
        } catch (error) {
            this.failureCount++;
            
            // Si on atteint le seuil, ouvrir le circuit
            if (this.failureCount >= this.threshold) {
                this.state = 'OPEN';
                this.nextAttempt = Date.now() + this.timeout;
                console.error(`❌ Circuit breaker ${this.name} OUVERT (${this.failureCount} échecs)`);
            }
            
            // Utiliser le fallback si disponible
            if (fallback) {
                return await fallback();
            }
            throw error;
        }
    }
    
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            threshold: this.threshold,
            nextAttempt: this.nextAttempt
        };
    }
}

// ========================================
// 🚀 OPTIMISATION 4: BATCH SAVE QUEUE
// ========================================

/**
 * Queue de sauvegarde par batch pour réduire les appels GitHub
 * Améliore les performances et réduit le rate limiting
 */
class SaveQueue {
    constructor(batchDelay = 5000) {
        this.queue = new Set();
        this.batchDelay = batchDelay;
        this.timer = null;
        this.processing = false;
    }
    
    add(userId) {
        this.queue.add(userId);
        this.scheduleFlush();
    }
    
    scheduleFlush() {
        if (this.timer) return;
        
        this.timer = setTimeout(() => {
            this.flush();
        }, this.batchDelay);
    }
    
    async flush() {
        if (this.processing || this.queue.size === 0) return;
        
        this.processing = true;
        this.timer = null;
        
        const usersToSave = Array.from(this.queue);
        this.queue.clear();
        
        console.log(`💾 Batch save de ${usersToSave.length} utilisateurs`);
        
        // La sauvegarde réelle est gérée par le contexte
        // On signale juste qu'il y a des modifications
        
        this.processing = false;
    }
    
    get size() {
        return this.queue.size;
    }
}

// 🛡️ PROTECTION ANTI-DOUBLONS RENFORCÉE avec LRU Cache optimisé
const activeRequests = new LRUCache(5000); // Max 5000 requêtes actives simultanées
const recentMessages = new LRUCache(10000); // Max 10000 messages récents en cache

// 🚀 Instances des systèmes d'optimisation
const rateLimiter = new UserRateLimiter(60000, 12); // 12 messages par minute
const geminiCircuit = new CircuitBreaker(3, 30000, 'Gemini');
const mistralCircuit = new CircuitBreaker(3, 30000, 'Mistral');
const saveQueue = new SaveQueue(5000); // Batch toutes les 5 secondes

// 🎨 FONCTIONS DE PARSING MARKDOWN → UNICODE
// ========================================

/**
 * Mappings des caractères Unicode pour le styling
 */
const UNICODE_MAPPINGS = {
    // Gras (Mathematical Bold)
    bold: {
    'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺',
    'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
    'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠',
    'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
    '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    }
};

/**
 * Convertit une chaîne en gras Unicode
 */
function toBold(str) {
    return str.split('').map(char => UNICODE_MAPPINGS.bold[char] || char).join('');
}

/**
 * Convertit une chaîne en italique Unicode (SUPPRIMÉ)
 */
function toItalic(str) {
    return str;
}

/**
 * Convertit une chaîne en souligné Unicode
 */
function toUnderline(str) {
    return str.split('').map(char => char + '\u0332').join('');
}

/**
 * Convertit une chaîne en barré Unicode
 */
function toStrikethrough(str) {
    return str.split('').map(char => char + '\u0336').join('');
}

/**
 * Parse le Markdown et le convertit en Unicode stylisé
 */
function parseMarkdown(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let parsed = text;

    // 1. Traitement des titres (### titre)
    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => {
        return `🔹 ${toBold(title.trim())}`;
    });

    // 2. Traitement du gras (**texte**)
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
        return toBold(content);
    });

    // 3. Traitement de l'italique (*texte*) - DÉSACTIVÉ

    // 4. Traitement du souligné (__texte__)
    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => {
        return toUnderline(content);
    });

    // 5. Traitement du barré (~~texte~~)
    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => {
        return toStrikethrough(content);
    });

    // 6. Traitement des listes (- item ou * item)
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => {
        return `• ${content.trim()}`;
    });

    return parsed;
}

// ========================================
// FONCTIONS DE ROTATION DES CLÉS
// ========================================

// Fonction pour obtenir la prochaine clé Gemini disponible
function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    // Si toutes les clés ont échoué, on reset
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    
    // Trouver la prochaine clé non défaillante
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) {
            return key;
        }
        attempts++;
    }
    
    // Si toutes les clés sont marquées comme défaillantes, prendre la première quand même
    failedKeys.clear();
    currentGeminiKeyIndex = 0;
    return GEMINI_API_KEYS[0];
}

// Fonction pour marquer une clé comme défaillante
function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
}

// 🚀 OPTIMISÉ: Fonction pour appeler Gemini avec Circuit Breaker
async function callGeminiWithRotation(prompt, maxRetries = GEMINI_API_KEYS.length) {
    return await geminiCircuit.execute(
        async () => {
            let lastError = null;
            
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const apiKey = getNextGeminiKey();
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
                    
                    const result = await model.generateContent(prompt);
                    const response = result.response.text();
                    
                    if (response && response.trim()) {
                        failedKeys.delete(apiKey);
                        return response;
                    }
                    
                    throw new Error('Réponse Gemini vide');
                    
                } catch (error) {
                    lastError = error;
                    
                    if (error.message.includes('API_KEY') || error.message.includes('quota') || error.message.includes('limit')) {
                        const currentKey = GEMINI_API_KEYS[(currentGeminiKeyIndex - 1 + GEMINI_API_KEYS.length) % GEMINI_API_KEYS.length];
                        markKeyAsFailed(currentKey);
                    }
                    
                    if (attempt === maxRetries - 1) {
                        throw lastError;
                    }
                }
            }
            
            throw lastError || new Error('Toutes les clés Gemini ont échoué');
        },
        null // Pas de fallback ici, géré au niveau supérieur
    );
}

// 🆕 FONCTIONS POUR ROTATION GOOGLE SEARCH (similaire à Gemini)

function getNextSearchPair() {
    if (GOOGLE_SEARCH_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0 || GOOGLE_SEARCH_API_KEYS.length !== GOOGLE_SEARCH_ENGINE_IDS.length) {
        throw new Error('Configuration Google Search invalide');
    }
    
    if (failedSearchKeys.size >= GOOGLE_SEARCH_API_KEYS.length) {
        failedSearchKeys.clear();
        currentSearchKeyIndex = 0;
    }
    
    let attempts = 0;
    while (attempts < GOOGLE_SEARCH_API_KEYS.length) {
        const apiKey = GOOGLE_SEARCH_API_KEYS[currentSearchKeyIndex];
        const engineId = GOOGLE_SEARCH_ENGINE_IDS[currentSearchKeyIndex];
        currentSearchKeyIndex = (currentSearchKeyIndex + 1) % GOOGLE_SEARCH_API_KEYS.length;
        
        if (!failedSearchKeys.has(apiKey)) {
            return { apiKey, engineId };
        }
        attempts++;
    }
    
    failedSearchKeys.clear();
    currentSearchKeyIndex = 0;
    return { apiKey: GOOGLE_SEARCH_API_KEYS[0], engineId: GOOGLE_SEARCH_ENGINE_IDS[0] };
}

function markSearchKeyAsFailed(apiKey) {
    failedSearchKeys.add(apiKey);
}

async function callGoogleSearchWithRotation(query, log, maxRetries = GOOGLE_SEARCH_API_KEYS.length) {
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, SEARCH_RETRY_DELAY));
            log.info(`⌛ Délai de ${SEARCH_RETRY_DELAY / 1000} secondes avant retry #${attempt}`);
        }
        
        try {
            const { apiKey, engineId } = getNextSearchPair();
            const results = await googleCustomSearch(query, log, apiKey, engineId);
            
            if (results && results.length > 0) {
                failedSearchKeys.delete(apiKey);
                return results;
            }
            
            throw new Error('Résultats Google Search vides');
            
        } catch (error) {
            lastError = error;
            
            if (error.message.includes('API_KEY') || error.message.includes('quota') || error.message.includes('limit') || error.response?.status === 429 || error.response?.status === 403) {
                const currentKey = GOOGLE_SEARCH_API_KEYS[(currentSearchKeyIndex - 1 + GOOGLE_SEARCH_API_KEYS.length) % GOOGLE_SEARCH_API_KEYS.length];
                markSearchKeyAsFailed(currentKey);
            }
            
            if (attempt === maxRetries - 1) {
                throw lastError;
            }
        }
    }
    
    throw lastError || new Error('Toutes les clés Google Search ont échoué');
}

// 🛡️ FONCTION PRINCIPALE OPTIMISÉE
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch, log, 
            truncatedMessages, splitMessageIntoChunks, isContinuationRequest } = ctx;
    
    // 🚀 OPTIMISATION: Rate Limiting en premier
    if (!rateLimiter.isAllowed(senderId)) {
        const remaining = rateLimiter.getRemainingRequests(senderId);
        log.warning(`🚫 Rate limit atteint pour ${senderId} (${remaining} restants)`);
        return "⏰ Tu envoies trop de messages ! Attends un peu (max 12/minute)... 💕";
    }
    
    // 🛡️ PROTECTION 1: Créer une signature unique du message
    const messageSignature = `${senderId}_${args.trim().toLowerCase()}`;
    const currentTime = Date.now();
    
    // 🛡️ PROTECTION 2: Vérifier si ce message exact a été traité récemment (dernières 30 secondes)
    if (recentMessages.has(messageSignature)) {
        const lastProcessed = recentMessages.get(messageSignature);
        if (currentTime - lastProcessed < 30000) {
            log.warning(`🚫 Message dupliqué ignoré pour ${senderId}: "${args.substring(0, 30)}..."`);
            return;
        }
    }
    
    // 🛡️ PROTECTION 3: Vérifier si une demande est déjà en cours pour cet utilisateur
    if (activeRequests.has(senderId)) {
        log.warning(`🚫 Demande en cours ignorée pour ${senderId}`);
        return;
    }
    
    // 🆕 PROTECTION 4: Vérifier le délai de 5 secondes entre messages distincts
    const userMessages = [];
    for (const [sig, timestamp] of recentMessages.entries()) {
        if (sig.startsWith(`${senderId}_`)) {
            userMessages.push(timestamp);
        }
    }
    
    const lastMessageTime = userMessages.length > 0 ? Math.max(...userMessages) : 0;
    if (lastMessageTime && (currentTime - lastMessageTime < 5000)) {
        const waitMessage = "🕒 Veuillez patienter 5 secondes avant d'envoyer un nouveau message...";
        addToMemory(String(senderId), 'assistant', waitMessage);
        await ctx.sendMessage(senderId, waitMessage);
        log.warning(`🚫 Message trop rapide ignoré pour ${senderId}`);
        return;
    }
    
    // 🛡️ PROTECTION 5: Marquer la demande comme active
    const requestKey = `${senderId}_${currentTime}`;
    activeRequests.set(senderId, requestKey);
    recentMessages.set(messageSignature, currentTime);
    
    try {
        // 🆕 AJOUT : Message de traitement
        if (args.trim() && !isContinuationRequest(args)) {
            const processingMessage = "⏳...";
            addToMemory(String(senderId), 'assistant', processingMessage);
            await ctx.sendMessage(senderId, processingMessage);
        }
        
        if (!args.trim()) {
            const welcomeMsg = "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
            const styledWelcome = parseMarkdown(welcomeMsg);
            addToMemory(String(senderId), 'assistant', styledWelcome);
            return styledWelcome;
        }
        
        // 🆕 GESTION SYNCHRONISÉE DES DEMANDES DE CONTINUATION
        const senderIdStr = String(senderId);
        if (isContinuationRequest(args)) {
            const truncatedData = truncatedMessages.get(senderIdStr);
            if (truncatedData) {
                const { fullMessage, lastSentPart } = truncatedData;
                
                const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
                const remainingMessage = fullMessage.substring(lastSentIndex);
                
                if (remainingMessage.trim()) {
                    const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                    const nextChunk = parseMarkdown(chunks[0]);
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage: fullMessage,
                            lastSentPart: lastSentPart + chunks[0],
                            timestamp: new Date().toISOString()
                        });
                        
                        const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', continuationMsg);
                        return continuationMsg;
                    } else {
                        truncatedMessages.delete(senderIdStr);
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', nextChunk);
                        return nextChunk;
                    }
                } else {
                    truncatedMessages.delete(senderIdStr);
                    const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', endMsg);
                    return endMsg;
                }
            } else {
                const noTruncMsg = "🤔 Il n'y a pas de message en cours à continuer. Pose-moi une nouvelle question ! 💡";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noTruncMsg);
                return noTruncMsg;
            }
        }
        
        // ✅ Détection des demandes de contact admin
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            const styledContact = parseMarkdown(contactSuggestion);
            
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', styledContact);
            return styledContact;
        }
        
        // 🆕 DÉTECTION INTELLIGENTE DES COMMANDES
        const intelligentCommand = await detectIntelligentCommands(args, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Détection IA intelligente: /${intelligentCommand.command} (${intelligentCommand.confidence}) pour ${senderId}`);
            
            try {
                const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
                
                if (commandResult.success) {
                    if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                        addToMemory(String(senderId), 'user', args);
                        return commandResult.result;
                    }
                    
                    const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                    const styledResponse = parseMarkdown(contextualResponse);
                    
                    addToMemory(String(senderId), 'user', args);
                    addToMemory(String(senderId), 'assistant', styledResponse);
                    return styledResponse;
                } else {
                    log.warning(`⚠️ Échec exécution commande /${intelligentCommand.command}: ${commandResult.error}`);
                }
            } catch (error) {
                log.error(`❌ Erreur exécution commande IA: ${error.message}`);
            }
        } 
        
        // 🆕 NOUVELLE FONCTIONNALITÉ: Décision intelligente pour recherche externe
        const searchDecision = await decideSearchNecessity(args, senderId, ctx);
        
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe nécessaire pour ${senderId}: ${searchDecision.reason}`);
            
            try {
                const conversationContext = getMemoryContext(String(senderId)).slice(-4); // 🚀 OPTIMISÉ: 4 au lieu de 8
                
                const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    const naturalResponse = await generateNaturalResponseWithContext(args, searchResults, conversationContext, ctx);
                    
                    if (naturalResponse) {
                        const styledNatural = parseMarkdown(naturalResponse);
                        
                        if (styledNatural.length > 2000) {
                            log.info(`📏 Message de recherche long détecté (${styledNatural.length} chars)`);
                            
                            const chunks = splitMessageIntoChunks(styledNatural, 2000);
                            const firstChunk = chunks[0];
                            
                            if (chunks.length > 1) {
                                truncatedMessages.set(senderIdStr, {
                                    fullMessage: styledNatural,
                                    lastSentPart: firstChunk,
                                    timestamp: new Date().toISOString()
                                });
                                
                                const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                                addToMemory(String(senderId), 'user', args);
                                addToMemory(String(senderId), 'assistant', truncatedResponse);
                                log.info(`🔍✅ Recherche terminée avec troncature pour ${senderId}`);
                                return truncatedResponse;
                            }
                        }
                        
                        addToMemory(String(senderId), 'user', args);
                        addToMemory(String(senderId), 'assistant', styledNatural);
                        log.info(`🔍✅ Recherche terminée avec succès pour ${senderId}`);
                        return styledNatural;
                    }
                } else {
                    log.warning(`⚠️ Aucun résultat de recherche pour: ${searchDecision.searchQuery}`);
                }
            } catch (searchError) {
                log.error(`❌ Erreur recherche intelligente pour ${senderId}: ${searchError.message}`);
            }
        }
        
        // ✅ Conversation classique avec Gemini (Mistral en fallback)
        const conversationResult = await handleConversationWithFallback(senderId, args, ctx);
        return conversationResult;
        
    } finally {
        // 🛡️ PROTECTION 6: Libérer la demande (TOUJOURS exécuté)
        activeRequests.delete(senderId);
        
        // 🚀 OPTIMISATION: Batch save au lieu de save immédiat
        saveQueue.add(senderId);
        
        log.debug(`🔓 Demande libérée pour ${senderId}`);
    }
};

// 🆕 DÉCISION IA: Déterminer si une recherche externe est nécessaire
async function decideSearchNecessity(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const decisionPrompt = `Tu es un système de décision intelligent pour un chatbot. 
Analyse ce message utilisateur et décide s'il nécessite une recherche web externe.

CRITÈRES POUR RECHERCHE EXTERNE:
✅ OUI si:
- Informations récentes (actualités, événements 2023-2026)
- Résultats sportifs récents (CAN, Coupe, championnat, match, vainqueur, buteur)
- Données factuelles spécifiques (prix actuels, statistiques, dates précises)
- Informations locales/géographiques spécifiques
- Recherche de produits/services/entreprises précis
- Questions sur des personnes publiques récentes
- Données météo, cours de bourse, classements sportifs
- Questions avec "dernier", "dernière", "récent", "qui a gagné", "qui a remporté"

❌ NON si:
- Conversations générales/philosophiques
- Conseils/opinions personnelles
- Questions sur le bot lui-même
- Créativité (histoires, poèmes)
- Explications de concepts généraux
- Calculs/logique
- Questions existantes dans ma base de connaissances ancienne

MESSAGE UTILISATEUR: "${userMessage}"

Réponds UNIQUEMENT avec ce format JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication courte",
  "searchQuery": "requête de recherche optimisée si nécessaire"
}`;

        const response = await callGeminiWithRotation(decisionPrompt);
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🤖 Décision recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence}) - ${decision.reason}`);
            return decision;
        }
        
        throw new Error('Format de réponse invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        
        const keywordSearch = detectSearchKeywords(userMessage);
        return {
            needsExternalSearch: keywordSearch.needs,
            confidence: 0.6,
            reason: 'fallback_keywords',
            searchQuery: keywordSearch.query
        };
    }
}

// 🆕 FALLBACK: Détection par mots-clés
function detectSearchKeywords(message) {
    const lowerMessage = message.toLowerCase();
    
    const searchIndicators = [
        { patterns: [/\b(202[3-6]|actualité|récent|nouveau|maintenant|aujourd|news|info|dernière?|dernier)\b/], weight: 0.9 },
        { patterns: [/\b(prix|coût|combien|tarif)\b.*\b(euros?|dollars?|€|\$)\b/], weight: 0.8 },
        { patterns: [/\b(météo|temps|température)\b.*\b(aujourd|demain|cette semaine)\b/], weight: 0.9 },
        { patterns: [/\b(où|address|lieu|localisation|carte)\b/], weight: 0.7 },
        { patterns: [/\b(qui est|biographie|âge)\b.*\b[A-Z][a-z]+\s[A-Z][a-z]+/], weight: 0.8 },
        { patterns: [/\b(résultats?|score|match|compétition|gagné|remporté|vainqueur|champion)\b.*\b(sport|foot|tennis|basket|CAN|coupe|finale)\b/], weight: 0.9 },
        { patterns: [/\b(CAN|coupe d'afrique|championnat|tournoi|ligue|équipe nationale)\b/i], weight: 0.95 },
        { patterns: [/\b(buteur|but|goal|marqué)\b.*\b(dernier|dernière|récent|actuel)\b/], weight: 0.9 }
    ];
    
    let totalWeight = 0;
    for (const indicator of searchIndicators) {
        for (const pattern of indicator.patterns) {
            if (pattern.test(lowerMessage)) {
                totalWeight += indicator.weight;
                break;
            }
        }
    }
    
    return {
        needs: totalWeight > 0.6,
        query: message,
        confidence: Math.min(totalWeight, 1.0)
    };
}

// 🆕 RECHERCHE INTELLIGENTE
async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        if (GOOGLE_SEARCH_API_KEYS.length > 0 && GOOGLE_SEARCH_ENGINE_IDS.length > 0 && GOOGLE_SEARCH_API_KEYS.length === GOOGLE_SEARCH_ENGINE_IDS.length) {
            return await callGoogleSearchWithRotation(query, log);
        } else if (GOOGLE_SEARCH_API_KEYS.length !== GOOGLE_SEARCH_ENGINE_IDS.length) {
            log.warning('⚠️ Tailles des tableaux Google Search API ne correspondent pas');
        }
        
        if (SERPAPI_KEY) {
            return await serpApiSearch(query, log);
        }
        
        log.warning('⚠️ Aucune API de recherche configurée');
        return await fallbackWebSearch(query, ctx);
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        throw error;
    }
}

// 🆕 Google Custom Search API
async function googleCustomSearch(query, log, apiKey, cx) {
    const url = `https://www.googleapis.com/customsearch/v1`;
    const params = {
        key: apiKey,
        cx: cx,
        q: query,
        num: 5,
        safe: 'active',
        lr: 'lang_fr',
        hl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 10000 });
    
    if (response.data.items) {
        return response.data.items.map(item => ({
            title: item.title,
            link: item.link,
            description: item.snippet,
            source: 'google'
        }));
    }
    
    return [];
}

// 🆕 SerpAPI
async function serpApiSearch(query, log) {
    const url = `https://serpapi.com/search`;
    const params = {
        api_key: SERPAPI_KEY,
        engine: 'google',
        q: query,
        num: 5,
        hl: 'fr',
        gl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 10000 });
    
    if (response.data.organic_results) {
        return response.data.organic_results.map(item => ({
            title: item.title,
            link: item.link,
            description: item.snippet,
            source: 'serpapi'
        }));
    }
    
    return [];
}

// 🆕 Fallback
async function fallbackWebSearch(query, ctx) {
    const { webSearch } = ctx;
    
    try {
        const result = await webSearch(query);
        if (result) {
            return [{
                title: 'Information récente',
                link: 'N/A',
                description: result,
                source: 'internal'
            }];
        }
    } catch (error) {
        // Ignore
    }
    
    return [];
}

// 🚀 OPTIMISÉ: Génération de réponse avec contexte réduit
async function generateNaturalResponseWithContext(originalQuery, searchResults, conversationContext, ctx) {
    const { log, callMistralAPI } = ctx;
    
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    try {
        const resultsText = searchResults.map((result, index) => 
            `${result.title}: ${result.description}`
        ).join('\n');
        
        let conversationHistory = "";
        if (conversationContext && conversationContext.length > 0) {
            conversationHistory = conversationContext.map(msg => 
                `${msg.role === 'user' ? 'Utilisateur' : 'NakamaBot'}: ${msg.content}`
            ).join('\n') + '\n';
        }
        
        // 🚀 OPTIMISÉ: Prompt compressé et naturel
        const contextualPrompt = `Tu es NakamaBot, IA conversationnelle amicale.

DATE: ${dateTime} (ne mentionne que si demandé)

${conversationHistory ? `HISTORIQUE:\n${conversationHistory}\n` : 'Début de conversation\n'}

QUESTION ACTUELLE: "${originalQuery}"

INFOS TROUVÉES:
${resultsText}

STYLE:
- Réponds NATURELLEMENT comme dans une vraie conversation
- 2-4 phrases courtes et directes
- Ne dis JAMAIS que tu as cherché/recherché
- Si question de suivi (ex: "il a marqué combien"), utilise le contexte
- Pas de formatage excessif
- Max 1200 chars

Ta réponse naturelle:`;

        const response = await callGeminiWithRotation(contextualPrompt);
        
        if (response && response.trim()) {
            // 🔧 FIX: Supprimer le préfixe "NakamaBot:" si présent
            let cleanResponse = response.trim();
            if (cleanResponse.startsWith('NakamaBot:')) {
                cleanResponse = cleanResponse.substring('NakamaBot:'.length).trim();
            }
            if (cleanResponse.startsWith('NakamaBot :')) {
                cleanResponse = cleanResponse.substring('NakamaBot :'.length).trim();
            }
            
            log.info(`🎭 Réponse contextuelle Gemini`);
            return cleanResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Erreur Gemini: ${geminiError.message}`);
        
        try {
            const messages = [{
                role: "system",
                content: `Tu es NakamaBot. Contexte connu. Réponds naturellement. Markdown simple.

Historique:
${conversationContext ? conversationContext.map(msg => `${msg.role === 'user' ? 'Utilisateur' : 'NakamaBot'}: ${msg.content}`).join('\n') : "Début"}`
            }, {
                role: "user", 
                content: `Question: "${originalQuery}"

Infos:
${searchResults.map(r => `${r.title}: ${r.description}`).join('\n')}

Réponds (max 2000 chars):`
            }];
            
            const mistralResponse = await mistralCircuit.execute(
                async () => await callMistralAPI(messages, 2000, 0.7),
                null
            );
            
            if (mistralResponse) {
                log.info(`🔄 Réponse Mistral`);
                return mistralResponse;
            }
            
            throw new Error('Mistral échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale: ${mistralError.message}`);
            
            const topResult = searchResults[0];
            if (topResult) {
                return `D'après ce que je sais, ${topResult.description} 💡`;
            }
            
            return null;
        }
    }
}

// 🚀 OPTIMISÉ: Conversation avec prompts compressés
async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log, 
            splitMessageIntoChunks, truncatedMessages } = ctx;
    
    // 🚀 OPTIMISÉ: Contexte réduit à 4 messages au lieu de 8
    const context = getMemoryContext(String(senderId)).slice(-4);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    let conversationHistory = "";
    if (context.length > 0) {
        conversationHistory = context.map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`
        ).join('\n') + '\n';
    }
    
    // 🚀 OPTIMISÉ: Prompt système compressé et naturel
    const systemPrompt = `Tu es NakamaBot, IA amicale créée par Durand et Myronne.

DATE: ${dateTime} (garde en mémoire, ne mentionne que si demandé)

${conversationHistory ? `CONTEXTE PRÉCÉDENT:\n${conversationHistory}\n` : ''}

STYLE DE RÉPONSE:
- Ton NATUREL et CONVERSATIONNEL (comme un ami)
- Pas de liste à puces ni de formatage excessif
- Réponses COURTES et DIRECTES (2-4 phrases max sauf si détails demandés)
- Emojis modérés (1-2 par réponse)
- Pas de "NakamaBot:" en préfixe
- Évite les formulations robotiques ("Voici", "Je peux", "N'hésite pas")
${messageCount >= 5 ? '- Suggère /help si l\'utilisateur semble perdu' : ''}

CAPACITÉS (mentionne seulement si pertinent):
Images, Analyse, Anime, Musique, Clans, Stats

Max 800 chars. Réponds naturellement sans formatage Markdown excessif.

Message utilisateur: ${args}

Ta réponse (courte et naturelle):`;

    const senderIdStr = String(senderId);

    try {
        const geminiResponse = await callGeminiWithRotation(systemPrompt);
        
        if (geminiResponse && geminiResponse.trim()) {
            // 🔧 FIX: Supprimer le préfixe "NakamaBot:" si présent
            let cleanResponse = geminiResponse.trim();
            if (cleanResponse.startsWith('NakamaBot:')) {
                cleanResponse = cleanResponse.substring('NakamaBot:'.length).trim();
            }
            if (cleanResponse.startsWith('NakamaBot :')) {
                cleanResponse = cleanResponse.substring('NakamaBot :'.length).trim();
            }
            
            const styledResponse = parseMarkdown(cleanResponse);
            
            if (styledResponse.length > 2000) {
                log.info(`📏 Réponse longue (${styledResponse.length} chars)`);
                
                const chunks = splitMessageIntoChunks(styledResponse, 2000);
                const firstChunk = chunks[0];
                
                if (chunks.length > 1) {
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: styledResponse,
                        lastSentPart: firstChunk,
                        timestamp: new Date().toISOString()
                    });
                    
                    const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', truncatedResponse);
                    log.info(`💎 Gemini avec troncature`);
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            log.info(`💎 Gemini OK`);
            return styledResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec: ${geminiError.message}`);
        
        try {
            const messages = [{ role: "system", content: systemPrompt }];
            messages.push(...context);
            messages.push({ role: "user", content: args });
            
            const mistralResponse = await mistralCircuit.execute(
                async () => await callMistralAPI(messages, 1500, 0.75),
                null
            );
            
            if (mistralResponse) {
                const styledResponse = parseMarkdown(mistralResponse);
                
                if (styledResponse.length > 2000) {
                    log.info(`📏 Mistral long (${styledResponse.length} chars)`);
                    
                    const chunks = splitMessageIntoChunks(styledResponse, 2000);
                    const firstChunk = chunks[0];
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage: styledResponse,
                            lastSentPart: firstChunk,
                            timestamp: new Date().toISOString()
                        });
                        
                        const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', truncatedResponse);
                        log.info(`🔄 Mistral avec troncature`);
                        return truncatedResponse;
                    }
                }
                
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', styledResponse);
                log.info(`🔄 Mistral OK`);
                return styledResponse;
            }
            
            throw new Error('Mistral échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale: ${mistralError.message}`);
            
            const errorResponse = "🤔 Petite difficulté technique. Reformule différemment ? 💫";
            const styledError = parseMarkdown(errorResponse);
            addToMemory(senderIdStr, 'assistant', styledError);
            return styledError;
        }
    }
}

// 🆕 LISTE DES COMMANDES VALIDES
const VALID_COMMANDS = [
    'help',      // Aide et guide complet
    'image',     // Création d'images IA
    'vision',    // Analyse d'images
    'anime',     // Style anime/manga
    'music',     // Recherche musicale YouTube
    'clan',      // Système de clans et batailles
    'rank',      // Niveau et progression
    'contact',   // Contact administrateurs
    'weather'    // Informations météo
];

// 🧠 DÉTECTION IA CONTEXTUELLE AVANCÉE
async function detectIntelligentCommands(message, ctx) {
    const { log } = ctx;
    
    try {
        const commandsList = VALID_COMMANDS.map(cmd => `/${cmd}`).join(', ');
        
        const detectionPrompt = `Système de détection de commandes NakamaBot. Évite faux positifs.

COMMANDES: ${commandsList}

MESSAGE: "${message}"

VRAIS INTENTIONS (0.8-1.0):
✅ help: "aide", "help", "que peux-tu faire"
✅ image: "dessine", "crée image", "génère"
✅ vision: "regarde image", "analyse photo"
✅ anime: "transforme anime", "style anime"
✅ music: "joue musique", "trouve YouTube"
✅ clan: "rejoindre clan", "bataille"
✅ rank: "mon niveau", "mes stats"
✅ contact: "contacter admin", "signaler"
✅ weather: "météo", "quel temps"

FAUSSES (0.0-0.3):
❌ Questions générales
❌ Conversations
❌ Descriptions

JSON:
{
  "isCommand": true/false,
  "command": "nom",
  "confidence": 0.0-1.0,
  "extractedArgs": "args",
  "reason": "raison"
}`;

        const response = await callGeminiWithRotation(detectionPrompt);
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            const isValidCommand = aiDetection.isCommand && 
                                 VALID_COMMANDS.includes(aiDetection.command) && 
                                 aiDetection.confidence >= 0.8;
            
            if (isValidCommand) {
                log.info(`🎯 Commande: /${aiDetection.command} (${aiDetection.confidence})`);
                
                return {
                    shouldExecute: true,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai_contextual'
                };
            }
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection IA: ${error.message}`);
        return await fallbackStrictKeywordDetection(message, log);
    }
}

// 🛡️ FALLBACK CONSERVATEUR
async function fallbackStrictKeywordDetection(message, log) {
    const lowerMessage = message.toLowerCase().trim();
    
    const strictPatterns = [
        { command: 'help', patterns: [/^(aide|help|guide)$/] },
        { command: 'image', patterns: [/^dessine(-moi)?\s+/, /^(crée|génère)\s+(une\s+)?(image|dessin)/] },
        { command: 'vision', patterns: [/^regarde\s+(cette\s+)?(image|photo)/, /^(analyse|décris)\s+(cette\s+)?(image|photo)/] },
        { command: 'music', patterns: [/^(joue|lance|play)\s+/, /^(trouve|cherche)\s+.*\s+(musique|chanson)/] },
        { command: 'clan', patterns: [/^(rejoindre|créer|mon)\s+clan/, /^bataille\s+de\s+clan/] },
        { command: 'rank', patterns: [/^(mon\s+)?(niveau|rang|stats|progression)/, /^mes\s+(stats|points)/] },
        { command: 'contact', patterns: [/^contacter\s+(admin|administrateur)/, /^signaler\s+problème/] },
        { command: 'weather', patterns: [/^(météo|quel\s+temps|température)/] }
    ];
    
    for (const { command, patterns } of strictPatterns) {
        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                log.info(`🔑 Fallback: /${command}`);
                return {
                    shouldExecute: true,
                    command: command,
                    args: message,
                    confidence: 0.9,
                    method: 'fallback_strict'
                };
            }
        }
    }
    
    return { shouldExecute: false };
}

// ✅ FONCTIONS EXISTANTES

function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    const contactPatterns = [
        { patterns: [/(?:contacter|parler|écrire).*?(?:admin|administrateur|créateur|durand)/i], reason: 'contact_direct' },
        { patterns: [/(?:problème|bug|erreur).*?(?:grave|urgent|important)/i], reason: 'probleme_technique' },
        { patterns: [/(?:signaler|reporter|dénoncer)/i], reason: 'signalement' },
        { patterns: [/(?:suggestion|propose|idée).*?(?:amélioration|nouvelle)/i], reason: 'suggestion' },
        { patterns: [/(?:qui a créé|créateur|développeur).*?(?:bot|nakamabot)/i], reason: 'question_creation' },
        { patterns: [/(?:plainte|réclamation|pas content|mécontent)/i], reason: 'plainte' }
    ];
    
    for (const category of contactPatterns) {
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                if (category.reason === 'question_creation') {
                    return { shouldContact: false };
                }
                return {
                    shouldContact: true,
                    reason: category.reason,
                    extractedMessage: message
                };
            }
        }
    }
    
    return { shouldContact: false };
}

function generateContactSuggestion(reason, extractedMessage) {
    const reasonMessages = {
        'contact_direct': { title: "💌 **Contact Admin**", message: "Je vois que tu veux contacter les administrateurs !" },
        'probleme_technique': { title: "🔧 **Problème Technique**", message: "Problème technique détecté !" },
        'signalement': { title: "🚨 **Signalement**", message: "Tu veux signaler quelque chose d'important !" },
        'suggestion': { title: "💡 **Suggestion**", message: "Tu as une suggestion d'amélioration !" },
        'plainte': { title: "📝 **Réclamation**", message: "Tu as une réclamation à formuler !" }
    };
    
    const reasonData = reasonMessages[reason] || {
        title: "📞 **Contact Admin**",
        message: "Il semble que tu aies besoin de contacter les administrateurs !"
    };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 **Solution :** Utilise \`/contact [ton message]\` pour les contacter directement.\n\n📝 **Ton message :** "${preview}"\n\n⚡ **Limite :** 2 messages par jour\n📨 Tu recevras une réponse personnalisée !\n\n💕 En attendant, je peux t'aider avec d'autres choses ! Tape /help pour voir mes fonctionnalités !`;
}

async function executeCommandFromChat(senderId, commandName, args, ctx) {
    try {
        const COMMANDS = global.COMMANDS || new Map();
        
        if (!COMMANDS.has(commandName)) {
            const path = require('path');
            const fs = require('fs');
            const commandPath = path.join(__dirname, `${commandName}.js`);
            
            if (fs.existsSync(commandPath)) {
                delete require.cache[require.resolve(commandPath)];
                const commandModule = require(commandPath);
                
                if (typeof commandModule === 'function') {
                    const result = await commandModule(senderId, args, ctx);
                    return { success: true, result };
                }
            }
        } else {
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            return { success: true, result };
        }
        
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    try {
        const contextPrompt = `Utilisateur: "${originalMessage}"
Exécuté: /${commandName}
Résultat: "${commandResult}"

Réponds naturellement (max 400 chars). Markdown: **gras**, ### titres (pas italique).`;

        const response = await callGeminiWithRotation(contextPrompt);
        return response || commandResult;
        
    } catch (error) {
        const { callMistralAPI } = ctx;
        try {
            const response = await mistralCircuit.execute(
                async () => await callMistralAPI([
                    { role: "system", content: "Réponds naturellement. Markdown simple." },
                    { role: "user", content: `User: "${originalMessage}"\nRésultat: "${commandResult}"\nPrésente (max 200 chars)` }
                ], 200, 0.7),
                null
            );
            
            return response || commandResult;
        } catch (mistralError) {
            return commandResult;
        }
    }
}

// ✅ Exports
module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.VALID_COMMANDS = VALID_COMMANDS;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.generateNaturalResponseWithContext = generateNaturalResponseWithContext;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;

// 🆕 EXPORTS DES NOUVELLES FONCTIONS MARKDOWN
module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toItalic = toItalic;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;

// 🚀 EXPORTS DES SYSTÈMES D'OPTIMISATION
module.exports.LRUCache = LRUCache;
module.exports.UserRateLimiter = UserRateLimiter;
module.exports.CircuitBreaker = CircuitBreaker;
module.exports.SaveQueue = SaveQueue;

// 🚀 EXPORTS DES INSTANCES GLOBALES
module.exports.rateLimiter = rateLimiter;
module.exports.geminiCircuit = geminiCircuit;
module.exports.mistralCircuit = mistralCircuit;
module.exports.saveQueue = saveQueue;
module.exports.activeRequests = activeRequests;
module.exports.recentMessages = recentMessages;
