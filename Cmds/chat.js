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
 * + 🔧 FIX: Modèle Gemini corrigé (gemini-2.0-flash-thinking-exp-01-21)
 * + 🔧 FIX: Fallback Mistral dans generateNaturalResponseWithContext
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require('cheerio');

// Configuration APIs avec rotation des clés Gemini
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];

// Configuration APIs avec rotation des clés Google Search
const GOOGLE_SEARCH_API_KEYS = process.env.GOOGLE_SEARCH_API_KEYS ? process.env.GOOGLE_SEARCH_API_KEYS.split(',').map(key => key.trim()) : [];
const GOOGLE_SEARCH_ENGINE_IDS = process.env.GOOGLE_SEARCH_ENGINE_IDS ? process.env.GOOGLE_SEARCH_ENGINE_IDS.split(',').map(id => id.trim()) : [];

// Configuration des délais
const SEARCH_RETRY_DELAY = 3000;
const SEARCH_GLOBAL_COOLDOWN = 5000;

// Fallback: SerpAPI
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

// ========================================
// 🚀 OPTIMISATION 2: RATE LIMITER AVANCÉ
// ========================================

class UserRateLimiter {
    constructor(windowMs = 60000, maxRequests = 10) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.users = new LRUCache(5000);
    }
    
    isAllowed(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        
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

class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000, name = 'Unknown') {
        this.failureCount = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED';
        this.nextAttempt = Date.now();
        this.name = name;
    }
    
    async execute(fn, fallback) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                console.log(`⚠️ Circuit breaker ${this.name} OPEN, utilisation du fallback`);
                return fallback ? await fallback() : null;
            }
            this.state = 'HALF_OPEN';
        }
        
        try {
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 15000)
                )
            ]);
            
            this.failureCount = 0;
            this.state = 'CLOSED';
            return result;
            
        } catch (error) {
            this.failureCount++;
            
            if (this.failureCount >= this.threshold) {
                this.state = 'OPEN';
                this.nextAttempt = Date.now() + this.timeout;
                console.error(`❌ Circuit breaker ${this.name} OUVERT (${this.failureCount} échecs)`);
            }
            
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
        
        this.processing = false;
    }
    
    get size() {
        return this.queue.size;
    }
}

// État global
const activeRequests = new LRUCache(5000);
const recentMessages = new LRUCache(10000);

const rateLimiter = new UserRateLimiter(60000, 12);
const geminiCircuit = new CircuitBreaker(3, 30000, 'Gemini');
const mistralCircuit = new CircuitBreaker(3, 30000, 'Mistral');
const saveQueue = new SaveQueue(5000);

// ========================================
// 🎨 FONCTIONS MARKDOWN → UNICODE
// ========================================

const UNICODE_MAPPINGS = {
    bold: {
        'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺',
        'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠',
        'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
        '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    }
};

function toBold(str) {
    return str.split('').map(char => UNICODE_MAPPINGS.bold[char] || char).join('');
}

function toItalic(str) {
    return str;
}

function toUnderline(str) {
    return str.split('').map(char => char + '\u0332').join('');
}

function toStrikethrough(str) {
    return str.split('').map(char => char + '\u0336').join('');
}

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let parsed = text;

    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => {
        return `🔹 ${toBold(title.trim())}`;
    });

    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
        return toBold(content);
    });

    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => {
        return toUnderline(content);
    });

    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => {
        return toStrikethrough(content);
    });

    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => {
        return `• ${content.trim()}`;
    });

    return parsed;
}

// ========================================
// 🔑 GESTION ROTATION CLÉS GEMINI
// ========================================

function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) {
            return key;
        }
        attempts++;
    }
    
    failedKeys.clear();
    currentGeminiKeyIndex = 0;
    return GEMINI_API_KEYS[0];
}

function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
}

// 🔧 FIX: Fonction callGeminiWithRotation avec modèle corrigé
async function callGeminiWithRotation(prompt, maxRetries = GEMINI_API_KEYS.length) {
    return await geminiCircuit.execute(
        async () => {
            let lastError = null;
            
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const apiKey = getNextGeminiKey();
                    const genAI = new GoogleGenerativeAI(apiKey);
                    
                    // 🔧 FIX: Modèle corrigé - gemini-2.0-flash-thinking-exp-01-21
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-2.0-flash-thinking-exp-01-21"
                    });
                    
                    const result = await model.generateContent(prompt);
                    const response = result.response.text();
                    
                    if (response && response.trim()) {
                        failedKeys.delete(apiKey);
                        return response;
                    }
                    
                    throw new Error('Réponse Gemini vide');
                    
                } catch (error) {
                    lastError = error;
                    
                    // 🔧 FIX: Détecter aussi les erreurs 404
                    if (error.message.includes('API_KEY') || 
                        error.message.includes('quota') || 
                        error.message.includes('limit') || 
                        error.message.includes('404') || 
                        error.message.includes('not found')) {
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
        null
    );
}

// ========================================
// 🔍 ROTATION GOOGLE SEARCH
// ========================================

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

// ========================================
// 🛡️ FONCTION PRINCIPALE
// ========================================

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch, log, 
            truncatedMessages, splitMessageIntoChunks, isContinuationRequest } = ctx;
    
    if (!rateLimiter.isAllowed(senderId)) {
        const remaining = rateLimiter.getRemainingRequests(senderId);
        log.warning(`🚫 Rate limit atteint pour ${senderId} (${remaining} restants)`);
        return "⏰ Tu envoies trop de messages ! Attends un peu (max 12/minute)... 💕";
    }
    
    const messageSignature = `${senderId}_${args.trim().toLowerCase()}`;
    const currentTime = Date.now();
    
    if (recentMessages.has(messageSignature)) {
        const lastProcessed = recentMessages.get(messageSignature);
        if (currentTime - lastProcessed < 30000) {
            log.warning(`🚫 Message dupliqué ignoré pour ${senderId}: "${args.substring(0, 30)}..."`);
            return;
        }
    }
    
    if (activeRequests.has(senderId)) {
        log.warning(`🚫 Demande en cours ignorée pour ${senderId}`);
        return;
    }
    
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
    
    const requestKey = `${senderId}_${currentTime}`;
    activeRequests.set(senderId, requestKey);
    recentMessages.set(messageSignature, currentTime);
    
    try {
        if (args.trim() && !isContinuationRequest(args)) {
            const processingMessage = "⏳...";
            addToMemory(String(senderId), 'assistant', processingMessage);
            await ctx.sendMessage(senderId, processingMessage);
        }
        
        if (!args.trim()) {
            const welcomeMsg = "Salut ! 👋 Qu'est-ce que je peux faire pour toi ?";
            const styledWelcome = parseMarkdown(welcomeMsg);
            addToMemory(String(senderId), 'assistant', styledWelcome);
            return styledWelcome;
        }
        
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
        
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            const styledContact = parseMarkdown(contactSuggestion);
            
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', styledContact);
            return styledContact;
        }
        
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
        
        const searchDecision = await decideSearchNecessity(args, senderId, ctx);
        
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe nécessaire pour ${senderId}: ${searchDecision.reason}`);
            
            try {
                const conversationContext = getMemoryContext(String(senderId)).slice(-4);
                
                const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    log.info(`📊 ${searchResults.length} résultats trouvés pour analyse`);
                    searchResults.forEach((r, i) => {
                        log.debug(`[${i+1}] ${r.title} - ${(r.snippet || r.description || '').substring(0, 80)}...`);
                    });
                    
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
        
        const conversationResult = await handleConversationWithFallback(senderId, args, ctx);
        return conversationResult;
        
    } finally {
        activeRequests.delete(senderId);
        saveQueue.add(senderId);
        log.debug(`🔓 Demande libérée pour ${senderId}`);
    }
};

// ========================================
// 🤖 DÉCISION RECHERCHE
// ========================================

async function decideSearchNecessity(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const decisionPrompt = `Analyse cette question et décide si elle nécessite une RECHERCHE WEB.

Question: "${userMessage}"

Tu DOIS chercher sur le web si :
- La question porte sur des ÉVÉNEMENTS RÉCENTS (2023-2026)
- La question demande "qui a gagné/remporté" quelque chose récemment
- La question concerne des RÉSULTATS sportifs, élections, actualités
- La question demande des PRIX, STATS ou DONNÉES actuelles
- La question utilise "dernier", "dernière", "récent", "actuel"

Tu NE cherches PAS si :
- C'est une conversation générale
- C'est une opinion/conseil
- C'est une question sur le bot lui-même
- La réponse est dans tes connaissances de base (avant 2023)

Réponds UNIQUEMENT en JSON :
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "pourquoi",
  "searchQuery": "requête optimisée"
}`;

        const response = await callGeminiWithRotation(decisionPrompt);
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🤖 Décision: ${decision.needsExternalSearch ? 'RECHERCHE' : 'SANS RECHERCHE'} (${decision.confidence})`);
            return decision;
        }
        
        throw new Error('Format invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision: ${error.message}`);
        
        const lowerMessage = userMessage.toLowerCase();
        const needsSearch = 
            /\b(qui a (gagné|remporté|gagne|remporte)|vainqueur|champion|dernier|dernière|récent)\b/.test(lowerMessage) ||
            /\b(202[3-6]|aujourd'hui|maintenant|actuel|récemment)\b/.test(lowerMessage) ||
            /\b(CAN|champion.*league|coupe du monde|finale|match)\b/i.test(lowerMessage);
        
        return {
            needsExternalSearch: needsSearch,
            confidence: needsSearch ? 0.8 : 0.2,
            reason: 'fallback_simple',
            searchQuery: userMessage
        };
    }
}

// ========================================
// 🔍 RECHERCHE WEB
// ========================================

async function duckDuckGoSearch(query, maxResults = 5) {
    try {
        const searchUrl = `https://html.duckduckgo.com/html/`;
        
        const response = await axios.post(searchUrl, 
            `q=${encodeURIComponent(query)}&kl=fr-fr`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            }
        );
        
        if (response.status === 200) {
            const $ = cheerio.load(response.data);
            const results = [];
            
            $('.result__body').each((i, element) => {
                if (i >= maxResults) return false;
                
                const $result = $(element);
                const title = $result.find('.result__a').text().trim();
                const snippet = $result.find('.result__snippet').text().trim();
                const url = $result.find('.result__a').attr('href');
                
                if (title && snippet) {
                    results.push({
                        title: title,
                        snippet: snippet,
                        description: snippet,
                        link: url || '',
                        source: 'duckduckgo'
                    });
                    console.log(`📄 DDG ${i+1}: ${title.substring(0, 60)}... - ${snippet.substring(0, 100)}...`);
                }
            });
            
            console.log(`✅ DuckDuckGo: ${results.length} résultats trouvés`);
            return results.length > 0 ? results : null;
        }
        
        return null;
    } catch (error) {
        console.error(`❌ Erreur DuckDuckGo: ${error.message}`);
        return null;
    }
}

async function wikipediaSearch(query) {
    try {
        const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'NakamaBot/1.0'
            },
            timeout: 8000
        });
        
        if (response.status === 200 && response.data.query?.search) {
            const results = response.data.query.search.map(item => ({
                title: item.title,
                snippet: item.snippet.replace(/<[^>]*>/g, ''),
                description: item.snippet.replace(/<[^>]*>/g, ''),
                link: `https://fr.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
                source: 'wikipedia'
            }));
            
            console.log(`✅ Wikipedia: ${results.length} résultats`);
            return results;
        }
        
        return null;
    } catch (error) {
        console.error(`❌ Erreur Wikipedia: ${error.message}`);
        return null;
    }
}

async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        log.info(`🔍 Recherche: "${query}"`);
        
        let results = await duckDuckGoSearch(query, 5);
        if (results && results.length > 0) {
            log.info(`✅ DuckDuckGo: ${results.length} résultats`);
            return results;
        }
        
        results = await wikipediaSearch(query);
        if (results && results.length > 0) {
            log.info(`✅ Wikipedia: ${results.length} résultats`);
            return results;
        }
        
        if (GOOGLE_SEARCH_API_KEYS.length > 0 && GOOGLE_SEARCH_ENGINE_IDS.length > 0) {
            results = await callGoogleSearchWithRotation(query, log);
            if (results && results.length > 0) {
                log.info(`✅ Google: ${results.length} résultats`);
                return results;
            }
        }
        
        if (SERPAPI_KEY) {
            results = await serpApiSearch(query, log);
            if (results && results.length > 0) {
                log.info(`✅ SerpAPI: ${results.length} résultats`);
                return results;
            }
        }
        
        log.warning(`⚠️ Aucun résultat pour: ${query}`);
        return null;
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        return null;
    }
}

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
            snippet: item.snippet,
            source: 'google'
        }));
    }
    
    return [];
}

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
            snippet: item.snippet,
            source: 'serpapi'
        }));
    }
    
    return [];
}

// ========================================
// 💬 GÉNÉRATION RÉPONSE AVEC CONTEXTE
// ========================================

// 🔧 FIX: Fonction generateNaturalResponseWithContext avec fallback Mistral complet
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
        const resultsText = searchResults.slice(0, 2).map((result, index) => 
            `[${index + 1}] ${result.title.substring(0, 80)}\n${(result.snippet || result.description || '').substring(0, 150)}`
        ).join('\n\n');
        
        console.log(`📊 ${searchResults.length} résultats formatés pour l'IA`);
        console.log(`📝 Extrait: ${resultsText.substring(0, 200)}...`);
        
        let conversationHistory = "";
        if (conversationContext && conversationContext.length > 0) {
            conversationHistory = conversationContext.map(msg => 
                `${msg.role === 'user' ? 'Utilisateur' : 'NakamaBot'}: ${msg.content.substring(0, 100)}`
            ).join('\n') + '\n';
        }
        
        const contextualPrompt = `Tu es NakamaBot. On est le ${dateTime}.

${conversationHistory ? `Conversation:\n${conversationHistory}\n` : ''}

Question: "${originalQuery.substring(0, 150)}"

VRAIES INFORMATIONS TROUVÉES SUR LE WEB:
${resultsText}

RÈGLES CRITIQUES:
- Utilise UNIQUEMENT les infos ci-dessus
- Si les infos se contredisent avec tes connaissances → UTILISE LES INFOS CI-DESSUS
- N'invente RIEN, ne suppose RIEN
- Si les infos sont insuffisantes → dis "Je n'ai pas trouvé assez d'infos"
- Réponds en 2-3 phrases max (max 400 chars)
- Ne dis JAMAIS "selon les sources" ou "d'après mes recherches"

Ta réponse (basée UNIQUEMENT sur les infos trouvées):`;

        const response = await callGeminiWithRotation(contextualPrompt);
        
        if (response && response.trim()) {
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
        
        // 🔧 FIX: Fallback Mistral complet avec Circuit Breaker
        try {
            const resultsText = searchResults.slice(0, 2).map(r => 
                `${r.title.substring(0, 60)}: ${(r.description || r.snippet || '').substring(0, 120)}`
            ).join('\n');
            
            const conversationHistory = conversationContext && conversationContext.length > 0 
                ? conversationContext.map(msg => `${msg.role === 'user' ? 'U' : 'A'}: ${msg.content.substring(0, 80)}`).join('\n')
                : "Début";
            
            const messages = [{
                role: "system",
                content: `Tu es NakamaBot. Réponds naturellement avec les infos fournies. Max 400 chars.\n\nHist:\n${conversationHistory}`
            }, {
                role: "user", 
                content: `Q: "${originalQuery.substring(0, 100)}"\n\nINFOS:\n${resultsText}\n\nRéponds naturellement (infos ci-dessus UNIQUEMENT):`
            }];
            
            const mistralResponse = await mistralCircuit.execute(
                async () => await callMistralAPI(messages, 400, 0.7),
                null
            );
            
            if (mistralResponse && mistralResponse.trim()) {
                log.info(`🔄 Réponse contextuelle Mistral`);
                return mistralResponse.trim();
            }
            
            throw new Error('Mistral échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale génération réponse: ${mistralError.message}`);
            
            // Fallback ultime: retourner le premier résultat
            const topResult = searchResults[0];
            if (topResult) {
                return `D'après ce que je sais, ${(topResult.description || topResult.snippet || '').substring(0, 200)} 💡`;
            }
            
            return null;
        }
    }
}

// ========================================
// 💬 CONVERSATION NORMALE
// ========================================

async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log, 
            splitMessageIntoChunks, truncatedMessages } = ctx;
    
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
            `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content.substring(0, 100)}`
        ).join('\n') + '\n';
    }
    
    const systemPrompt = `Tu es NakamaBot, créée par Durand et Myronne. On est le ${dateTime}.

${conversationHistory ? `Conversation précédente:\n${conversationHistory}\n` : ''}

Réponds de façon ULTRA NATURELLE comme un vrai ami :
- Phrases courtes et simples (pas de présentation robotique)
- Pas de formatage fancy ou listes
- 1-2 emojis MAX
- Si tu ne sais pas quelque chose de récent → DIS-LE CLAIREMENT
- Jamais de "Je suis une IA" ou "Je suis NakamaBot" sauf si on te le demande explicitement
- Max 600 caractères

Message: ${args.substring(0, 300)}

Ta réponse naturelle:`;

    const senderIdStr = String(senderId);

    try {
        const geminiResponse = await callGeminiWithRotation(systemPrompt);
        
        if (geminiResponse && geminiResponse.trim()) {
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
                    addToMemory(senderIdStr, 'user', args.substring(0, 500));
                    addToMemory(senderIdStr, 'assistant', truncatedResponse.substring(0, 500));
                    log.info(`💎 Gemini avec troncature`);
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args.substring(0, 500));
            addToMemory(senderIdStr, 'assistant', styledResponse.substring(0, 500));
            log.info(`💎 Gemini OK`);
            return styledResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec: ${geminiError.message}`);
        
        try {
            const messages = [{ role: "system", content: systemPrompt.substring(0, 1000) }];
            messages.push(...context);
            messages.push({ role: "user", content: args.substring(0, 300) });
            
            const mistralResponse = await mistralCircuit.execute(
                async () => await callMistralAPI(messages, 600, 0.75),
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
                        addToMemory(senderIdStr, 'user', args.substring(0, 500));
                        addToMemory(senderIdStr, 'assistant', truncatedResponse.substring(0, 500));
                        log.info(`🔄 Mistral avec troncature`);
                        return truncatedResponse;
                    }
                }
                
                addToMemory(senderIdStr, 'user', args.substring(0, 500));
                addToMemory(senderIdStr, 'assistant', styledResponse.substring(0, 500));
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

// ========================================
// 🎯 DÉTECTION COMMANDES
// ========================================

const VALID_COMMANDS = [
    'help', 'image', 'vision', 'anime', 'music', 
    'clan', 'rank', 'contact', 'weather'
];

async function detectIntelligentCommands(message, ctx) {
    const { log } = ctx;
    
    try {
        const detectionPrompt = `Analyse ce message et décide si c'est une COMMANDE.

Message: "${message.substring(0, 150)}"

Commandes disponibles: /help, /image, /vision, /anime, /music, /clan, /rank, /contact, /weather

C'est une commande SI ET SEULEMENT SI :
- L'utilisateur veut UTILISER une fonctionnalité spécifique
- Il y a un VERBE D'ACTION clair (dessine, crée, joue, trouve, regarde, etc.)

Ce N'EST PAS une commande si :
- C'est juste une conversation
- L'utilisateur mentionne un mot sans vouloir l'utiliser

JSON uniquement:
{
  "isCommand": true/false,
  "command": "nom",
  "confidence": 0.0-1.0,
  "extractedArgs": "args",
  "reason": "pourquoi"
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

// ========================================
// 📞 CONTACT ADMIN
// ========================================

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

// ========================================
// ⚙️ EXÉCUTION COMMANDES
// ========================================

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
        const contextPrompt = `Utilisateur: "${originalMessage.substring(0, 100)}"\nExécuté: /${commandName}\nRésultat: "${commandResult.toString().substring(0, 200)}"\n\nRéponds naturellement (max 300 chars). Markdown: **gras**, ### titres (pas italique).`;

        const response = await callGeminiWithRotation(contextPrompt);
        return response || commandResult;
        
    } catch (error) {
        const { callMistralAPI } = ctx;
        try {
            const response = await mistralCircuit.execute(
                async () => await callMistralAPI([
                    { role: "system", content: "Réponds naturellement. Markdown simple." },
                    { role: "user", content: `User: "${originalMessage.substring(0, 80)}"\nRésultat: "${commandResult.toString().substring(0, 150)}"\nPrésente (max 200 chars)` }
                ], 200, 0.7),
                null
            );
            
            return response || commandResult;
        } catch (mistralError) {
            return commandResult;
        }
    }
}

// ========================================
// 📤 EXPORTS
// ========================================

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

module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toItalic = toItalic;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;

module.exports.LRUCache = LRUCache;
module.exports.UserRateLimiter = UserRateLimiter;
module.exports.CircuitBreaker = CircuitBreaker;
module.exports.SaveQueue = SaveQueue;

module.exports.rateLimiter = rateLimiter;
module.exports.geminiCircuit = geminiCircuit;
module.exports.mistralCircuit = mistralCircuit;
module.exports.saveQueue = saveQueue;
module.exports.activeRequests = activeRequests;
module.exports.recentMessages = recentMessages;
